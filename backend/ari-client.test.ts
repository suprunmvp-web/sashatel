import test from 'node:test';
import assert from 'node:assert/strict';
import { AriHttpError, PrivateAriClient } from './ari-client.ts';

const channel='11111111-1111-4111-8111-111111111111';
const bridge='22222222-2222-4222-8222-222222222222';
const call='33333333-3333-4333-8333-333333333333';

function mock(responseStatus=200, responseBody='{}') {
  const seen: Array<{url:URL;init:RequestInit}>=[];
  const api=new PrivateAriClient('http://127.0.0.1:8088/ari/','sashatel-backend','secret',
    async (url,init)=>{seen.push({url:new URL(url),init});return new Response(responseBody,{status:responseStatus});});
  return {api,seen};
}

test('reject public plain HTTP, URL credentials and non-ARI paths',()=>{
  assert.throws(()=>new PrivateAriClient('http://10.1.0.1:8088/ari/','x','y'),/ARI_HTTP_REQUIRES_LOOPBACK/);
  assert.throws(()=>new PrivateAriClient('http://example.org:8088/ari/','x','y'),/ARI_HTTP_REQUIRES_LOOPBACK/);
  assert.throws(()=>new PrivateAriClient('http://127.0.0.1:8088/','x','y'),/ARI_BASE_INVALID/);
  assert.throws(()=>new PrivateAriClient('http://u:p@127.0.0.1:8088/ari/','x','y'),/ARI_BASE_INVALID/);
  assert.throws(()=>new PrivateAriClient('file:///ari/','x','y'),/ARI_PROTOCOL_INVALID/);
});

test('readiness sends authenticated GET without leaking secrets in URL',async()=>{
  const {api,seen}=mock();
  await api.readiness();
  assert.equal(seen[0].url.pathname,'/ari/asterisk/info');
  assert.equal(seen[0].init.method,'GET');
  assert.equal(seen[0].init.redirect,'error');
  assert(!seen[0].url.href.includes('secret'));
  const headers=seen[0].init.headers as Record<string,string>;
  assert.equal(headers.authorization,'Basic '+Buffer.from('sashatel-backend:secret').toString('base64'));
});

test('server-owned originate constructs destination and app, not an arbitrary dialplan',async()=>{
  const {api,seen}=mock();
  await api.originateOutboundLeg({channelId:channel,destination:'+79260000000',
    callerId:'+74950000000',carrierEndpointId:'uis-provisioned',stasisApp:'sashatel',
    stasisArgs:call});
  const req=seen[0];
  assert.equal(req.url.searchParams.get('endpoint'),'PJSIP/79260000000@uis-provisioned');
  assert.equal(req.url.searchParams.get('channelId'),channel);
  assert.equal(req.url.searchParams.get('callerId'),'+74950000000');
  assert.equal(req.init.method,'POST');
  await assert.rejects(api.originateOutboundLeg({channelId:channel,destination:'+79260000000',
    callerId:'+74950000000',carrierEndpointId:'UIS/evil',stasisApp:'sashatel',
    stasisArgs:call}),/ARI_ORIGINATE_PLAN_INVALID/);
});

test('channels and bridges require trusted fixed IDs',async()=>{
  const {api,seen}=mock();
  await api.createMixingBridge(bridge);
  await api.addToBridge(bridge,[channel,call]);
  await api.destroyBridge(bridge);
  assert.equal(seen[0].url.pathname,'/ari/bridges/'+bridge);
  assert.equal(seen[1].url.searchParams.get('channel'),channel+','+call);
  assert.equal(seen[2].init.method,'DELETE');
  await assert.rejects(api.hangupChannel('../channels'),/ARI_CHANNEL_ID_INVALID/);
});

test('404 is idempotent for inspect/hangup/bridge destroy; other failures fail closed',async()=>{
  const {api}=mock(404,'{}');
  assert.equal(await api.inspectChannel(channel),null);
  assert.equal(await api.hangupChannel(channel),false);
  await api.destroyBridge(bridge);
  const unauthorized=mock(401,'{}');
  await assert.rejects(unauthorized.api.readiness(),e=>e instanceof AriHttpError&&e.code==='ARI_AUTH_DENIED');
});

test('timeout/transport failures propagate instead of silently enabling mocks',async()=>{
  const api=new PrivateAriClient('http://127.0.0.1:8088/ari/','service','secret',
    async ()=>{throw Error('ECONNREFUSED');});
  await assert.rejects(api.readiness(),/ECONNREFUSED/);
});
