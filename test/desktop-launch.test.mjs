import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-desktop-'));
const run = promisify(execFile);
const compiler = path.join(process.env.SystemRoot || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
after(async () => {
  // Windows can retain the executable image briefly after the fixture's PID exits.
  for (let attempt = 0; ; attempt++) {
    try { await fs.promises.rm(home, { recursive: true, force: true }); return; }
    catch (error) { if (attempt >= 40 || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error; }
    await setTimeout(50);
  }
});

test('a closed panel can reacquire an existing mutex; an active panel still owns it', { skip: process.platform !== 'win32' }, async () => {
  const driver = path.join(home, 'lock.cs'), exe = path.join(home, 'lock.exe');
  fs.writeFileSync(driver, `
    using System; using System.Threading;
    class Driver {
      static int Main() {
        string id = Guid.NewGuid().ToString("N");
        using (var staleHandle = new Mutex(false, @"Local\\PoBAI.Panel." + id)) {
          using (var first = new PanelInstance(id)) {
            if (!first.IsOwner) return 1;
            bool secondOwned = true;
            var thread = new Thread(() => { using (var second = new PanelInstance(id)) secondOwned = second.IsOwner; });
            thread.Start(); thread.Join(); if (secondOwned) return 2;
          }
          using (var reopened = new PanelInstance(id)) if (!reopened.IsOwner) return 3;
        }
        return 0;
      }
    }
  `);
  await run(compiler, ['/nologo', '/out:' + exe, driver, path.join(root, 'desktop/PanelInstance.cs')], { windowsHide: true });
  await run(exe, [], { windowsHide: true });
});

const build = process.env.POB_AI_NATIVE_BUILD || root;
test('the desktop launcher starts bundled Node without a console and forwards recovery flags', {
  skip: process.platform !== 'win32' || !fs.existsSync(path.join(build, 'PoB AI.exe')),
}, async () => {
  const dir = path.join(home, 'portable app with spaces');
  fs.mkdirSync(path.join(dir, 'runtime/node'), { recursive: true });
  fs.copyFileSync(path.join(build, 'PoB AI.exe'), path.join(dir, 'PoB AI.exe'));
  fs.copyFileSync(process.execPath, path.join(dir, 'runtime/node/node.exe'));
  const marker = path.join(dir, 'launched.json');
  fs.writeFileSync(path.join(dir, 'launcher.mjs'), `
    import fs from 'node:fs';
    const { default: koffi } = await import(${JSON.stringify(new URL('../node_modules/koffi/index.js', import.meta.url).href)});
    const consoleWindow = koffi.load('kernel32.dll').func('void* GetConsoleWindow()')();
    fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({pid:process.pid,console: !!consoleWindow, args:process.argv.slice(2)}));
  `);
  await run(path.join(dir, 'PoB AI.exe'), ['--panel-only'], { windowsHide: true });
  for (let i = 0; i < 80 && !fs.existsSync(marker); i++) await setTimeout(25);
  assert.ok(fs.existsSync(marker), 'the hidden launcher actually ran Node');
  const result = JSON.parse(fs.readFileSync(marker, 'utf8'));
  assert.equal(result.console, false, 'users never need to keep a Node console window open');
  assert.ok(result.args.includes('--panel-only') && result.args.includes('--quiet'));
  assert.ok(!result.args.includes('--open'), 'AI recovery never opens a second PoB window');
  for (let i = 0; i < 80; i++) {
    try { process.kill(result.pid, 0); } catch { return; }
    await setTimeout(25);
  }
  assert.fail('the launcher fixture did not exit');
});
