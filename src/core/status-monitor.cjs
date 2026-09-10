const os=require('os');
class StatusMonitor{
  constructor({obs,onStatus,intervalMs=2000}){this.obs=obs;this.onStatus=onStatus;this.intervalMs=intervalMs;this.timer=null;this.prevCpu=os.cpus();this.prevBytes=null;this.prevAt=null;}
  start(){if(this.timer)return;const tick=async()=>{this.onStatus?.(await this.snapshot());this.timer=setTimeout(tick,this.intervalMs)};tick()}
  stop(){clearTimeout(this.timer);this.timer=null}
  cpu(){const now=os.cpus();let idle=0,total=0,pIdle=0,pTotal=0;for(const c of now){idle+=c.times.idle;total+=Object.values(c.times).reduce((a,b)=>a+b,0)}for(const c of this.prevCpu){pIdle+=c.times.idle;pTotal+=Object.values(c.times).reduce((a,b)=>a+b,0)}this.prevCpu=now;const dt=total-pTotal,di=idle-pIdle;return dt>0?Math.max(0,Math.min(100,(1-di/dt)*100)):0}
  async snapshot(){const mem=(1-os.freemem()/os.totalmem())*100;const obs=await this.obs?.stats?.();let bitrate=null;if(obs?.outputBytes!=null){const now=Date.now();if(this.prevBytes!=null&&this.prevAt){const seconds=(now-this.prevAt)/1000;if(seconds>0)bitrate=Math.max(0,((obs.outputBytes-this.prevBytes)*8/1000)/seconds)}this.prevBytes=obs.outputBytes;this.prevAt=now}
    const dropped=(obs?.renderMissed??0)+(obs?.outputSkipped??0);return{cpu:this.cpu(),ram:mem,uploadKbps:null,fps:obs?.fps??null,bitrateKbps:bitrate,framedrops:obs?dropped:null,obsConnected:Boolean(this.obs?.connected),time:new Date().toISOString()}}
}
module.exports={StatusMonitor};
