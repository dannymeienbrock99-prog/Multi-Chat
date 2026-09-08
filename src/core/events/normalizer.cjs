const { SCHEMA_VERSION, makeEventId, safeString, validateNormalizedEvent } = require('./event-schema.cjs');

function normalizePlatform(value) {
  const p = safeString(value || 'internal').toLowerCase();
  if (p.includes('tiktok')) return 'tiktok';
  if (p.includes('twitch')) return 'twitch';
  if (p.includes('youtube')) return 'youtube';
  if (p.includes('cng')) return 'cng';
  return 'internal';
}

function normalizeType(value, fallback = 'custom') {
  const t = safeString(value || fallback).toLowerCase();
  if (t === 'comment' || t === 'message') return 'chat';
  if (t === 'subscribe' || t === 'subscription' || t === 'resub') return 'sub';
  if (['chat', 'gift', 'follow', 'like', 'sub', 'moderation', 'system', 'command', 'custom'].includes(t)) return t;
  return fallback;
}

function normalizeUser(input = {}) {
  const user = input.user && typeof input.user === 'object' ? input.user : input;
  const username = safeString(user.username || user.uniqueId || user.login || user.name || user.author || input.username || 'unknown');
  const displayName = safeString(user.displayName || user.nickname || user.authorName || input.displayName || username);
  return {
    id: safeString(user.id || user.userId || user.user_id || input.userId || username),
    username,
    displayName,
    avatar: safeString(user.avatar || user.avatarUrl || user.profilePictureUrl || ''),
    badges: Array.isArray(user.badges) ? user.badges : Array.isArray(input.badges) ? input.badges : [],
    isModerator: Boolean(user.isModerator || user.moderator || user.mod || input.isModerator || input.moderator || input.mod)
  };
}

function normalizeChat(input = {}, sourceConnector = 'unknown') {
  const platform = normalizePlatform(input.platform || input.source || sourceConnector);
  const text = safeString(input.message?.text || input.message || input.text || input.comment || input.msg || '').trim();
  const timestamp = input.timestamp && !Number.isNaN(Date.parse(input.timestamp)) ? new Date(input.timestamp).toISOString() : new Date().toISOString();
  const user = normalizeUser(input);
  const sourceId = input.id || input.eventId || input.messageId;
  const event = {
    schemaVersion: SCHEMA_VERSION,
    eventId: makeEventId(platform, 'chat', sourceId, `${timestamp}|${user.id}|${text}`),
    platform,
    type: 'chat',
    timestamp,
    user,
    message: { text, emotes: Array.isArray(input.emotes) ? input.emotes : [], reply: input.reply || null },
    gift: null,
    moderation: null,
    meta: {
      sourceConnector,
      receivedAt: new Date().toISOString(),
      rawData: input.raw || input
    }
  };
  const validation = validateNormalizedEvent(event);
  if (!validation.ok) throw new Error(`Event-Validierung fehlgeschlagen: ${validation.errors.join(' ')}`);
  return event;
}

function normalizeEvent(input = {}, sourceConnector = 'unknown') {
  if (input.schemaVersion === SCHEMA_VERSION && input.eventId && input.meta) {
    const validation = validateNormalizedEvent(input);
    if (!validation.ok) throw new Error(`Event-Validierung fehlgeschlagen: ${validation.errors.join(' ')}`);
    return input;
  }

  const platform = normalizePlatform(input.platform || input.source || sourceConnector);
  const type = normalizeType(input.type || input.event, 'custom');
  if (type === 'chat') return normalizeChat(input.data && typeof input.data === 'object' ? { ...input.data, platform } : input, sourceConnector);

  const data = input.data && typeof input.data === 'object' ? input.data : input;
  const timestamp = input.timestamp && !Number.isNaN(Date.parse(input.timestamp)) ? new Date(input.timestamp).toISOString() : new Date().toISOString();
  const user = normalizeUser(data);
  const sourceId = input.id || input.eventId || data.id || data.eventId || data.msgId;
  const gift = type === 'gift' ? {
    id: safeString(data.giftId || data.gift?.id || data.id || ''),
    name: safeString(data.giftName || data.gift?.name || data.name || 'Gift'),
    count: Math.max(1, Number(data.count || data.repeatCount || data.gift?.count || 1)),
    value: Number.isFinite(Number(data.value ?? data.coins ?? data.diamondCount)) ? Number(data.value ?? data.coins ?? data.diamondCount) : null,
    currency: safeString(data.currency || '') || null
  } : null;
  const moderation = type === 'moderation' ? {
    action: safeString(data.action || ''),
    target: data.target || null,
    moderator: data.moderator || null,
    reason: safeString(data.reason || ''),
    duration: Number.isFinite(Number(data.duration)) ? Number(data.duration) : null
  } : null;
  const seed = `${timestamp}|${user.id}|${type}|${JSON.stringify(gift || moderation || data.text || '')}`;
  const event = {
    schemaVersion: SCHEMA_VERSION,
    eventId: makeEventId(platform, type, sourceId, seed),
    platform,
    type,
    timestamp,
    user,
    message: data.message || data.text || data.comment ? { text: safeString(data.message?.text || data.message || data.text || data.comment), emotes: [], reply: null } : null,
    gift,
    moderation,
    meta: {
      sourceConnector,
      receivedAt: new Date().toISOString(),
      rawData: input.raw || input
    }
  };
  const validation = validateNormalizedEvent(event);
  if (!validation.ok) throw new Error(`Event-Validierung fehlgeschlagen: ${validation.errors.join(' ')}`);
  return event;
}

module.exports = { normalizePlatform, normalizeType, normalizeUser, normalizeChat, normalizeEvent };
