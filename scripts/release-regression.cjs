'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ActionEngine}=require('../src/core/action-engine.cjs');
const {normalizeEvent}=require('../src/core/events/normalizer.cjs');
const {BroadcastScheduler}=require('../src/core/broadcast/scheduler.cjs');
const {ConfigStore}=require('../src/core/config-store.cjs');
const {BroadcastService}=require('../src/core/broadcast/service.cjs');
(async()=>{
 let clock=0;const sent=[];const s=new BroadcastScheduler({now:()=>clock,send:async(p)=>{sent.push(p);return{ok:true};}});
 s.configure({enabled:true,globalMinGapSeconds:3,platformMinGapSeconds:0,items:[{id:'a',enabled:true,targets:['local','cng'],messages:['Hi'],startDelaySeconds:0}]});await s.tick();assert.deepEqual(sent,['local']);clock=3000;await s.tick();assert.deepEqual(sent,['local','cng']);s.stop();
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'batto213-'));
 try{
  const store=new ConfigStore(tmp);const svc=new BroadcastService({store,send:async()=>({ok:true}),isLive:()=>false});
  const a=svc.upsert({id:'one',name:'One',targets:['local'],messages:['A'],intervalSeconds:30});assert(a.ok);svc.duplicate('one');assert.equal(svc.status().items.length,2);svc.remove('one');assert.equal(new ConfigStore(tmp).get().autoBroadcast.items.length,1);assert.throws(()=>svc.upsert({id:'bad',messages:['a'],targets:['bad']}));svc.stop();
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
 for(const type of ['share','raid','stream_start','stream_end'])assert.equal(normalizeEvent({type,data:{username:'Tester'}},'test').type,type);
 let live=false;const messages=[];const cfg={commands:[{id:'c',trigger:'!hi',platform:'all',actions:[{type:'chat',platform:'local',text:'{platform}'}]}],events:[],media:[],mediaPools:[],tts:{volume:.37,rate:1.2,outputDeviceId:'selected'},rules:{}};
 let tts;
 const e=new ActionEngine({getConfig:()=>cfg,isLive:()=>live,sendChat:async(p,text)=>{messages.push(text);return{ok:true}},onTts:x=>{tts=x;}});
 for(const platform of ['tiktok','twitch','cng','youtube'])await e.handleMessage({platform,username:'Tester',message:'!hi'});
 assert.deepEqual(messages,['tiktok','twitch','cng','youtube']);await e.handleMessage({platform:'twitch',username:'Tester',message:'!hijacked'});assert.equal(messages.length,4);
 assert(e.eventMatches({event:'subscribe'},{type:'sub',platform:'twitch'}));
 const blocked=await e.executeRule({id:'live',onlyWhenLive:true,actions:[{type:'chat',text:'bad'}]}, {}, 'event');assert.equal(blocked.skipped,'not-live');
 await e.executeOne({type:'tts',text:'Test'},{});assert.equal(tts.volume,.37);assert.equal(tts.outputDeviceId,'selected');
 const failing=new ActionEngine({getConfig:()=>cfg,onHttp:async()=>({ok:false,status:500})});assert.equal((await failing.execute([{type:'http',url:'http://localhost'}])).ok,false);
 console.log('2.1.5 regression: global throttling, service CRUD/reload, platform commands, aliases, LIVE gating, TTS config and truthful errors: OK');
})().catch(e=>{console.error(e);process.exitCode=1});
