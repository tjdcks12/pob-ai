import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after,test} from 'node:test';
import {setTimeout} from 'node:timers/promises';

const home=fs.mkdtempSync(path.join(os.tmpdir(),'pobai-login-code-'));
process.env.POB_AI_HOME=home;
const {createService}=await import('../src/service/server.mjs');
const {writeJson}=await import('../src/state.mjs');
const {terminalOutput}=await import('../src/agent/terminal-output.mjs');
after(()=>fs.promises.rm(home,{recursive:true,force:true,maxRetries:20,retryDelay:25}));

test('split console title/cursor sequences do not break authorization prompts or URLs',()=>{
 const text=terminalOutput();
 const result=['Or, paste the authoriz\x1b]0;C',':\\Windows\\cmd.exe\x07ation code here:\nhttps://accounts.google.com/fixture','\x1b[4;','1HNext line'].map(text).join('');
 assert.equal(result,'Or, paste the authorization code here:\nhttps://accounts.google.com/fixture\nNext line');
});

test('Antigravity login exposes its code prompt and forwards a submitted code without saving or logging it',{skip:process.platform!=='win32'},async()=>{
 const mode=path.join(home,'auth.json'),fixture=path.join(home,'login.mjs'),command=path.join(home,'agy.cmd');
 writeJson(mode,{signedIn:false});
 fs.writeFileSync(fixture,`
  import fs from 'node:fs';import readline from 'node:readline';
  const [mode,...args]=process.argv.slice(2),state=JSON.parse(fs.readFileSync(mode,'utf8'));
  if(args[0]==='models'){if(state.signedIn){console.log('gemini-fixture-medium\\tGemini fixture (Medium)');process.exit(0);}console.error('Please sign in');process.exit(1);}
  if(!process.stdin.isTTY)throw new Error('Native Windows authentication requires a terminal');
  // Native CLI 1.4.7 prints this prompt on stderr and accepts one raw line on stdin.
  process.stderr.write('Or, paste the authoriz');
  setTimeout(()=>process.stderr.write('ation code here and press Enter:\\n'),15);
  const timer=setInterval(()=>{},1000);
  readline.createInterface({input:process.stdin}).on('line',code=>{
   if(code==='fixture-code-not-a-real-credential')fs.writeFileSync(mode,JSON.stringify({signedIn:true}));
   clearInterval(timer);process.exit(code==='fixture-code-not-a-real-credential'?0:1);
  });
 `);
 fs.writeFileSync(command,`@echo off\r\n"${process.execPath}" "${fixture}" "${mode}" %*\r\n`);
 writeJson(path.join(home,'config.json'),{agentPaths:{antigravity:command},lastUpdateCheck:Date.now()});
 const logs=[],service=await createService({port:0,log:line=>logs.push(line)});
 const request=(route,body)=>fetch(new URL(route,service.url),{headers:{authorization:'Bearer '+service.token,'content-type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})}).then(response=>response.json());
 const status=async()=> (await request('/api/agent/providers')).providers.find(provider=>provider.id==='antigravity');
 try{
  await request('/api/agent/providers/antigravity/login',{});
  let provider;
  for(let i=0;i<35;i++){provider=await status();if(provider.awaitingCode)break;await setTimeout(25);}
  assert.equal(provider.awaitingCode,true,'a visible code input must be offered while the native login is waiting');
  assert.equal(provider.signingIn,true);
  for(const code of ['', 'too-short', 'fixture-code-with\nnewlines', 'fixture-code-with\u0000control']){
   assert.equal((await request('/api/agent/providers/antigravity/login/code',{code})).error.code,'AGENT_LOGIN_CODE_INVALID');
   assert.equal((await status()).awaitingCode,true,'invalid input keeps the same native sign-in waiting');
  }
  const code='fixture-code-not-a-real-credential';
  const reply=await request('/api/agent/providers/antigravity/login/code',{code});assert.equal(reply.ok,true);
  for(let i=0;i<35;i++){provider=await status();if(provider.auth==='signed_in'&&!provider.signingIn)break;await setTimeout(25);}
  assert.equal(provider.auth,'signed_in');assert.equal(provider.awaitingCode,false);
  assert.doesNotMatch(JSON.stringify(provider)+JSON.stringify(logs)+JSON.stringify(reply),new RegExp(code));
  assert.equal(fs.existsSync(path.join(home,'agent/sessions.json')),false,'sign-in never creates a conversation');
  assert.equal((await request('/api/agent/providers/antigravity/login/code',{code})).ok,false,'a completed login does not accept another code');
 }finally{service.close();}
});
