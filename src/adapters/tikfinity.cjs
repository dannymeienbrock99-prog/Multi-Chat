const WebSocket = require('ws');

const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
const CHAT_EVENTS = new Set(['chat', 'comment', 'message']);

function pick(object, keys) {
  for (const key of keys) {
    if (object?.[key] !== undefined && object?.[key] !== null) return object[key];
  }
  return undefined;
}

function parseJson(value) {
  let parsed=value;
  if (Buffer.isBuffer(parsed)) parsed=parsed.toString('utf8');
  else if (Array.isArray(parsed) && parsed.length && parsed.every(Buffer.isBuffer)) parsed=Buffer.concat(parsed).toString('utf8');
  else if (parsed instanceof ArrayBuffer) parsed=Buffer.from(parsed).toString('utf8');
  else if (ArrayBuffer.isView(parsed)) parsed=Buffer.from(parsed.buffer, parsed.byteOffset, parsed.byteLength).toString('utf8');
  if (typeof parsed !== 'string') return parsed;
  try { return JSON.parse(parsed); } catch { return null; }
}

function eventName(packet, data) {
  const value = firstText(packet?.event, packet?.eventType, packet?.type, data?.event, data?.eventType, data?.type);
  const normalized = String(value).trim().toLowerCase().replace(/[^a-z]/g, '');
  if (normalized.endsWith('chat') || normalized === 'chatmessage') return 'chat';
  if (normalized.endsWith('comment') || normalized === 'commentevent') return 'comment';
  return normalized;
}

function asText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return pickText(value, ['text', 'comment', 'message', 'value']);
  return String(value).trim();
}

function firstText(...values) {
  for (const value of values) {
    const text=asText(value);
    if (text) return text;
  }
  return '';
}

function pickText(object, keys) {
  return firstText(...keys.map((key) => object?.[key]));
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function asBoolean(value) {
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  return Boolean(value);
}

function timestamp(value) {
  if (value === undefined || value === null || value === '') return new Date().toISOString();
  let candidate = value;
  if (typeof candidate === 'string' && /^\d+(?:\.\d+)?$/.test(candidate.trim())) candidate = Number(candidate);
  if (typeof candidate === 'number' && Number.isFinite(candidate)) candidate = candidate < 1e12 ? candidate * 1000 : candidate;
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function packetItems(input) {
  const parsed = parseJson(input);
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed.flatMap(packetItems);
  if (typeof parsed !== 'object') return [];
  const data = parseJson(parsed.data);
  if (Array.isArray(data)) return data.map((item) => ({ ...parsed, data:item }));
  return [{ ...parsed, data:data ?? parsed.data }];
}

function normalizeTikFinityPacket(packet) {
  if (!packet || typeof packet !== 'object') return null;
  const parsedData = parseJson(packet.data);
  const data = parsedData && typeof parsedData === 'object' && !Array.isArray(parsedData) ? parsedData : packet;
  const event = eventName(packet, data);
  if (!event) return null;

  const userObject = [data.user, data.userData, data.author].find((value) => value && typeof value === 'object' && !Array.isArray(value)) || {};
  const flatUser = typeof data.user === 'string' ? data.user : '';
  const username = firstText(
    pickText(userObject, ['uniqueId', 'unique_id', 'username', 'login', 'name']),
    pickText(data, ['uniqueId', 'unique_id', 'username', 'authorName']),
    flatUser,
    'TikTokUser'
  );
  const displayName = firstText(
    pickText(userObject, ['nickname', 'displayName', 'name']),
    pickText(data, ['nickname', 'displayName', 'authorName']),
    username
  );
  const occurredAt = timestamp(firstValue(
    pick(data, ['timestamp', 'createTime', 'createdAt', 'time']),
    pick(packet, ['timestamp', 'createTime', 'createdAt', 'time'])
  ));

  if (CHAT_EVENTS.has(event)) {
    const message = firstText(data.comment, data.message, data.text, data.msg);
    if (!message) return null;
    return {
      kind:'message',
      value:{
        id:firstText(pickText(packet, ['eventId', 'msgId', 'messageId', 'id']), pickText(data, ['eventId', 'msgId', 'messageId', 'id'])) || undefined,
        platform:'tiktok',
        userId:firstText(pickText(userObject, ['userId', 'userIdString', 'user_id', 'id']), pickText(data, ['userId', 'userIdString', 'user_id', 'id']), username),
        username,
        displayName,
        message,
        avatar:firstText(pickText(userObject, ['profilePictureUrl', 'avatarUrl', 'avatar', 'picture']), pickText(data, ['profilePictureUrl', 'avatarUrl', 'avatar', 'picture'])),
        badges:Array.isArray(userObject.badges) ? userObject.badges : Array.isArray(data.badges) ? data.badges : [],
        timestamp:occurredAt,
        moderator:asBoolean(firstValue(pick(userObject, ['isModerator', 'moderator', 'mod']), pick(data, ['isModerator', 'moderator', 'mod']))),
        subscriber:asBoolean(firstValue(pick(userObject, ['isSubscriber', 'subscriber', 'isSub']), pick(data, ['isSubscriber', 'subscriber', 'isSub']))),
        raw:packet
      }
    };
  }

  return {
    kind:'event',
    value:{ source:'tikfinity', platform:'tiktok', event, data, timestamp:occurredAt, raw:packet }
  };
}

function friendlySocketError(error) {
  const message = String(error?.message || error || 'Unbekannter Verbindungsfehler');
  if (/ECONNREFUSED|connect .*21213|socket hang up/i.test(message)) {
    return 'TikFinity Desktop ist auf Port 21213 nicht erreichbar. TikFinity starten und mit dem TikTok-LIVE verbinden.';
  }
  return message;
}

class TikFinityAdapter {
  constructor({ url='ws://127.0.0.1:21213/', reconnectSeconds=5, onMessage, onEvent, onStatus }) {
    this.name='tikfinity';
    this.url=url;
    this.reconnectSeconds=reconnectSeconds;
    this.onMessage=onMessage;
    this.onEvent=onEvent;
    this.onStatus=onStatus;
    this.socket=null;
    this.timer=null;
    this.manualStop=false;
    this.reconnectAttempt=0;
    this.capabilities={ readChat:true, sendChat:false, moderation:false, events:true };
    this.status={ name:this.name, connected:false, state:'idle', url };
  }

  getStatus() {
    return { ...this.status, url:this.url, reconnectAttempt:this.reconnectAttempt, capabilities:{...this.capabilities} };
  }

  healthCheck() {
    const status=this.getStatus();
    return Promise.resolve({ ok:Boolean(status.connected), status });
  }

  setStatus(patch) {
    this.status={ ...this.status, ...patch, url:this.url };
    this.onStatus?.(this.getStatus());
  }

  updateConfig(config={}) {
    this.url=config.url || this.url;
    this.reconnectSeconds=Number(config.reconnectSeconds || 5);
    this.setStatus({});
  }

  connect() {
    if (this.socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(this.socket.readyState)) return;
    this.manualStop=false;
    clearTimeout(this.timer);
    this.setStatus({ state:'connecting', connected:false, error:null });
    try { this.socket=new WebSocket(this.url); }
    catch (error) {
      this.setStatus({ state:'error', connected:false, error:friendlySocketError(error) });
      return this.reconnect();
    }
    this.socket.on('open', () => {
      this.reconnectAttempt=0;
      this.setStatus({ state:'connected', connected:true, error:null });
    });
    this.socket.on('message', (data) => this.handle(data));
    this.socket.on('error', (error) => this.setStatus({ state:'error', connected:false, error:friendlySocketError(error) }));
    this.socket.on('close', () => {
      this.socket=null;
      this.setStatus({ state:this.manualStop ? 'stopped' : 'disconnected', connected:false });
      if (!this.manualStop) this.reconnect();
    });
  }

  reconnect() {
    if (this.manualStop) return;
    clearTimeout(this.timer);
    const configured=Math.max(1, Number(this.reconnectSeconds || 1)) * 1000;
    const delay=Math.min(30000, Math.max(configured, BACKOFF_MS[Math.min(this.reconnectAttempt, BACKOFF_MS.length-1)]));
    this.reconnectAttempt+=1;
    this.setStatus({ state:'retrying', connected:false });
    this.timer=setTimeout(() => this.connect(), delay);
    this.timer.unref?.();
  }

  disconnect() {
    this.manualStop=true;
    clearTimeout(this.timer);
    this.timer=null;
    this.reconnectAttempt=0;
    try { this.socket?.close(); } catch {}
    this.socket=null;
    this.setStatus({ state:'stopped', connected:false, error:null });
  }

  handle(input) {
    let handled=0;
    for (const packet of packetItems(input)) {
      const normalized=normalizeTikFinityPacket(packet);
      if (!normalized) continue;
      if (normalized.kind === 'message') this.onMessage?.(normalized.value);
      else this.onEvent?.(normalized.value);
      handled+=1;
    }
    return handled;
  }
}

module.exports={ TikFinityAdapter, BACKOFF_MS, normalizeTikFinityPacket, packetItems, friendlySocketError };
