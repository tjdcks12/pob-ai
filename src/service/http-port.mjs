import { randomInt } from 'node:crypto';

// Fetch Standard: https://fetch.spec.whatwg.org/#port-blocking
// Windows can have a low dynamic port range, so listen(0) can return a blocked port.
const BLOCKED = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179,
  389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601,
  636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000,
  6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

/** Binds loopback HTTP to an address reachable by browsers and Node's fetch. */
export async function listenHttp(server, preferred = 0, { fixed = false, log = () => {} } = {}) {
  const listen = port => new Promise((resolve, reject) => {
    const failed = error => { server.removeListener('listening', ready); reject(error); };
    const ready = () => { server.removeListener('error', failed); resolve(); };
    server.once('error', failed);
    server.once('listening', ready);
    server.listen(port, '127.0.0.1');
  });
  let next = BLOCKED.has(preferred) ? 0 : preferred;
  for (let attempt = 0; attempt < 32; attempt++) {
    try { await listen(next); }
    catch (error) {
      if (!['EADDRINUSE', 'EACCES'].includes(error.code) || (fixed && next === preferred)) throw error;
      next = randomInt(49152, 65536);
      continue;
    }
    const port = server.address().port;
    if (!BLOCKED.has(port)) return port;
    log(`HTTP port ${port} is blocked by browsers; choosing another port.`);
    await new Promise(resolve => server.close(resolve));
    next = randomInt(49152, 65536);
  }
  throw new Error('No browser-accessible local HTTP port is available.');
}
