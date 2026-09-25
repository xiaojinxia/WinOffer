import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fixture,basics } from './helpers.js';
import { Proposals } from '../server/agent/proposals.js';
import { AgentService } from '../server/agent/service.js';
import { validateAnalysis,candidates } from '../server/agent/extraction.js';
import { DeepSeek } from '../server/agent/deepseek.js';
import { parseMail, QQMail } from '../server/agent/mail.js';
import { createAppServer } from '../server/http.js';

const config={key:'fake-key',model:'fake',account:'fake@qq.com',password:'fake-password',demo:true};
const mailData={identity:'fake@qq.com/INBOX/1/1',subject:'二面邀请',from:'hr@example.invalid',date:'2026-09-25T08:00:00Z',body:'邀请参加二面，2026-09-28 14:00。',replyTo:'hr@example.invalid',truncated:false,attachments:[]};
const analysis={company:basics.company,role:basics.role,applicationNo:'',summary:'面试安排',events:[{stage:'二面',status:'scheduled',date:'2026-09-28',time:'14:00',location:'',meetingUrl:'',evidence:'邀请参加二面，2026-09-28 14:00。',uncertainties:''}]};
function setup(t){const f=fixture(t),store=f.open(),repo=new Proposals(store),created=store.create(basics,store.revision()),message=repo.saveMessage(mailData),p=repo.create(message.id,analysis);return {...f,store,repo,record:created.record,message,p};}
function preview(f){return f.repo.preview(f.p.id,{expectedVersion:f.repo.get(f.p.id).version,applicationId:f.record.id,operations:[{type:'node',nodeId:'stage-5',data:{status:'scheduled',date:'2026-09-28',time:'14:00'}}]});}
function confirm(f,p){return f.repo.confirm(p.id,{previewId:p.preview.id,expectedVersion:p.version});}

test('Agent 预览不写投递，包含连带变化，确认幂等且备份保留来源',t=>{
  const f=setup(t),before=f.store.snapshot(),p=preview(f);
  assert.deepEqual(f.store.snapshot(),before);assert.ok(p.preview.diff.some(d=>d.node==='投递简历'&&d.after==='passed'));assert.ok(p.preview.diff.some(d=>d.after==='skipped'));
  const result=confirm(f,p);assert.equal(result.record.nodes.find(n=>n.key===5).time,'14:00');assert.equal(f.repo.get(p.id).state,'applied');
  const history=f.store.records()[0].history.length;assert.equal(confirm(f,p).replayed,true);assert.equal(f.store.records()[0].history.length,history);
  assert.match(f.store.export().records[0].history.at(-1).text,/邮件来源/);
  assert.throws(()=>f.repo.confirm(p.id,{previewId:'different',expectedVersion:p.version}),/另一版本/);
});
test('过期预览、编辑版本冲突、未知操作不能写入',t=>{
  const f=setup(t),p=preview(f);
  f.store.change(f.record.id,{type:'basics',data:{...basics,company:'手动编辑'}},f.store.revision());
  assert.throws(()=>confirm(f,p),/变化/);assert.equal(f.repo.get(p.id).state,'pending');
  assert.throws(()=>f.repo.preview(p.id,{expectedVersion:1,applicationId:f.record.id,operations:[]}),/建议已改变/);
  assert.throws(()=>f.repo.preview(p.id,{expectedVersion:p.version,applicationId:f.record.id,operations:[{type:'end',reason:'其他原因'}]}),/节点/);
});
test('确认事务故障回滚投递、建议与审计；可以安全重试',t=>{
  const f=setup(t),p=preview(f),before=f.store.snapshot();
  f.store.db.exec("CREATE TRIGGER fail_agent BEFORE INSERT ON agent_audit BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
  assert.throws(()=>confirm(f,p),/injected/);assert.deepEqual(f.store.snapshot(),before);assert.equal(f.repo.get(p.id).state,'pending');
  f.store.db.exec('DROP TRIGGER fail_agent');assert.equal(confirm(f,p).applied,true);
});
test('恢复与删除使建议失效，邮件去重和重启持久化',t=>{
  const f=setup(t),p=preview(f);assert.equal(f.repo.saveMessage(mailData).id,f.message.id);
  f.store.restore(f.store.export(),f.store.revision());assert.equal(f.repo.get(p.id).state,'stale');assert.throws(()=>confirm(f,p));
  const p2=preview(f);f.store.remove(f.record.id,f.store.revision());assert.equal(f.repo.get(p.id).preview,null);assert.throws(()=>confirm(f,p2));
  f.store.close();const reopened=f.open();assert.equal(new Proposals(reopened).message(f.message.id).body,mailData.body);
});
test('v1 数据库升级有可打开的完整备份且不丢记录',t=>{
  const f=setup(t);f.store.db.exec('PRAGMA user_version=1');f.store.close();const reopened=f.open();
  assert.equal(reopened.db.prepare('PRAGMA user_version').get().user_version,2);
  const name=readdirSync(join(f.directory,'backups')).find(n=>n.startsWith('before-agent-'));
  assert.ok(name);const backup=new DatabaseSync(join(f.directory,'backups',name),{readOnly:true});
  assert.equal(backup.prepare('SELECT count(*) n FROM applications').get().n,1);backup.close();
});
test('无原文证据与非法链接拒绝，多个同公司岗位不自动唯一匹配',()=>{
  assert.throws(()=>validateAnalysis({...analysis,events:[{...analysis.events[0],evidence:'编造'}]},mailData),/证据/);
  assert.throws(()=>validateAnalysis({...analysis,events:[{...analysis.events[0],meetingUrl:'javascript:alert(1)'}]},mailData),/链接/);
  assert.equal(candidates({...analysis,role:''},[{...basics,id:'1'},{...basics,id:'2',role:'另一个岗位'}]).length,2);
});
test('MIME 中文正文和 HTML 可读，不输出可执行 HTML',async()=>{
  const m=await parseMail(Buffer.from('Subject: Test\r\nFrom: HR <hr@example.invalid>\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>邀请参加面试</p><script>alert(1)</script>'),'test');
  assert.match(m.body,/邀请参加面试/);assert.ok(!m.body.includes('<script>'));assert.equal(m.replyTo,'hr@example.invalid');
});
test('模型错误脱敏与真实工具请求参数',async()=>{
  let sent;const model=new DeepSeek(config,async(url,options)=>{sent=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'OK'}}]}));});
  assert.equal((await model.complete([{role:'user',content:'test'}])).content,'OK');assert.deepEqual(sent.thinking,{type:'disabled'});
  const failing=new DeepSeek(config,async()=>new Response('secret-token',{status:401}));await assert.rejects(()=>failing.complete([]),error=>!error.message.includes('secret-token')&&error.status===503);
});
test('同步和模型分析生成建议但不应用；任务请求幂等',async t=>{
  const f=fixture(t),store=f.open();store.create(basics,store.revision());const before=store.snapshot();
  const service=new AgentService(store,{config,mail:{scan:async(_i,_s,save)=>{await save(mailData);return {remaining:0};}},model:{complete:async()=>({content:JSON.stringify(analysis)})}});
  const input={requestId:'sync-1',since:'2026-09-01',until:'2026-09-30',limit:10,analyze:true,cloudConsent:true};
  const task=service.start('sync',input);assert.equal(service.start('sync',input).id,task.id);await service.settled();
  assert.equal(service.task(task.id).state,'succeeded');assert.equal(service.repo.list()[0].state,'pending');assert.deepEqual(store.snapshot(),before);
  assert.throws(()=>service.start('sync',{...input,limit:20}),/请求标识/);
});
test('Agent 多轮工具调用不能确认或读取范围外邮件',async t=>{
  const f=setup(t);let count=0;const model={complete:async messages=>{
    count++;if(count===1)return {role:'assistant',content:null,tool_calls:[{id:'bad',type:'function',function:{name:'confirm',arguments:'{}'}},{id:'scope',type:'function',function:{name:'get_email',arguments:JSON.stringify({messageId:'outside'})}}]};
    assert.match(messages.find(m=>m.tool_call_id==='bad').content,/不支持/);assert.match(messages.find(m=>m.tool_call_id==='scope').content,/范围/);return {role:'assistant',content:'待用户确认'};
  }};
  const service=new AgentService(f.store,{config,model});const task=service.start('chat',{requestId:'chat-1',messageIds:[f.message.id],cloudConsent:true,instruction:'处理邮件'});await service.settled();
  assert.equal(service.task(task.id).answer,'待用户确认');assert.equal(f.store.records()[0].nodes.find(n=>n.key===5).status,'idle');
});
test('取消迟到的模型结果不产生建议，启动后保留中断状态',async t=>{
  const f=fixture(t),store=f.open();let release;const service=new AgentService(store,{config,model:{complete:()=>new Promise(r=>release=r)}}),m=service.repo.saveMessage(mailData);
  const task=service.start('analyze',{requestId:'cancel',messageIds:[m.id],cloudConsent:true});
  while(!release)await new Promise(r=>setTimeout(r,5));service.cancel(task.id,service.task(task.id).version);release({content:JSON.stringify(analysis)});await service.settled();assert.equal(service.repo.list().length,0);assert.equal(service.task(task.id).state,'cancelled');
});
test('Agent HTTP 来源限制、小请求限制与页面可访问',async t=>{
  const f=fixture(t),store=f.open(),server=createAppServer(store,{config});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/agent')).status,200);
  assert.equal((await fetch(base+'/api/agent/status',{headers:{Origin:'https://evil.invalid'}})).status,403);
  const status=await (await fetch(base+'/api/agent/status')).text();assert.ok(!status.includes(config.key));assert.ok(!status.includes(config.password));
  const response=await fetch(base+'/api/agent/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({padding:'a'.repeat(270000)})});assert.equal(response.status,413);
});

test('QQ 使用只读 UID 同步，跳过已保存邮件，不下载附件，UIDVALIDITY 改变后重扫',async()=>{
  let validity=1,reads=[],closed=0;
  const client={mailbox:{get uidValidity(){return validity;}},on(){},connect:async()=>{},close(){closed++;},getMailboxLock:async(_folder,options)=>{assert.equal(options.readOnly,true);return {release(){}};},search:async()=>[1,3,7],fetchOne:async(uid,query,options)=>{
    assert.equal(options.uid,true);reads.push({uid,query});
    if(query.bodyStructure)return {internalDate:new Date('2026-09-25T00:00:00Z'),envelope:{subject:'邀请',from:[{address:'hr@example.invalid'}]},bodyStructure:{type:'multipart/mixed',childNodes:[{part:'1',type:'text/plain',size:30},{part:'2',type:'application/pdf',disposition:'attachment',dispositionParameters:{filename:'offer.pdf'},size:10000000}]}};
    assert.ok(!query.source);assert.deepEqual(query.bodyParts.map(p=>p.key),['1.MIME','1']);
    return {bodyParts:new Map([['1.MIME',Buffer.from('Content-Type: text/plain; charset=utf-8\r\n')],['1',Buffer.from('邀请参加面试')]])};
  }};
  const adapter=new QQMail(config,()=>client),messages=[];
  const result=await adapter.scan({since:'2026-09-01',until:'2026-09-30',limit:1,known:['fake@qq.com/INBOX/1/1']},new AbortController().signal,async m=>messages.push(m));
  assert.equal(result.remaining,1);assert.equal(messages[0].identity,'fake@qq.com/INBOX/1/3');assert.deepEqual(messages[0].attachments,['offer.pdf']);assert.match(messages[0].body,/邀请/);
  validity=2;reads=[];await adapter.scan({since:'2026-09-01',until:'2026-09-30',limit:1,known:messages.map(m=>m.identity)},new AbortController().signal,async()=>{});assert.equal(reads[0].uid,1);assert.equal(closed,2);
});
test('多操作建议原子保存，缓存清理保留待确认原文和已确认证据',t=>{
  const f=setup(t),p=f.repo.preview(f.p.id,{expectedVersion:1,applicationId:f.record.id,operations:[{type:'node',nodeId:'stage-3',data:{status:'passed'}},{type:'node',nodeId:'stage-4',data:{status:'scheduled',date:'2026-09-28'}}]});
  assert.equal(f.repo.clearCache(Date.now()+10000).count,0);confirm(f,p);
  assert.equal(f.store.records()[0].nodes.find(n=>n.key===3).status,'passed');
  assert.equal(f.repo.clearCache(Date.now()+10000).count,1);assert.equal(f.repo.message(f.message.id).body,'');
  assert.match(JSON.parse(f.store.db.prepare('SELECT document FROM agent_audit').get().document).source.evidence,/邀请/);
});
test('启动把未结束任务标记中断，忽略和重新打开不能重放已应用建议',t=>{
  const f=setup(t),service=new AgentService(f.store,{config});
  service.saveTask({id:'unfinished',requestId:'interrupted',state:'running',created:new Date().toISOString(),version:1});
  const restarted=new AgentService(f.store,{config});assert.equal(restarted.task('unfinished').state,'interrupted');
  const ignored=f.repo.transition(f.p.id,1);assert.equal(ignored.state,'ignored');
  const reopened=f.repo.transition(f.p.id,ignored.version,true);assert.equal(reopened.state,'needs_input');
  const p=preview(f);confirm(f,p);assert.throws(()=>f.repo.transition(p.id,f.repo.get(p.id).version,true),/已应用/);
});
