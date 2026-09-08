const { EventEmitter } = require('events');
const crypto = require('crypto');
const PLATFORMS = new Set(['tiktok','twitch','cng','youtube','local']);

function normalizeMessage(input={}){
  if(input?.schemaVersion && input?.type==='chat'){
    const p=String(input.platform||'internal').toLowerCase();
    return {
      id: input.eventId || crypto.randomUUID(),
      platform: PLATFORMS.has(p)?p:'local',
      userId:String(input.user?.id||input.user?.username||'unknown'),
      username:String(input.user?.username||'Unknown'),
      displayName:String(input.user?.displayName||input.user?.username||'Unknown'),
      message:String(input.message?.text||''),
      timestamp:input.timestamp||new Date().toISOString(),
      badges:Array.isArray(input.user?.badges)?input.user.badges:[],
      moderator:Boolean(input.user?.isModerator),
      subscriber:Boolean(input.user?.isSubscriber),
      vip:Boolean(input.user?.isVip),
      raw:input.meta?.rawData||input
    };
  }
  const platform=String(input.platform||'local').toLowerCase();
  return {
    id: input.id || crypto.randomUUID(),
    platform: PLATFORMS.has(platform)?platform:'local',
    userId:String(input.userId||input.userid||input.user_id||input.username||'unknown'),
    username:String(input.username||input.user||input.name||'Unknown'),
    displayName:String(input.displayName||input.display_name||input.nickname||input.username||input.user||input.name||'Unknown'),
    message:String(input.message||input.text||input.comment||''),
    timestamp:input.timestamp||new Date().toISOString(),
    badges:Array.isArray(input.badges)?input.badges:[],
    moderator:Boolean(input.moderator||input.isModerator||input.mod),
    subscriber:Boolean(input.subscriber||input.isSubscriber),
    vip:Boolean(input.vip||input.isVip),
    raw:input.raw||input
  };
}

class ChatCore extends EventEmitter{
  constructor(config){
    super(); this.config=config; this.messages=[]; this.logs=[];
    this.moderation=structuredClone(config.moderation?.state||{});
    this.history=structuredClone(config.moderation?.history||[]);
  }
  setConfig(config){ this.config=config; if(config.moderation?.state) this.moderation=structuredClone(config.moderation.state); if(config.moderation?.history) this.history=structuredClone(config.moderation.history); }
  log(level,category,message,meta={}){ const e={id:crypto.randomUUID(),timestamp:new Date().toISOString(),level,category,message,meta}; this.logs.push(e); if(this.logs.length>2000)this.logs.splice(0,this.logs.length-2000); this.emit('log',e); return e; }
  getLogs(){return this.logs.slice();} clearLogs(){this.logs=[];}
  getMessages(){return this.messages.slice();} clearMessages(){this.messages=[];}
  getModerationState(){return structuredClone(this.moderation);}
  getModerationHistory(){return structuredClone(this.history);}
  findLastMessage(platform,username){return [...this.messages].reverse().find(m=>m.platform===platform&&m.username===username)?.message||'';}

  evaluateFilters(message){
    if(!this.config.filters?.enabled)return null;
    const user=message.username.toLowerCase();
    if((this.config.filters.whitelistUsers||[]).map(x=>String(x).toLowerCase()).includes(user))return null;
    const text=message.message; const whitelist=(this.config.filters.whitelistTerms||[]).map(x=>String(x).toLowerCase());
    for(const rule of this.config.filters.rules||[]){
      if(rule.enabled===false)continue;
      if(rule.platform&&rule.platform!=='all'&&rule.platform!==message.platform)continue;
      const needle=String(rule.term||'').trim(); if(!needle||whitelist.includes(needle.toLowerCase()))continue;
      const hay=rule.caseSensitive?text:text.toLowerCase(); const term=rule.caseSensitive?needle:needle.toLowerCase();
      let hit=false;
      if(rule.wholeWord){const escaped=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); hit=new RegExp(`(^|\\W)${escaped}(?=\\W|$)`,rule.caseSensitive?'':'i').test(text);} else hit=hay.includes(term);
      if(hit)return rule;
    }
    return null;
  }

  ingest(input){
    const message=normalizeMessage(input); if(!message.message.trim())return null;
    const state=this.moderation[message.platform]||this.moderation.local||{muted:[],blocked:[]};
    if((state.blocked||[]).some(x=>x.username===message.username)){this.log('INFO','Moderation',`Blockiert: ${message.username}`,{platform:message.platform});return null;}
    if((state.muted||[]).some(x=>x.username===message.username)){this.log('INFO','Moderation',`Stumm: ${message.username}`,{platform:message.platform});return null;}
    const filter=this.evaluateFilters(message);
    if(filter){
      const hit={id:crypto.randomUUID(),timestamp:new Date().toISOString(),platform:message.platform,username:message.username,message:message.message,term:filter.term,action:filter.action||'hide'};
      this.emit('filter-hit',hit); this.log('INFO','Chat-Filter',`${message.username}: ${filter.term}`,hit);
      if(filter.action==='mute')this.moderate({platform:message.platform,username:message.username,action:'mute',reason:`Chat-Filter: ${filter.term}`,resultMode:'local'});
      if(filter.action==='block')this.moderate({platform:message.platform,username:message.username,action:'block',reason:`Chat-Filter: ${filter.term}`,resultMode:'local'});
      if((filter.action||'hide')==='hide')return null; message.filterHit=hit;
    }
    this.messages.push(message); const max=Math.max(50,Math.min(5000,Number(this.config.multiChat?.maxMessages||500))); if(this.messages.length>max)this.messages.splice(0,this.messages.length-max); this.emit('message',message); return message;
  }

  moderate(payload={}){
    const platform=PLATFORMS.has(String(payload.platform||'').toLowerCase())?String(payload.platform).toLowerCase():'local';
    const username=String(payload.username||'').trim(); const action=String(payload.action||''); const reason=String(payload.reason||'').trim();
    if(!username)return{ok:false,error:'Benutzername fehlt.'};
    if(!this.moderation[platform])this.moderation[platform]={moderators:[],muted:[],blocked:[]}; const state=this.moderation[platform];
    const remove=list=>{const i=list.findIndex(x=>x.username===username);if(i>=0)list.splice(i,1)};
    const add=list=>{remove(list);list.push({username,reason,at:new Date().toISOString(),by:this.config.general?.displayName||'Crazy_Batto'})};
    if(action==='addModerator')add(state.moderators);
    else if(action==='removeModerator')remove(state.moderators);
    else if(action==='mute')add(state.muted);
    else if(action==='unmute')remove(state.muted);
    else if(action==='block')add(state.blocked);
    else if(action==='unblock')remove(state.blocked);
    else return{ok:false,error:'Unbekannte Moderationsaktion.'};
    const entry={id:crypto.randomUUID(),timestamp:new Date().toISOString(),platform,username,action,reason,lastMessage:this.findLastMessage(platform,username),executor:payload.executor||this.config.general?.displayName||'Crazy_Batto',result:payload.resultMode||'local'};
    this.history.push(entry); if(this.history.length>1000)this.history.splice(0,this.history.length-1000);
    this.config.moderation.state=structuredClone(this.moderation); this.config.moderation.history=structuredClone(this.history);
    this.emit('moderation',entry); this.emit('config-dirty',this.config); this.log('INFO','Moderation',`${username}: ${action}`,entry);
    return{ok:true,entry,state:structuredClone(state)};
  }

  addFilter(payload={}){const term=String(payload.term||'').trim();if(!term)return{ok:false,error:'Begriff fehlt.'};const rule={id:crypto.randomUUID(),term,platform:payload.platform||'all',action:payload.action||'hide',wholeWord:Boolean(payload.wholeWord),caseSensitive:Boolean(payload.caseSensitive),enabled:payload.enabled!==false};this.config.filters.rules=[...(this.config.filters.rules||[]),rule];this.emit('config-dirty',this.config);return{ok:true,rule};}
  removeFilter(id){const before=this.config.filters.rules.length;this.config.filters.rules=this.config.filters.rules.filter(r=>r.id!==id);this.emit('config-dirty',this.config);return{ok:this.config.filters.rules.length!==before};}
}
module.exports={ChatCore,normalizeMessage};
