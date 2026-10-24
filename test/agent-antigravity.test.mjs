import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, test} from 'node:test';
import {setTimeout} from 'node:timers/promises';

const home=fs.mkdtempSync(path.join(os.tmpdir(),'pobai-antigravity-test-'));
process.env.POB_AI_HOME=home;
const {createService}=await import('../src/service/server.mjs');
const {writeJson}=await import('../src/state.mjs');
const {buildTurn,parseAntigravityLine,effortFor}=await import('../src/agent/hub.mjs');
const {antigravityCatalog,antigravityLoginUrl,antigravityVersionSupported,candidates,validEffort}=await import('../src/agent/providers.mjs');
after(()=>fs.rmSync(home,{recursive:true,force:true}));

test('Antigravity discovery finds agy and does not confuse the IDE launcher with its CLI',()=>{
 const local=path.join(home,'discovery'),bin=path.join(local,'agy/bin');fs.mkdirSync(bin,{recursive:true});
 const agy=path.join(bin,'agy.exe');fs.writeFileSync(agy,'fixture');
 fs.writeFileSync(path.join(bin,'antigravity.cmd'),'fixture IDE launcher');
 const found=candidates('antigravity',{USERPROFILE:home,LOCALAPPDATA:local,APPDATA:local,PATH:bin});
 assert.deepEqual(found,[agy]);
 assert.equal(antigravityVersionSupported('1.4.3'),false);
 for(const version of ['1.4.4','1.4.7','1.10.0','2.0.0'])assert.equal(antigravityVersionSupported(version),true);
 for(const effort of ['low','medium','high','xhigh','max'])assert.equal(validEffort('antigravity',effort),true);
 for(const effort of ['none','minimal','ultra','shell'])assert.equal(validEffort('antigravity',effort),false);
});

test('Antigravity models are grouped from the native tab-separated catalog, with actual effort availability',()=>{
 const models=antigravityCatalog('Fetching models...\ngemini-fixture-high\tGemini fixture (High)\ngemini-fixture-medium\tGemini fixture (Medium)\ngemini-fixture-low\tGemini fixture (Low)\ngemini-pro-high  Gemini Pro (High)\ngemini-pro-low  Gemini Pro (Low)\nprivate@example.com  Private\n');
 assert.deepEqual(models,[{id:'gemini-fixture-medium',name:'Gemini fixture',efforts:['low','medium','high'],defaultEffort:'medium'}, {id:'gemini-pro-high',name:'Gemini Pro',efforts:['low','high'],defaultEffort:'high'}]);
 assert.equal(effortFor({provider:'antigravity',model:'gemini-pro-high'},models),'high');
});

test('Antigravity turns keep language, images and conversations in stdin and grant full access only when selected',()=>{
 assert.equal(buildTurn({provider:'antigravity',text:'Use my CLI default'}).args.includes('--effort'),false,'a default model may not support medium');
 for(const fullAccess of [undefined,false,true,'true']){
  const turn=buildTurn({provider:'antigravity',providerSessionId:'native-chat',model:'gemini-fixture-medium',effort:'high',locale:'ko',text:'/a user prompt',fullAccess,images:[{path:'C:\\images with spaces\\one.png',mediaType:'image/png'}]});
  assert.equal(turn.args.includes('--dangerously-skip-permissions'),fullAccess===true);
  assert.equal(turn.args.includes('--sandbox'),fullAccess!==true);
  assert.equal(turn.args.includes('--mode'),fullAccess!==true);
  assert.equal(turn.args[turn.args.indexOf('--conversation')+1],'native-chat');
  assert.equal(turn.args[turn.args.indexOf('--model')+1],'gemini-fixture');
  assert.equal(turn.args[turn.args.indexOf('--effort')+1],'high');
  assert.ok(turn.args.includes('--disable-slash-commands'));
  const input=JSON.parse(turn.input);assert.equal(input.event,'user');
  assert.match(input.message.content,/interface language is ko/);
  assert.match(input.message.content,/@"C:\/images with spaces\/one.png"/);
  assert.equal(turn.args.includes('/a user prompt'),false);
 }
});

test('Antigravity streams response chunks once, keeps thinking private, and reports permission denials as failures',()=>{
 const state={};
 assert.deepEqual(parseAntigravityLine({event:'init',conversation_id:'native-chat'},state),[{type:'session',providerSessionId:'native-chat'}]);
 assert.deepEqual(parseAntigravityLine({event:'step_update',step_update:{step_index:1,step_type:'thinking',text_delta:'private reasoning'}},state),[]);
 const first=parseAntigravityLine({event:'step_update',step_update:{step_index:2,state:'ACTIVE',step_type:'agent_response',text_delta:'안녕'}},state);
 const last=parseAntigravityLine({event:'step_update',step_update:{step_index:2,state:'DONE',step_type:'agent_response',text_delta:'하세요'}},state);
 assert.equal(first[0].id,last[0].id);assert.equal(first[0].partial,true);assert.equal(last[0].partial,true);
 const final=parseAntigravityLine({event:'result',result:{status:'SUCCESS',response:'안녕하세요',conversation_id:'native-chat'}},state);
 assert.equal(final[0].text,undefined,'final summary must not duplicate streamed messages');
 assert.equal(parseAntigravityLine({event:'result',result:{status:'SUCCESS',response:'fallback'}})[0].text,'fallback');
 assert.equal(parseAntigravityLine({event:'result',result:{status:'SUCCESS',denied_actions:['run_command']}})[0].ok,false);
 const tool=parseAntigravityLine({event:'step_update',step_update:{step_type:'tool',tool_info:{name:'run_command',parameters:{CommandLine:'pob calc stats'}}}});
 assert.equal(tool[0].command,'pob calc stats');
});

test('only a Google OAuth authorization URL from the CLI can be opened',()=>{
 assert.ok(antigravityLoginUrl('Sign in: https://accounts.google.com/o/oauth2/auth?response_type=code&client_id=fixture'));
 for(const url of ['https://accounts.google.com.evil.example/o/oauth2/auth?response_type=code','https://accounts.google.com@evil.example/o/oauth2/auth?response_type=code','file:///C:/fixture.exe','https://accounts.google.com/other?response_type=code','https://evil.example/'])assert.equal(antigravityLoginUrl(url),null);
});

test('Antigravity uses the shared HTTP/SSE session, image, permissions, stop and history lifecycle',{skip:process.platform!=='win32'},async()=>{
 const mode=path.join(home,'mode.json'),calls=path.join(home,'calls.jsonl'),script=path.join(home,'fixture.mjs'),command=path.join(home,'agy.cmd');
 writeJson(mode,{version:'1.4.7'});
 fs.writeFileSync(script,`
  import fs from 'node:fs';import {randomUUID} from 'node:crypto';
  const [mode,calls,...args]=process.argv.slice(2),config=JSON.parse(fs.readFileSync(mode,'utf8'));
  if(args[0]==='--version'){console.log(config.version);process.exit(0);}
  if(args[0]==='models'){
   if(config.auth==='signed_out'){console.error('Please sign in to view available models. Launch the CLI without arguments to sign in.');process.exit(1);}
   console.log('gemini-fixture-high\\tGemini fixture (High)\\ngemini-fixture-medium\\tGemini fixture (Medium)\\ngemini-fixture-low\\tGemini fixture (Low)\\ngemini-pro-high\\tGemini Pro (High)\\ngemini-pro-low\\tGemini Pro (Low)');process.exit(0);
  }
  let input='';for await(const part of process.stdin)input+=part;
  fs.appendFileSync(calls,JSON.stringify({args,input})+'\\n');
  const message=JSON.parse(input).message.content,id=args.includes('--conversation')?args[args.indexOf('--conversation')+1]:randomUUID();
  const emit=value=>console.log(JSON.stringify(value));emit({event:'init',conversation_id:id});
  emit({event:'step_update',step_update:{step_type:'tool',tool_info:{name:'run_command',parameters:{CommandLine:'pob calc stats'}}}});
  emit({event:'step_update',step_update:{step_index:2,state:'ACTIVE',step_type:'agent_response',text_delta:'Fixture '}});
  if(message.includes('hold')){setInterval(()=>{},1000);}else{
   emit({event:'step_update',step_update:{step_index:2,state:'DONE',step_type:'agent_response',text_delta:'reply'}});
   emit({event:'result',result:{status:'SUCCESS',conversation_id:id,response:'Fixture reply',...(message.includes('deny')?{denied_actions:['run_command']}:{})}});
  }
 `);
 fs.writeFileSync(command,`@echo off\r\n"${process.execPath}" "${script}" "${mode}" "${calls}" %*\r\n`);
 writeJson(path.join(home,'config.json'),{agentPaths:{antigravity:command},lastUpdateCheck:Date.now()});
 let service=await createService({port:0,log:()=>{}});
 const request=(route,body)=>fetch(new URL(route,service.url),{headers:{authorization:'Bearer '+service.token,'content-type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 const turn=async body=>{
  const response=await request('/api/agent/chat',{provider:'antigravity',message:'fixture',...body});assert.equal(response.status,200);
  return (await response.text()).split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)));
 };
 try{
  const catalog=await request('/api/agent/providers/antigravity/models').then(response=>response.json());assert.equal(catalog.models.length,2);
  const image=Buffer.from('89504e470d0a1a0a00000000','hex');
  const events=await turn({model:'gemini-fixture-medium',effort:'high',locale:'ko',images:[{name:'fixture.png',dataUrl:'data:image/png;base64,'+image.toString('base64')}]});
  const id=events.find(event=>event.type==='start').sessionId;
  assert.ok(events.some(event=>event.type==='phase'&&event.phase==='calculate'));
  assert.equal(events.filter(event=>event.type==='text').map(event=>event.text).join(''),'Fixture reply');
  const saved=await request('/api/agent/sessions/'+id).then(response=>response.json());
  assert.equal(saved.session.provider,'antigravity');assert.equal(saved.session.fullAccess,false);assert.equal(saved.session.messages[1].text,'Fixture reply');
  const attachment=saved.session.messages[0].images[0];
  assert.deepEqual(Buffer.from(await request('/api/agent/sessions/'+id+'/images/'+attachment.id).then(response=>response.arrayBuffer())),image);
  await turn({sessionId:id,fullAccess:true});await turn({sessionId:id,fullAccess:false});
  const recorded=fs.readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(recorded[1].args.includes(saved.session.providerSessionId),true);
  assert.equal(recorded[1].args.includes('--dangerously-skip-permissions'),true);
  assert.equal(recorded[2].args.includes('--dangerously-skip-permissions'),false);
  assert.equal(recorded[2].args.includes('--sandbox'),true);
  const denied=await turn({sessionId:id,message:'deny'});assert.equal(denied.find(event=>event.type==='error').code,'AGENT_PERMISSIONS');
  const response=await request('/api/agent/chat',{provider:'antigravity',message:'hold'}),reader=response.body.getReader(),decoder=new TextDecoder();let partial='';
  while(!partial.includes('Fixture ')){const next=await reader.read();assert.equal(next.done,false);partial+=decoder.decode(next.value);}
  const heldId=JSON.parse(partial.split('\n').find(line=>line.startsWith('data: ')).slice(6)).sessionId;
  await request('/api/agent/stop',{sessionId:heldId});
  for(;;){const next=await reader.read();if(next.done)break;partial+=decoder.decode(next.value);}
  assert.match(partial,/"delivery":"interrupted"/);
  assert.equal(service.agents.running.size,0);
  service.close();service=await createService({port:0,log:()=>{}});
  const restored=await request('/api/agent/sessions/'+id).then(response=>response.json());assert.equal(restored.session.providerSessionId,saved.session.providerSessionId);
  const before=service.agents.sessions.length;writeJson(mode,{version:'1.4.3'});
  const outdated=await request('/api/agent/chat',{provider:'antigravity',message:'must not call a model'}).then(response=>response.json());
  assert.equal(outdated.error.code,'AGENT_OUTDATED');assert.equal(outdated.error.diagnostic.updateCommand,'agy update');assert.equal(service.agents.sessions.length,before);
  writeJson(mode,{version:'1.4.7',auth:'signed_out'});
  const messages=restored.session.messages.length,callCount=fs.readFileSync(calls,'utf8').trim().split('\n').length;
  const signedOut=await request('/api/agent/chat',{sessionId:id,message:'must not wait for hidden OAuth'}).then(response=>response.json());
  assert.equal(signedOut.error.code,'AGENT_SIGNED_OUT');
  assert.equal(service.agents.sessions.find(session=>session.id===id).messages.length,messages);
  assert.equal(fs.readFileSync(calls,'utf8').trim().split('\n').length,callCount,'signed-out conversations never launch a model or hidden OAuth wait');
 }finally{service.close();}
});
