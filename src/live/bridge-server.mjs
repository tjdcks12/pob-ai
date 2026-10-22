// Local TCP endpoint the PoB window connects to (adapter/live/bridge.lua).
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import readline from 'node:readline';

export class BridgeServer extends EventEmitter {
  constructor({ log = () => {}, token = randomBytes(18).toString('hex') } = {}) {
    super();
    this.log = log;
    this.token = token;
    this.socket = null;
    this.info = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  get connected() { return Boolean(this.socket); }

  /** Listens on `port` when it is free, otherwise on any free port. */
  async listen(port = 0) {
    this.server = net.createServer(socket => this.#accept(socket));
    const attempt = p => new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(p, '127.0.0.1', () => {
        this.server.removeListener('error', reject);
        resolve(this.server.address().port);
      });
    });
    try { this.port = await attempt(port); } catch (error) {
      if (!port || error.code !== 'EADDRINUSE') throw error;
      this.port = await attempt(0);
    }
    return this.port;
  }

  #accept(socket) {
    socket.setNoDelay(true);
    let authed = false;
    const lines = readline.createInterface({ input: socket });
    const timer = setTimeout(() => { if (!authed) socket.destroy(); }, 5000);
    lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (!authed) {
        if (message.type !== 'hello' || message.token !== this.token) { socket.destroy(); return; }
        authed = true;
        clearTimeout(timer);
        this.socket?.destroy();
        this.socket = socket;
        this.info = { version: message.version, connectedAt: new Date().toISOString() };
        this.log(`PoB window connected (PoB ${message.version})`);
        this.emit('connected', this.info);
        return;
      }
      if (message.type === 'event') { this.emit('event', message.event); return; }
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.ok) waiter.resolve(message.result);
      else waiter.reject(Object.assign(new Error(message.error?.message || 'PoB error'), message.error));
    });
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.info = null;
      for (const waiter of this.pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(Object.assign(new Error('The PoB window was closed.'), { code: 'LIVE_CLOSED' }));
      }
      this.pending.clear();
      this.emit('disconnected');
    });
    // A PoB window that is ended abruptly resets the connection; 'close' handles the cleanup.
    socket.on('error', () => {});
    lines.on('error', () => {});
  }

  /** Sends a one-way message to the PoB window (e.g. a rendered text image). */
  send(message) {
    if (this.socket) this.socket.write(`${JSON.stringify(message)}\n`);
  }

  /** Runs an operation inside the PoB window. PoB answers between frames. */
  call(op, args = {}, { timeoutMs = 60000 } = {}) {
    if (!this.socket) return Promise.reject(Object.assign(new Error('The PoB window is not connected.'), { code: 'LIVE_UNAVAILABLE' }));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error(`PoB did not answer ${op} in time.`), { code: 'LIVE_TIMEOUT' }));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(JSON.stringify({ id, op, args }) + '\n');
    });
  }

  close() {
    this.socket?.destroy();
    this.server?.close();
  }
}
