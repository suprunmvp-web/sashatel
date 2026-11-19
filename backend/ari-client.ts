import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';

export type AriChannel = {id: string; state: string; name?: string; caller?: {number?:string}};
export type AriBridge = {id: string; channels: string[]};
export type AriHttp = (url:string, init:RequestInit)=>Promise<Response>;

const token = /^[a-zA-Z0-9_.:-]{1,96}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const e164 = /^\+[1-9][0-9]{6,14}$/;

/**
 * Private, outbound-only ARI REST transport. Construct only from server-owned
 * config; do not forward Desktop-provided channel, application or endpoint.
 *
 * This is NOT the call orchestrator. It neither dispatches billing decisions
 * nor makes a two-party call by itself. Caller must enforce durable one-shot
 * dispatch, per-tenant authorization, carrier CLI approval and event recovery.
 */
export class PrivateAriClient {
  private readonly base: URL;
  private readonly authorization: string;
  private readonly http: AriHttp;

  constructor(baseUrl: string, username: string, password: string,
              http: AriHttp = fetch) {
    this.http=http;
    const base=new URL(baseUrl);
    if(base.username||base.password||base.search||base.hash||base.pathname!=='/ari/') {
      throw new Error('ARI_BASE_INVALID');
    }
    if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new Error('ARI_PROTOCOL_INVALID');
    // Explicitly disallow private RFC1918 or externally-routable plain HTTP:
    // remote ARI must use HTTPS + independent network ACL.
    const loopback=base.hostname==='localhost'||base.hostname==='127.0.0.1'||base.hostname==='[::1]';
    if (base.protocol==='http:'&&!loopback) throw new Error('ARI_HTTP_REQUIRES_LOOPBACK');
    if (!loopback && isIP(base.hostname) && base.protocol!=='https:') throw new Error('ARI_TRANSPORT_INSECURE');
    if (!username || !password || username.includes(':') || /[\r\n]/.test(username+password)) {
      throw new Error('ARI_CREDENTIALS_INVALID');
    }
    this.base=base;
    this.authorization='Basic '+Buffer.from(username+':'+password,'utf8').toString('base64');
  }

  static async fromFiles(config: {baseUrl:string; username:string; passwordFile:string;
                                 http?:AriHttp}) {
    const password=(await readFile(config.passwordFile,'utf8')).trimEnd();
    if (!password || password.length<32) throw new Error('ARI_SECRET_TOO_SHORT');
    return new PrivateAriClient(config.baseUrl,config.username,password,config.http);
  }

  private async request<T>(method:string,pathname:string,query?:Record<string,string>,
                           body?:unknown):Promise<T> {
    const url=new URL(pathname,this.base);
    if(url.origin!==this.base.origin || !url.pathname.startsWith('/ari/')) throw Error('ARI_URL_INVALID');
    if(query) for(const [k,v] of Object.entries(query)) url.searchParams.set(k,v);
    const response=await this.http(url.href,{
      method,headers:{authorization:this.authorization,accept:'application/json',
        ...(body===undefined?{}:{'content-type':'application/json'})},
      body:body===undefined?undefined:JSON.stringify(body),
      signal:AbortSignal.timeout(5000),
      redirect:'error',
    });
    if(response.status===404) throw new AriHttpError(404,'ARI_NOT_FOUND');
    if(response.status===409) throw new AriHttpError(409,'ARI_CONFLICT');
    if(response.status===401||response.status===403) throw new AriHttpError(response.status,'ARI_AUTH_DENIED');
    if(!response.ok) throw new AriHttpError(response.status,'ARI_UPSTREAM_FAILED');
    const txt=await response.text();
    return (txt?JSON.parse(txt):undefined) as T;
  }

  async readiness():Promise<unknown> {
    return this.request('GET','asterisk/info');
  }

  /** Exact channel ID must originate from a durable trusted call attempt. */
  async inspectChannel(channelId:string):Promise<AriChannel|null> {
    if(!uuid.test(channelId)) throw Error('ARI_CHANNEL_ID_INVALID');
    try{return await this.request<AriChannel>('GET','channels/'+channelId);}
    catch(e){if(e instanceof AriHttpError&&e.status===404)return null;throw e;}
  }

  /** A missing channel is already stopped; never reoriginate on an ambiguous result. */
  async hangupChannel(channelId:string):Promise<boolean> {
    if(!uuid.test(channelId)) throw Error('ARI_CHANNEL_ID_INVALID');
    try{await this.request('DELETE','channels/'+channelId);return true;}
    catch(e){if(e instanceof AriHttpError&&e.status===404)return false;throw e;}
  }

  /**
   * External destination leg only. Does not answer/bridge Desktop caller leg.
   * Requires an authorized, durable dispatch whose channelId is predetermined.
   */
  async originateOutboundLeg(command:{
    channelId:string;destination:string;callerId:string;
    carrierEndpointId:string;stasisApp:string;stasisArgs:string;
  }):Promise<AriChannel> {
    if(!uuid.test(command.channelId)||!e164.test(command.destination)||
      !e164.test(command.callerId)||!token.test(command.carrierEndpointId)||
      !token.test(command.stasisApp)||!uuid.test(command.stasisArgs)) {
      throw Error('ARI_ORIGINATE_PLAN_INVALID');
    }
    // The endpoint is server-derived from an operator-approved mapping;
    // never accept a raw endpoint/dial string from a Desktop request.
    return this.request<AriChannel>('POST','channels',{
      endpoint:'PJSIP/'+command.destination.slice(1)+'@'+command.carrierEndpointId,
      app:command.stasisApp,
      appArgs:command.stasisArgs,
      channelId:command.channelId,
      callerId:command.callerId,
      timeout:'30',
    });
  }

  async createMixingBridge(bridgeId:string):Promise<AriBridge> {
    if(!uuid.test(bridgeId))throw Error('ARI_BRIDGE_ID_INVALID');
    return this.request<AriBridge>('POST','bridges/'+bridgeId,{type:'mixing'});
  }

  async addToBridge(bridgeId:string,channelIds:readonly string[]):Promise<void> {
    if(!uuid.test(bridgeId)||channelIds.length!==2||!channelIds.every(x=>uuid.test(x))||
      channelIds[0]===channelIds[1])throw Error('ARI_BRIDGE_CHANNELS_INVALID');
    await this.request('POST','bridges/'+bridgeId+'/addChannel',{channel:channelIds.join(',')});
  }

  async destroyBridge(bridgeId:string):Promise<void> {
    if(!uuid.test(bridgeId))throw Error('ARI_BRIDGE_ID_INVALID');
    try{await this.request('DELETE','bridges/'+bridgeId);}
    catch(e){if(!(e instanceof AriHttpError&&e.status===404))throw e;}
  }
}

export class AriHttpError extends Error {
  readonly status:number;
  readonly code:string;
  constructor(status:number, code:string) {
    super(code);
    this.status=status;
    this.code=code;
  }
}
