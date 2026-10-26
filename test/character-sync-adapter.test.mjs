import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { locatePob } from '../src/pob/locate.mjs';
let install; try { install=locatePob(); } catch {}
const skip=!install && 'Installed PoB required for Lua adapter tests';
let lua;
async function run(scenario) {
  if (!lua) {
    const {default:koffi}=await import('koffi'), lib=koffi.load(path.join(install.dir,'lua51.dll'));
    lua={koffi,create:lib.func('void *luaL_newstate()'),open:lib.func('void luaL_openlibs(void*)'),load:lib.func('int luaL_loadbuffer(void*,const uint8_t*,size_t,const char*)'),call:lib.func('int lua_pcall(void*,int,int,int)'),text:lib.func('void *lua_tolstring(void*,int,_Out_ size_t*)'),close:lib.func('void lua_close(void*)')};
  }
  const fwd=value=>value.split(path.sep).join('/');
  const fixture=fwd(fileURLToPath(new URL('./fixtures/character-sync.lua',import.meta.url))), module=fwd(fileURLToPath(new URL('../adapter/ops/character-sync.lua',import.meta.url)));
  const source=`package.path=${JSON.stringify(fwd(install.dir)+'/lua/?.lua;')}..package.path\nlocal json=require('dkjson')\nreturn json.encode(dofile(${JSON.stringify(fixture)})(${JSON.stringify(module)},${JSON.stringify(scenario)}))`;
  const state=lua.create(); lua.open(state);
  try {
    const bytes=Buffer.from(source); let status=lua.load(state,bytes,bytes.length,'=character-sync-test'); if(!status)status=lua.call(state,0,1,0);
    const length=[0], pointer=lua.text(state,-1,length), text=Buffer.from(lua.koffi.decode(pointer,'uint8_t',Number(length[0]))).toString('utf8'); assert.equal(status,0,text); return JSON.parse(text);
  } finally {lua.close(state);}
}
test('refresh context does not fetch account data or save a build', {skip}, async()=>{const r=await run('context'); assert.equal(r.available,true); assert.equal(r.suggested,'My Character'); assert.equal(r.network,0); assert.equal(r.writes,0);});
test('updates the same file and retains main-skill identity, weapon set and calculation conditions', {skip}, async()=>{const r=await run('success'); assert.equal(r.ok,true); assert.equal(r.disk,'UPDATED FILE'); assert.equal(r.main,2); assert.equal(r.boss,'Pinnacle'); assert.equal(r.quest,true); assert.equal(r.resistance,-40); assert.equal(r.weapon,true); assert.equal(r.writes,1);});
test('unchanged server data avoids another import and save', {skip}, async()=>{const r=await run('unchanged'); assert.equal(r.ok,true); assert.equal(r.unchanged,true); assert.equal(r.imports,1); assert.equal(r.writes,1);});
test('edits during the download are preserved without any import', {skip}, async()=>{for(const scenario of ['edited','file-edited']){const r=await run(scenario); assert.equal(r.ok,false); assert.equal(r.imports,0); assert.equal(r.writes,0); assert.equal(r.disk,scenario==='file-edited'?'USER SAVE':'ORIGINAL FILE');}});
test('missing main skills and save failures restore the previous live build and disk', {skip}, async()=>{for(const scenario of ['missing-main','save-failed']){const r=await run(scenario); assert.equal(r.ok,false); assert.equal(r.disk,'ORIGINAL FILE'); assert.equal(r.main,1); assert.equal(r.boss,'Pinnacle'); assert.equal(r.rollbacks,1); assert.equal(r.dirty,false);}});
test('refresh reuses the loaded character list and downloads it only when the character is missing', {skip}, async()=>{let r=await run('success'); assert.equal(r.network,1); r=await run('uncached'); assert.equal(r.ok,true); assert.equal(r.network,2);});
test('a rate-limited download keeps PoB on the loaded character list and imports nothing', {skip}, async()=>{const r=await run('rate-limited'); assert.equal(r.ok,false); assert.equal(r.code,'RATE_LIMITED'); assert.equal(r.mode,'SELECTCHAR'); assert.equal(r.imports,0); assert.equal(r.writes,0);});
test('a rate-limited list reload keeps the characters already loaded', {skip}, async()=>{const r=await run('rate-limited-list'); assert.equal(r.available,true); assert.equal(r.characters,1); assert.equal(r.reloadError,'RATE_LIMITED');});
