// Child process: hosts PoB's Lua code in LuaJIT (the lua51.dll that ships with PoB) and
// answers one JSON request per stdin line. Started by engine.mjs; never run directly.
import koffi from 'koffi';
import path from 'node:path';
import readline from 'node:readline';

const [pobDir, adapterDir] = process.argv.slice(2);
process.chdir(pobDir);

const lib = koffi.load(path.join(pobDir, 'lua51.dll'));
const LUA_GLOBALSINDEX = -10002;
const lua = {
  newstate: lib.func('void *luaL_newstate()'),
  openlibs: lib.func('void luaL_openlibs(void *L)'),
  loadbuffer: lib.func('int luaL_loadbuffer(void *L, const uint8_t *buff, size_t sz, const char *name)'),
  pcall: lib.func('int lua_pcall(void *L, int nargs, int nresults, int errfunc)'),
  tolstring: lib.func('void *lua_tolstring(void *L, int idx, _Out_ size_t *len)'),
  pushlstring: lib.func('void lua_pushlstring(void *L, const uint8_t *s, size_t len)'),
  setfield: lib.func('void lua_setfield(void *L, int idx, const char *k)'),
  settop: lib.func('void lua_settop(void *L, int idx)'),
};

const L = lua.newstate();
lua.openlibs(L);

function readTop() {
  const len = [0];
  const pointer = lua.tolstring(L, -1, len);
  return pointer ? Buffer.from(koffi.decode(pointer, 'uint8_t', Number(len[0]))).toString('utf8') : '';
}

function setGlobal(name, text) {
  const bytes = Buffer.from(text, 'utf8');
  lua.pushlstring(L, bytes, bytes.length);
  lua.setfield(L, LUA_GLOBALSINDEX, name);
}

/** Runs a Lua chunk and returns its first result as a string. */
function run(source, name) {
  lua.settop(L, 0);
  const code = Buffer.from(source, 'utf8');
  let status = lua.loadbuffer(L, code, code.length, `=${name}`);
  if (status === 0) status = lua.pcall(L, 0, 1, 0);
  const value = readTop();
  lua.settop(L, 0);
  if (status !== 0) throw new Error(value);
  return value;
}

const lf = value => value.split(path.sep).join('/');
const started = Date.now();
try {
  setGlobal('POBAI_ROOT', lf(pobDir));
  setGlobal('POBAI_ADAPTER', lf(adapterDir));
  run('dofile(POBAI_ADAPTER .. "/headless.lua"); dofile(POBAI_ADAPTER .. "/core/dispatch.lua"); return "ok"', 'boot');
} catch (error) {
  process.stdout.write(JSON.stringify({ id: 0, ok: false, error: { code: 'ENGINE_START', message: String(error.message || error) } }) + '\n');
  process.exit(1);
}
process.stdout.write(JSON.stringify({ id: 0, ok: true, result: { ready: true, ms: Date.now() - started } }) + '\n');

const lines = readline.createInterface({ input: process.stdin });
lines.on('line', line => {
  if (!line.trim()) return;
  let reply;
  try {
    setGlobal('POBAI_REQUEST', line);
    reply = run('return pobai_dispatch(POBAI_REQUEST)', 'dispatch');
  } catch (error) {
    let id = null;
    try { id = JSON.parse(line).id; } catch { /* malformed line */ }
    reply = JSON.stringify({ id, ok: false, error: { code: 'ENGINE_ERROR', message: String(error.message || error) } });
  }
  process.stdout.write(reply + '\n');
});
lines.on('close', () => process.exit(0));
