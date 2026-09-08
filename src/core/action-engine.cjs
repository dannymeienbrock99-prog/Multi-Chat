const { spawn } = require('child_process');

function expand(text, ctx = {}) {
  return String(text ?? '').replace(/\{([\w.]+)\}/g, (_m, key) => {
    const value = key.split('.').reduce((obj, part) => obj?.[part], ctx);
    return value ?? '';
  });
}

class ActionEngine {
  constructor({ getConfig, sendChat, onTts, onOverlay, onDiscord, onLog }) {
    this.getConfig = getConfig;
    this.sendChat = sendChat;
    this.onTts = onTts;
    this.onOverlay = onOverlay;
    this.onDiscord = onDiscord;
    this.onLog = onLog;
    this.commandCooldowns = new Map();
    this.poolCursor = new Map();
    this.poolLast = new Map();
  }

  async handleMessage(message) {
    const cfg = this.getConfig();
    for (const cmd of cfg.commands || []) {
      if (cmd.enabled === false) continue;
      const platform = String(cmd.platform || 'all').toLowerCase();
      if (platform !== 'all' && platform !== message.platform) continue;

      const trigger = String(cmd.trigger || '').trim();
      if (!trigger) continue;
      const raw = String(message.message || '').trim();
      const match = cmd.caseSensitive
        ? raw.startsWith(trigger)
        : raw.toLowerCase().startsWith(trigger.toLowerCase());
      if (!match) continue;

      const key = `${message.platform}:${message.username}:${cmd.id || trigger}`;
      const now = Date.now();
      const until = this.commandCooldowns.get(key) || 0;
      if (now < until) continue;
      this.commandCooldowns.set(key, now + Math.max(0, Number(cmd.cooldownSeconds || 0)) * 1000);

      await this.execute(cmd.actions || [], {
        ...message,
        user: message.displayName || message.username,
        platform: message.platform,
        command: trigger,
        args: raw.slice(trigger.length).trim()
      });
    }
  }

  eventMatches(rule, evt) {
    if (rule.enabled === false) return false;
    const platform = String(rule.platform || 'all').toLowerCase();
    if (platform !== 'all' && platform !== String(evt.platform || '').toLowerCase()) return false;
    if (String(rule.event || '').toLowerCase() !== String(evt.event || '').toLowerCase()) return false;

    const data = evt.data || {};
    const matchText = String(rule.matchText || '').trim().toLowerCase();
    if (matchText) {
      const haystack = [data.giftName, data.name, data.text, data.nickname, data.uniqueId, data.username]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(matchText)) return false;
    }

    const minValue = Number(rule.minValue || 0);
    if (minValue > 0) {
      const value = Number(data.value ?? data.diamondCount ?? data.coins ?? data.amount ?? 0);
      if (value < minValue) return false;
    }
    return true;
  }

  async handleEvent(evt) {
    const cfg = this.getConfig();
    for (const rule of cfg.events || []) {
      if (!this.eventMatches(rule, evt)) continue;
      await this.execute(rule.actions || [], {
        ...evt.data,
        data: evt.data || {},
        event: evt.event,
        platform: evt.platform || evt.source || 'tiktok'
      });
    }
  }

  resolveMedia(mediaId) {
    const cfg = this.getConfig();
    return (cfg.media || []).find((item) => item.id === mediaId) || null;
  }

  resolvePool(poolId) {
    const cfg = this.getConfig();
    const pool = (cfg.mediaPools || []).find((item) => item.id === poolId);
    if (!pool) throw new Error('Medien-Pool nicht gefunden.');
    const media = (pool.mediaIds || []).map((id) => this.resolveMedia(id)).filter(Boolean);
    if (!media.length) throw new Error(`Medien-Pool "${pool.name || pool.id}" ist leer.`);

    let selected;
    if ((pool.mode || 'random') === 'sequence') {
      const index = this.poolCursor.get(pool.id) || 0;
      selected = media[index % media.length];
      this.poolCursor.set(pool.id, (index + 1) % media.length);
    } else {
      const previous = this.poolLast.get(pool.id);
      const candidates = pool.avoidRepeat && media.length > 1
        ? media.filter((item) => item.id !== previous)
        : media;
      selected = candidates[Math.floor(Math.random() * candidates.length)];
      this.poolLast.set(pool.id, selected.id);
    }

    return { pool, media: selected };
  }

  async execute(actions, ctx = {}) {
    for (const action of actions) {
      try {
        const type = String(action.type || '').toLowerCase();
        if (type === 'delay') {
          const ms = Math.max(0, Number(action.ms || Number(action.seconds || 0) * 1000));
          await new Promise((resolve) => setTimeout(resolve, ms));
        } else if (type === 'chat') {
          const platform = action.platform === 'same' || !action.platform ? ctx.platform : action.platform;
          await this.sendChat?.(platform, expand(action.text, ctx));
        } else if (type === 'tts') {
          this.onTts?.({
            text: expand(action.text || ctx.message || '', ctx),
            voice: action.voice || '',
            rate: action.rate || 1,
            pitch: action.pitch || 1,
            volume: action.volume ?? 1
          });
        } else if (type === 'overlay') {
          this.onOverlay?.({
            type: action.eventType || 'custom',
            data: { ...ctx, text: expand(action.text || '', ctx) }
          });
        } else if (type === 'media') {
          const media = this.resolveMedia(action.mediaId);
          if (!media) throw new Error('Medium nicht gefunden.');
          this.onOverlay?.({
            type: 'media',
            data: {
              ...ctx,
              mediaId: media.id,
              mediaName: media.name,
              mediaType: media.type,
              volume: action.volume ?? 1,
              durationSeconds: action.durationSeconds || 0
            }
          });
        } else if (type === 'mediapool' || type === 'media_pool') {
          const resolved = this.resolvePool(action.poolId);
          this.onOverlay?.({
            type: 'media',
            data: {
              ...ctx,
              poolId: resolved.pool.id,
              mediaId: resolved.media.id,
              mediaName: resolved.media.name,
              mediaType: resolved.media.type,
              volume: action.volume ?? resolved.pool.volume ?? 1,
              durationSeconds: action.durationSeconds || resolved.pool.durationSeconds || 0
            }
          });
        } else if (type === 'hotkey') {
          await this.hotkey(action);
        } else if (type === 'discord') {
          await this.onDiscord?.(expand(action.text || '', ctx));
        }
      } catch (error) {
        this.onLog?.('ERROR', 'Automation', error.message, { action, ctx });
      }
    }
  }

  hotkey(action) {
    if (process.platform !== 'win32') throw new Error('Hotkeys werden nur unter Windows ausgeführt.');
    const keys = String(action.keys || '').trim();
    const target = String(action.process || '').trim();
    if (!keys) throw new Error('Hotkey fehlt.');
    if (!target) throw new Error('Zielprozess für Hotkey fehlt.');

    const safeTarget = target.replace(/'/g, "''");
    const safeKeys = keys.replace(/'/g, "''");
    const ps = `$p=Get-Process -Name '${safeTarget}' -ErrorAction SilentlyContinue | Select-Object -First 1; if(-not $p){exit 7}; $w=New-Object -ComObject WScript.Shell; if(-not $w.AppActivate($p.Id)){exit 8}; Start-Sleep -Milliseconds 100; $w.SendKeys('${safeKeys}')`;
    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true });
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Hotkey fehlgeschlagen (Code ${code})`)));
      child.on('error', reject);
    });
  }
}

module.exports = { ActionEngine, expand };
