class YouTubeAdapter {
  constructor({liveChatId='',apiKey='',pollMs=2500,onMessage,onStatus}) {
    this.name='youtube';this.liveChatId=liveChatId;this.apiKey=apiKey;this.pollMs=pollMs;this.onMessage=onMessage;this.onStatus=onStatus;
    this.running=false;this.timer=null;this.pageToken='';this.backoff=pollMs;this.lastSuccessAt=null;
    this.capabilities={readChat:true,sendChat:false,moderation:false,events:false};
    this.status={name:this.name,connected:false,state:'not-configured',error:null};
  }
  getStatus(){return{...this.status,lastSuccessAt:this.lastSuccessAt,backoffMs:this.backoff,capabilities:{...this.capabilities}}}
  setStatus(p){this.status={...this.status,...p};this.onStatus?.(this.getStatus())}
  updateConfig(c={}){this.liveChatId=c.liveChatId??this.liveChatId;this.apiKey=c.apiKey??this.apiKey;this.pollMs=Math.max(1000,Number(c.pollMs||this.pollMs||2500));this.setStatus({state:this.liveChatId&&this.apiKey?(this.running?'connected':'configured'):'not-configured'})}
  healthCheck(){const s=this.getStatus();return Promise.resolve({ok:Boolean(s.connected),status:s});}
  async connect(){if(!this.liveChatId||!this.apiKey)throw new Error('YouTube benötigt Live Chat ID und API Key.');if(this.running)return{ok:true,status:this.getStatus()};this.running=true;this.backoff=this.pollMs;this.setStatus({state:'connecting',connected:false,error:null});await this.poll();if(!this.running)throw new Error(this.status.error||'YouTube-Verbindung wurde beendet.');return{ok:Boolean(this.status.connected),status:this.getStatus()}}
  async poll(){
    if(!this.running)return;
    try{
      const qs=new URLSearchParams({liveChatId:this.liveChatId,part:'snippet,authorDetails',maxResults:'200',key:this.apiKey});if(this.pageToken)qs.set('pageToken',this.pageToken);
      const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),10000);
      let r;try{r=await fetch(`https://www.googleapis.com/youtube/v3/liveChat/messages?${qs}`,{signal:controller.signal})}finally{clearTimeout(timeout)}
      if(!r.ok){const body=await r.text().catch(()=>'');throw new Error(`YouTube API ${r.status}${body?`: ${body.slice(0,300)}`:''}`)}
      const j=await r.json();
      for(const item of j.items||[]){const s=item.snippet||{},a=item.authorDetails||{};this.onMessage?.({platform:'youtube',id:item.id,userId:a.channelId,username:a.displayName||'YouTubeUser',displayName:a.displayName,message:s.displayMessage||'',timestamp:s.publishedAt||new Date().toISOString(),moderator:Boolean(a.isChatModerator||a.isChatOwner),subscriber:Boolean(a.isChatSponsor),raw:item})}
      this.pageToken=j.nextPageToken||this.pageToken;this.backoff=Math.max(this.pollMs,Number(j.pollingIntervalMillis||this.pollMs));this.lastSuccessAt=new Date().toISOString();this.setStatus({state:'connected',connected:true,error:null});
    }catch(e){this.backoff=Math.min(60000,Math.max(5000,this.backoff*2));this.setStatus({state:this.lastSuccessAt?'degraded':'error',connected:Boolean(this.lastSuccessAt),error:e.name==='AbortError'?'YouTube API: Zeitüberschreitung.':e.message})}
    finally{if(this.running){clearTimeout(this.timer);this.timer=setTimeout(()=>this.poll(),this.backoff);this.timer.unref?.();}}
  }
  async sendChat(){throw new Error('YouTube Senden ist ohne autorisierte OAuth-Schreibverbindung deaktiviert.');}
  disconnect(){this.running=false;clearTimeout(this.timer);this.timer=null;this.setStatus({state:'stopped',connected:false,error:null})}
}
module.exports={YouTubeAdapter};
