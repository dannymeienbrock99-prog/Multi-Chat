const { OBSWebSocket } = require('obs-websocket-js');
class OBSController{
  constructor({url='ws://127.0.0.1:4455',password='',onStatus}){this.url=url;this.password=password;this.onStatus=onStatus;this.obs=new OBSWebSocket();this.connected=false;this.status={connected:false,state:'idle',url:this.url,error:null};this.obs.on('ConnectionClosed',()=>{this.connected=false;this.setStatus({connected:false,state:'disconnected'})})}
  setStatus(p){this.status={...this.status,...p,url:this.url};this.onStatus?.({...this.status})}getStatus(){return{...this.status}}
  updateConfig(c={}){if(c.url)this.url=c.url;if(c.password!==undefined)this.password=c.password;this.setStatus({});}
  async connect(){this.setStatus({state:'connecting',error:null});try{await this.obs.connect(this.url,this.password||undefined,{rpcVersion:1});this.connected=true;this.setStatus({connected:true,state:'connected',error:null});return{ok:true,status:this.getStatus()}}catch(e){this.connected=false;const msg=/auth|password/i.test(e.message||'')?'OBS WebSocket: Passwort/Authentifizierung fehlgeschlagen.':`OBS WebSocket: ${e.message}`;this.setStatus({connected:false,state:'error',error:msg});throw new Error(msg)}}
  async disconnect(){try{await this.obs.disconnect()}catch{}this.connected=false;this.setStatus({connected:false,state:'stopped',error:null})}
  async call(request,data){if(!this.connected)throw new Error('OBS ist nicht verbunden.');return this.obs.call(request,data)}
  async stats(){if(!this.connected)return null;try{const [stats,stream]=await Promise.all([this.obs.call('GetStats'),this.obs.call('GetStreamStatus').catch(()=>null)]);return{fps:stats.activeFps??null,cpu:stats.cpuUsage??null,memory:stats.memoryUsage??null,renderMissed:stats.renderMissedFrames??null,outputSkipped:stats.outputSkippedFrames??null,outputBytes:stream?.outputBytes??null,outputActive:stream?.outputActive??false}}catch{return null}}
}
module.exports={OBSController};
