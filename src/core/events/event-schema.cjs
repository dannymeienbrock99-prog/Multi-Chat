const crypto = require('crypto');

const SCHEMA_VERSION = 1;
const PLATFORMS = new Set(['tiktok', 'twitch', 'youtube', 'cng', 'internal']);
const TYPES = new Set(['chat', 'gift', 'follow', 'like', 'sub', 'moderation', 'system', 'command', 'custom', 'share', 'raid', 'stream_start', 'stream_end']);

function safeString(value, fallback = '') {
  return value === undefined || value === null ? fallback : String(value);
}

function makeEventId(platform, type, sourceId, seed = '') {
  if (sourceId) return `${platform}:${type}:${safeString(sourceId)}`;
  const digest = crypto.createHash('sha256').update(`${platform}|${type}|${seed}`).digest('hex').slice(0, 24);
  return `${platform}:${type}:${digest}`;
}

function validateNormalizedEvent(event) {
  const errors = [];
  if (!event || typeof event !== 'object') return { ok: false, errors: ['Event fehlt oder ist kein Objekt.'] };
  if (event.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion muss ${SCHEMA_VERSION} sein.`);
  if (!safeString(event.eventId).trim()) errors.push('eventId fehlt.');
  if (!PLATFORMS.has(event.platform)) errors.push(`platform ungültig: ${event.platform}`);
  if (!TYPES.has(event.type)) errors.push(`type ungültig: ${event.type}`);
  if (Number.isNaN(Date.parse(event.timestamp))) errors.push('timestamp ist keine gültige ISO-8601-Zeit.');
  if (!event.meta || typeof event.meta !== 'object') errors.push('meta fehlt.');
  if (event.type === 'chat' && !safeString(event.message?.text).trim()) errors.push('chat benötigt message.text.');
  return { ok: errors.length === 0, errors };
}

module.exports = {
  SCHEMA_VERSION,
  PLATFORMS,
  TYPES,
  makeEventId,
  validateNormalizedEvent,
  safeString
};
