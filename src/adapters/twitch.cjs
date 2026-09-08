const WebSocket = require('ws');
const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];

function normalizeChannel(value = '') {
  const raw = String(value).trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (host === 'dashboard.twitch.tv') {
      const m = url.pathname.match(/\/popout\/u\/([^/]+)/i);
      if (m?.[1]) return decodeURIComponent(m[1]).toLowerCase();
    }
    if (host === 'www.twitch.tv' || host === 'twitch.tv') {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] === 'popout' && parts[1]) return parts[1].toLowerCase();
      if (parts[0]) return parts[0].toLowerCase();
    }
  } catch {}
  return raw.replace(/^#/, '').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
}

function parseTags(raw = '') {
  const out = {};
  for (const part of String(raw).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0,i)] = part.slice(i+1).replace(/\\s/g,' ').replace(/\\:/g,';').replace(/\\r/g,'\r').replace(/\\n/g,'\n').replace(/\\\\/g,'\\');
  }
  return out;
}

class TwitchAdapter {
  constructor({ account = '', channel = '', onMessage, onStatus }) {
    this.channel = normalizeChannel(channel || account);
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.socket = null;
    this.connectPromise = null;
    this.manualStop = false;
    this.anonymousNick = '';
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.capabilities = { readChat:true, sendChat:false, moderation:false, events:false, anonymous:true };
    this.status = { name:'twitch', connected:false, state:this.channel?'configured':'not-configured', account:'', channel:this.channel, anonymous:true, readOnly:true, error:null };
  }

  getStatus() { return { ...this.status, account:'', channel:this.channel, anonymous:true, readOnly:true, nick:this.anonymousNick||undefined, reconnectAttempt:this.reconnectAttempt, capabilities:{...this.capabilities} }; }
  setStatus(patch) { this.status={...this.status,...patch,account:'',channel:this.channel,anonymous:true,readOnly:true}; this.onStatus?.(this.getStatus()); }
  updateConfig(config={}) { if(config.channel!==undefined)this.channel=normalizeChannel(config.channel); this.setStatus({state:this.channel?(this.status.connected?'connected':'configured'):'not-configured'}); }
  healthCheck(){const s=this.getStatus();return Promise.resolve({ok:Boolean(s.connected),status:s});}

  scheduleReconnect() {
    if (this.manualStop || !this.channel) return;
    clearTimeout(this.reconnectTimer);
    const delay = BACKOFF_MS[Math.min(this.reconnectAttempt, BACKOFF_MS.length-1)];
    this.reconnectAttempt += 1;
    this.setStatus({state:'retrying',connected:false,error:this.status.error});
    this.reconnectTimer=setTimeout(()=>this.connect().catch(()=>{}),delay); this.reconnectTimer.unref?.();
  }

  async connect() {
    if (!this.channel) throw new Error('Kein Twitch-Kanal eingetragen.');
    if (this.socket && [WebSocket.OPEN,WebSocket.CONNECTING].includes(this.socket.readyState)) return this.connectPromise || {ok:true,status:this.getStatus()};
    this.manualStop=false; clearTimeout(this.reconnectTimer); this.reconnectTimer=null;
    this.anonymousNick=`justinfan${Math.floor(10000+Math.random()*89999999)}`;
    this.setStatus({state:'connecting',connected:false,error:null});

    this.connectPromise=new Promise((resolve,reject)=>{
      let settled=false,registered=false;
      const socket=new WebSocket('wss://irc-ws.chat.twitch.tv:443'); this.socket=socket;
      const finishError=(message)=>{if(settled)return;settled=true;clearTimeout(timer);const error=message instanceof Error?message:new Error(String(message));this.setStatus({state:'error',connected:false,error:error.message});reject(error);};
      const finishOk=()=>{if(settled)return;settled=true;clearTimeout(timer);this.reconnectAttempt=0;this.setStatus({state:'connected',connected:true,error:null});resolve({ok:true,status:this.getStatus()});};
      const timer=setTimeout(()=>finishError('Twitch-Verbindung: Zeitüberschreitung.'),12000);
      socket.on('open',()=>{socket.send('CAP REQ :twitch.tv/membership twitch.tv/tags twitch.tv/commands');socket.send('PASS SCHMOOPIIE');socket.send(`NICK ${this.anonymousNick}`);});
      socket.on('message',(data)=>{
        const raw=data.toString('utf8');
        for(const line of raw.split('\r\n')){
          if(!line)continue;
          if(line.startsWith('PING ')){if(socket.readyState===WebSocket.OPEN)socket.send(line.replace(/^PING/,'PONG'));continue;}
          if(/NOTICE \* :Login authentication failed/i.test(line)){finishError('Twitch hat die anonyme Chat-Verbindung abgelehnt.');try{socket.close()}catch{}continue;}
          if(/^:tmi\.twitch\.tv 001 /i.test(line)){registered=true;if(socket.readyState===WebSocket.OPEN)socket.send(`JOIN #${this.channel}`);finishOk();continue;}
          this.handleIrcLine(line);
        }
      });
      socket.on('error',(error)=>finishError(error));
      socket.on('close',()=>{
        this.socket=null;this.connectPromise=null;
        if(!registered&&!settled&&!this.manualStop){finishError('Twitch hat die Verbindung vor dem Kanalbeitritt geschlossen.');}
        this.setStatus({state:this.manualStop?'stopped':'disconnected',connected:false});
        if(!this.manualStop)this.scheduleReconnect();
      });
    });
    return this.connectPromise;
  }

  handleIrcLine(line) {
    let rest=line,tags={};
    if(rest.startsWith('@')){const space=rest.indexOf(' ');if(space>0){tags=parseTags(rest.slice(1,space));rest=rest.slice(space+1);}}
    const match=rest.match(/^:([^! ]+)!.* PRIVMSG #([^ ]+) :([\s\S]*)$/);if(!match)return;
    const username=match[1],channel=match[2],message=match[3];
    this.onMessage?.({platform:'twitch',id:tags.id,userId:tags['user-id']||username,username,displayName:tags['display-name']||username,message,timestamp:tags['tmi-sent-ts']?new Date(Number(tags['tmi-sent-ts'])).toISOString():new Date().toISOString(),badges:tags.badges?tags.badges.split(',').filter(Boolean):[],moderator:tags.mod==='1'||String(tags.badges||'').includes('moderator/')||String(tags.badges||'').includes('broadcaster/'),raw:{line,tags,channel}});
  }

  async sendChat(){throw new Error('Twitch ist ohne autorisierte Anmeldung als Nur-Lesen-Chat verbunden. Senden ist deaktiviert.');}
  disconnect(){this.manualStop=true;clearTimeout(this.reconnectTimer);this.reconnectTimer=null;this.reconnectAttempt=0;if(this.socket){try{this.socket.close()}catch{}}this.socket=null;this.connectPromise=null;this.setStatus({state:'stopped',connected:false,error:null});}
}
module.exports={TwitchAdapter,normalizeChannel,parseTags,BACKOFF_MS};
