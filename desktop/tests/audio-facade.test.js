import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioServiceFacade } from '../src/audio-facade.js';

test('published Audio Device Service maps to UI without opening media or inferring audible success', async () => {
  const effects=[];
  const state={devices:{inputs:[{id:'mic',label:'USB',selectable:true},{id:'',label:'Hidden',selectable:false}],outputs:[{id:'out',label:'Headset',selectable:true}]},permission:'granted',inputId:'mic',outputId:'out',volume:.6,testing:'microphone',meter:{rms:.23},lastTest:null,error:null,capabilities:{outputSelection:true}};
  let listener;
  const service={getState:()=>structuredClone(state),subscribe:fn=>{listener=fn;return()=>{listener=null;};},selectInput:async id=>effects.push(['input',id]),selectOutput:async id=>effects.push(['output',id]),setPlaybackVolume:value=>effects.push(['volume',value]),testMicrophone:async()=>effects.push(['microphone']),testPlayback:async()=>effects.push(['playback']),stopTests:()=>effects.push(['stop']),requestPermission:async()=>effects.push(['permission'])};
  const facade=new AudioServiceFacade(service);
  let latest;
  const unsubscribe=facade.subscribe(snapshot=>{latest=snapshot;});
  assert.deepEqual(effects,[]);
  listener(state); assert.equal(latest.level,.23); assert.equal(latest.inputs.length,2);
  state.testing='playback';state.lastTest={kind:'playback',reason:'completed'};
  assert.equal(facade.getSnapshot().testing,'speaker');
  assert.match(facade.getSnapshot().result,/слышали ли/);
  state.lastTest={kind:'microphone',reason:'completed',signalDetected:false};
  assert.match(facade.getSnapshot().result,/не обнаружен/);
  state.lastTest.reason='DEVICE_LOST';assert.match(facade.getSnapshot().result,/прервана/);
  state.error={code:'DEVICE_LOST'};assert.match(facade.getSnapshot().message,/отключено/);
  await facade.selectInput('mic'); await facade.selectOutput('out'); await facade.setVolume(.2);
  await facade.testMicrophone(); await facade.testSpeaker(); await facade.stopTest(); await facade.requestPermission();
  assert.deepEqual(effects,[['input','mic'],['output','out'],['volume',.2],['microphone'],['playback'],['stop'],['permission']]);
  unsubscribe();assert.equal(listener,null);
});
