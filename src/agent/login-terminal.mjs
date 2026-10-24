// A hidden ConPTY keeps Windows' native OAuth code reader working. Ordinary redirected pipes
// print the prompt but cannot deliver a code to Antigravity 1.4.7's terminal reader.
// Isolate node-pty's handles/worker in this short-lived host; its output is consumed only by
// providers.mjs and must never be logged because the console can echo an authorization code.
import { execFile } from 'node:child_process';
import readline from 'node:readline';
import pty from 'node-pty';
import { terminalOutput } from './terminal-output.mjs';

const [command, ...args] = process.argv.slice(2);
const shim = /\.(cmd|bat)$/i.test(command);
const quote = value => `"${value.replaceAll('"', '""')}"`;
const terminal = pty.spawn(shim ? process.env.ComSpec || 'cmd.exe' : command,
  shim ? `/d /s /c "${[command, ...args].map(quote).join(' ')}"` : args,
  { cwd: process.cwd(), env: process.env, cols: 16384, rows: 24, useConpty: true });

const text = terminalOutput();
terminal.onData(data => process.stdout.write(text(data)));
terminal.onExit(({ exitCode }) => process.exit(exitCode ?? 1));
readline.createInterface({ input: process.stdin }).on('line', code => terminal.write(code + '\r'));
// If the parent service disappears, terminate only this login's CLI and then its host.
process.stdin.on('end', () => execFile('taskkill', ['/PID', String(terminal.pid), '/T', '/F'],
  { windowsHide: true }, () => process.exit(1)));
