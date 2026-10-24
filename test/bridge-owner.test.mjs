import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import { test } from 'node:test';
import { BridgeServer } from '../src/live/bridge-server.mjs';

test('the authenticated bridge identifies the connected PoB process and clears it on disconnect', async () => {
  const bridge = new BridgeServer();
  await bridge.listen();
  const socket = net.connect(bridge.port, '127.0.0.1');
  try {
    await once(socket, 'connect');
    const connected = once(bridge, 'connected');
    socket.write(JSON.stringify({ type: 'hello', token: bridge.token, version: '0.23.1', pid: 1234 }) + '\n');
    const [info] = await connected;
    assert.equal(info.pid, 1234);
    const disconnected = once(bridge, 'disconnected');
    socket.end();
    await disconnected;
    assert.equal(bridge.info, null);
  } finally { socket.destroy(); bridge.close(); }
});

test('legacy or malformed process identity never becomes a docking target', async () => {
  for (const pid of [undefined, '1234', -1, 0, 1.5, 2 ** 32]) {
    const bridge = new BridgeServer();
    await bridge.listen();
    const socket = net.connect(bridge.port, '127.0.0.1');
    try {
      await once(socket, 'connect');
      const connected = once(bridge, 'connected');
      socket.write(JSON.stringify({ type: 'hello', token: bridge.token, version: '0.23.1', pid }) + '\n');
      const [info] = await connected;
      assert.equal(info.pid, undefined);
    } finally { socket.destroy(); bridge.close(); }
  }
});
