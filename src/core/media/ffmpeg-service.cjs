const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ENCODERS = ['h264_nvenc', 'h264_amf', 'h264_qsv', 'libx264'];

function runProcess(command, args, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill('SIGKILL'); } catch {}
      const err = new Error(`Prozess-Timeout nach ${timeoutMs} ms: ${command}`);
      err.code = 'PROCESS_TIMEOUT';
      reject(err);
    }, Math.max(500, Number(timeoutMs || 5000)));
    child.stdout?.on('data', (d) => { stdout += d.toString('utf8'); if (stdout.length > 1024 * 1024) stdout = stdout.slice(-1024 * 1024); });
    child.stderr?.on('data', (d) => { stderr += d.toString('utf8'); if (stderr.length > 1024 * 1024) stderr = stderr.slice(-1024 * 1024); });
    child.on('error', (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

class FFmpegService {
  constructor({ ffmpegPath = 'auto', onStatus, onLog } = {}) {
    this.ffmpegPath = ffmpegPath || 'auto';
    this.onStatus = onStatus;
    this.onLog = onLog;
    this.process = null;
    this.status = {
      state: 'DEGRADED',
      path: '',
      version: '',
      encoders: [],
      selectedEncoder: '',
      pid: null,
      uptimeMs: 0,
      lastStderr: '',
      error: null
    };
    this.startedAt = null;
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch, uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0 };
    this.onStatus?.(this.getStatus());
  }

  getStatus() { return { ...this.status, uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0 }; }

  candidates() {
    if (this.ffmpegPath && this.ffmpegPath !== 'auto') return [this.ffmpegPath];
    const list = ['ffmpeg'];
    if (process.platform === 'win32') {
      const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean);
      for (const root of roots) {
        list.push(path.join(root, 'ffmpeg', 'bin', 'ffmpeg.exe'));
        list.push(path.join(root, 'FFmpeg', 'bin', 'ffmpeg.exe'));
      }
    }
    return [...new Set(list)];
  }

  async detect() {
    let lastError;
    for (const candidate of this.candidates()) {
      if (candidate !== 'ffmpeg' && !fs.existsSync(candidate)) continue;
      try {
        const result = await runProcess(candidate, ['-version'], { timeoutMs: 4000 });
        if (result.code !== 0) throw new Error(result.stderr || `FFmpeg exit ${result.code}`);
        const firstLine = (result.stdout || result.stderr).split(/\r?\n/).find(Boolean) || '';
        this.ffmpegPath = candidate;
        this.setStatus({ state: 'CONNECTED', path: candidate, version: firstLine, error: null });
        await this.detectEncoders();
        return { ok: true, status: this.getStatus() };
      } catch (error) {
        lastError = error;
      }
    }
    const message = lastError?.message || 'FFmpeg wurde nicht gefunden.';
    this.setStatus({ state: 'DEGRADED', path: '', version: '', encoders: [], selectedEncoder: '', error: message });
    return { ok: false, error: message, status: this.getStatus() };
  }

  async detectEncoders() {
    if (!this.ffmpegPath || this.ffmpegPath === 'auto') return [];
    const result = await runProcess(this.ffmpegPath, ['-hide_banner', '-encoders'], { timeoutMs: 5000 });
    const text = `${result.stdout}\n${result.stderr}`;
    const encoders = ENCODERS.filter((name) => new RegExp(`\\b${name}\\b`).test(text));
    const selectedEncoder = encoders.find((x) => x !== 'libx264') || (encoders.includes('libx264') ? 'libx264' : '');
    this.setStatus({ encoders, selectedEncoder });
    return encoders;
  }

  async testEncoder(encoder) {
    const name = String(encoder || '').trim();
    if (!ENCODERS.includes(name)) throw new Error(`Encoder ist nicht erlaubt: ${name}`);
    if (!this.ffmpegPath || this.ffmpegPath === 'auto') await this.detect();
    if (!this.ffmpegPath || this.ffmpegPath === 'auto') throw new Error('FFmpeg ist nicht verfügbar.');
    const args = ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=size=128x128:rate=30:color=black', '-frames:v', '1', '-c:v', name, '-f', 'null', '-'];
    const result = await runProcess(this.ffmpegPath, args, { timeoutMs: 8000 });
    if (result.code !== 0) {
      const err = new Error(`FFmpeg konnte Encoder ${name} nicht starten: ${(result.stderr || '').trim() || `Exit ${result.code}`}`);
      err.code = 'FFMPEG_ENCODER_FAILED';
      throw err;
    }
    this.setStatus({ selectedEncoder: name, error: null });
    return { ok: true, encoder: name };
  }

  async chooseEncoder(mode = 'auto') {
    const requested = String(mode || 'auto').toLowerCase();
    if (!this.status.encoders.length) await this.detect();
    if (requested === 'auto') {
      for (const candidate of ['h264_nvenc', 'h264_amf', 'h264_qsv', 'libx264']) {
        if (!this.status.encoders.includes(candidate)) continue;
        try { await this.testEncoder(candidate); return candidate; } catch (error) { this.onLog?.('WARN', 'FFmpeg', 'ENCODER_TEST_FAILED', { encoder: candidate, message: error.message }); }
      }
      throw new Error('Kein getesteter H.264-Encoder verfügbar.');
    }
    const map = { nvenc: 'h264_nvenc', amf: 'h264_amf', qsv: 'h264_qsv', cpu: 'libx264' };
    const encoder = map[requested] || requested;
    await this.testEncoder(encoder);
    return encoder;
  }

  start(args, { restartPolicy = 'manual' } = {}) {
    if (this.process) throw new Error('FFmpeg läuft bereits.');
    if (!Array.isArray(args)) throw new Error('FFmpeg-Argumente müssen als Array übergeben werden.');
    const unsafe = args.some((arg) => typeof arg !== 'string' || /[\u0000\r\n]/.test(arg));
    if (unsafe) throw new Error('Ungültige FFmpeg-Argumente.');
    if (!this.ffmpegPath || this.ffmpegPath === 'auto') throw new Error('FFmpeg-Pfad wurde noch nicht erkannt.');
    const child = spawn(this.ffmpegPath, args, { windowsHide: true, shell: false });
    this.process = child;
    this.startedAt = Date.now();
    this.setStatus({ state: 'CONNECTED', pid: child.pid, lastStderr: '', error: null });
    child.stderr?.on('data', (data) => {
      const lines = data.toString('utf8').trim().split(/\r?\n/).filter(Boolean);
      if (lines.length) this.setStatus({ lastStderr: lines.at(-1).slice(-2000) });
    });
    child.on('error', (error) => this.setStatus({ state: 'ERROR', error: error.message }));
    child.on('close', (code) => {
      this.process = null;
      this.startedAt = null;
      this.setStatus({ state: code === 0 ? 'DEGRADED' : 'ERROR', pid: null, error: code === 0 ? null : `FFmpeg wurde mit Code ${code} beendet.` });
      if (restartPolicy === 'once' && code !== 0) this.onLog?.('WARN', 'FFmpeg', 'PROCESS_EXIT', { code, restartPolicy });
    });
    return { ok: true, pid: child.pid };
  }

  async stop({ timeoutMs = 3000 } = {}) {
    const child = this.process;
    if (!child) return { ok: true, alreadyStopped: true };
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve({ ok: true }); };
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {}; finish(); }, Math.max(500, Number(timeoutMs || 3000)));
      child.once('close', finish);
      try { child.kill('SIGTERM'); } catch { finish(); }
    });
  }
}

module.exports = { FFmpegService, ENCODERS, runProcess };
