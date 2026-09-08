"use strict";
const { OverlayServer: BaseOverlayServer, isLoopback } = require('./overlay-server-base.cjs');

// Own the lifecycle of the HTTP/WS transport separately from page templates.
// ws forwards HTTP listen failures as its own error event; both emitters need
// listeners before the first asynchronous listen result, including EADDRINUSE.
class OverlayServer extends BaseOverlayServer {
  constructor(options) {
    super(options);
    this.networkError = null;
  }

  getStatus() {
    return { ...super.getStatus(), error: this.networkError };
  }

  async start() {
    if (this.server?.listening) return this.getStatus();
    this.networkError = null;
    const pending = super.start();
    const report = error => {
      this.networkError = { code: error.code || 'OVERLAY_NETWORK_ERROR', message: error.message };
    };
    this.server?.on('error', report);
    this.wss?.on('error', report);
    this.wss?.on('connection', socket => socket.on('error', report));
    try { await pending; return this.getStatus(); }
    catch (error) {
      report(error);
      await this.stop();
      throw error;
    }
  }

  async stop() {
    this.chatCore?.off('message', this.boundMessage);
    const wss = this.wss;
    const server = this.server;
    this.wss = null;
    this.server = null;
    this.startedAt = null;
    if (wss) {
      // Terminate owned clients so a dead browser cannot delay app shutdown.
      for (const client of wss.clients) client.terminate();
      wss.close();
    }
    if (!server) return;
    await new Promise(resolve => {
      server.close(() => resolve());
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
    });
  }
}
module.exports = { OverlayServer, isLoopback };
