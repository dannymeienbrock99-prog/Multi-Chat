const PRESETS = Object.freeze({
  'tiktok-vertical': {
    id: 'tiktok-vertical',
    width: 1080,
    height: 1920,
    fps: 60,
    videoBitrateKbps: 12000,
    audioSampleRate: 48000,
    audioChannels: 2
  },
  'twitch-1080p': {
    id: 'twitch-1080p',
    width: 1920,
    height: 1080,
    fps: 60,
    videoBitrateKbps: 8500,
    audioSampleRate: 48000,
    audioChannels: 2
  },
  'youtube-1080p': {
    id: 'youtube-1080p',
    width: 1920,
    height: 1080,
    fps: 60,
    videoBitrateKbps: 12000,
    audioSampleRate: 48000,
    audioChannels: 2
  },
  'ultrawide-5120x1440-split': {
    id: 'ultrawide-5120x1440-split',
    width: 5120,
    height: 1440,
    fps: 60,
    regions: [
      { x: 0, y: 0, width: 1706, height: 1440 },
      { x: 1706, y: 0, width: 1706, height: 1440 },
      { x: 3412, y: 0, width: 1708, height: 1440 }
    ]
  }
});

function getPreset(id) {
  return PRESETS[id] ? structuredClone(PRESETS[id]) : null;
}

module.exports = { PRESETS, getPreset };
