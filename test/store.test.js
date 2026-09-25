import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, basics } from './helpers.js';

test('已有投递启动时补上 HR 面并备份原始数据，重启不重复，手动移除后保持移除',t=>{
  const f=fixture(t);let s=f.open();
  const legacy=s.create(basics,s.revision()).record;delete legacy.workflowVersion;
  legacy.nodes=legacy.nodes.filter(n=>n.key!==8);
  s.db.prepare('UPDATE applications SET document=? WHERE id=?').run(JSON.stringify(legacy),legacy.id);
  const before=s.snapshot();s.close();s=f.open();
  const after=s.snapshot(),record=after.records[0];
  assert.deepEqual(record.nodes.slice(-3).map(n=>n.name),['三面','HR 面','Offer']);
  assert.deepEqual(record.nodes.filter(n=>n.key!==8),legacy.nodes);
  assert.equal(record.updated,legacy.updated);assert.deepEqual(record.history,legacy.history);
  assert.notEqual(after.revision,before.revision);
  const files=s.backups();assert.equal(files.length,1);assert.match(files[0],/^before-hr-stage-/);
  assert.deepEqual(JSON.parse(readFileSync(join(f.directory,'backups',files[0]),'utf8')).records,before.records);
  s.close();s=f.open();assert.deepEqual(s.snapshot(),after);assert.deepEqual(s.backups(),files);
  const removed=s.change(record.id,{type:'workflow',nodes:record.nodes.filter(n=>n.key!==8)},s.revision());
  s.close();s=f.open();assert.deepEqual(s.records(),[removed.record]);
  assert.deepEqual(s.restore(s.export(),s.revision()).records,[removed.record]);
  const restored=s.restore(s.readBackup(files[0]),s.revision());
  assert.equal(restored.records[0].nodes.filter(n=>n.key===8).length,1);
});

test('补上 HR 面时备份或数据库写入失败，记录和修订版本保持原样',t=>{
  for(const failure of ['backup','write']){
    const f=fixture(t),s=f.open(),legacy=s.create(basics,s.revision()).record;
    delete legacy.workflowVersion;legacy.nodes=legacy.nodes.filter(n=>n.key!==8);
    s.db.prepare('UPDATE applications SET document=? WHERE id=?').run(JSON.stringify(legacy),legacy.id);
    const before=s.snapshot();
    if(failure==='backup')writeFileSync(join(f.directory,'backups'),'blocked');
    else s.db.exec("CREATE TRIGGER reject_hr_update BEFORE UPDATE ON applications BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;");
    assert.throws(()=>s.migrateHrStage());assert.deepEqual(s.snapshot(),before);
  }
});

test('关闭数据库再打开，记录、节点和操作历史完整保留',t=>{
  const f=fixture(t);let store=f.open();
  const created=store.create(basics,store.snapshot().revision);
  const saved=store.change(created.record.id,{type:'node',nodeId:'stage-4',data:{status:'scheduled',date:'2026-09-25',time:'14:30',notes:'项目与系统设计',deadline:'2026-09-24',deadlineTime:'18:00',meetingUrl:'https://example.com/meeting'}},created.revision);
  assert.deepEqual(saved.record.nodes.map(n=>n.status),['passed','skipped','skipped','skipped','scheduled','idle','idle','idle','idle']);
  assert.equal(saved.record.history.length,created.record.history.length+1);
  assert.match(saved.record.history.at(-1).text,/前面 3 个未开始节点自动标记为已跳过/);
  store.close();store=f.open();assert.deepEqual(store.snapshot().records,[saved.record]);
  assert.equal(store.snapshot().revision,saved.revision);
  assert.deepEqual(store.export().records,[saved.record]);
});

test('自动跳过与当前节点在同一事务保存，写入失败时全部保留原状态',t=>{
  const s=fixture(t).open(),created=s.create(basics,s.revision()),before=s.snapshot();
  s.db.exec("CREATE TRIGGER reject_update BEFORE UPDATE ON applications BEGIN SELECT RAISE(ABORT, 'simulated update failure'); END;");
  assert.throws(()=>s.change(created.record.id,{type:'node',nodeId:'stage-4',data:{status:'waiting'}},created.revision),/simulated update failure/);
  assert.deepEqual(s.snapshot(),before);
});

test('清除待完成节点进度后重新打开及导出仍为空白状态，日期清空且备注保留',t=>{
  const f=fixture(t);let s=f.open();
  const created=s.create(basics,s.revision());
  const scheduled=s.change(created.record.id,{type:'node',nodeId:'stage-2',data:{status:'scheduled',date:'2026-09-25',notes:'保留准备记录'}},created.revision);
  const cleared=s.change(created.record.id,{type:'node',nodeId:'stage-2',data:{status:'idle'}},scheduled.revision);
  assert.deepEqual(cleared.record.nodes[2],{...scheduled.record.nodes[2],status:'idle',date:''});
  s.close();s=f.open();assert.deepEqual(s.records(),[cleared.record]);
  assert.deepEqual(s.export().records,[cleared.record]);
});
test('同一公司同一岗位允许再次投递，不覆盖之前的记录',t=>{
  const s=fixture(t).open(),a=s.create(basics,s.snapshot().revision),b=s.create(basics,a.revision);
  assert.notEqual(a.record.id,b.record.id);assert.equal(s.snapshot().records.length,2);
});

test('启动时自动推进旧记录的简历状态，备份原数据并保持排序时间，重复启动不重复写入',t=>{
  const f=fixture(t);let s=f.open();
  const created=s.create(basics,s.revision()),legacy=structuredClone(created.record);
  legacy.nodes[3].status='scheduled';legacy.nodes[0].notes='保留简历备注';
  s.db.prepare('UPDATE applications SET document=? WHERE id=?').run(JSON.stringify(legacy),legacy.id);
  const before=s.snapshot();s.close();s=f.open();
  const after=s.snapshot(),record=after.records[0];
  assert.equal(record.nodes[0].status,'passed');assert.equal(record.updated,legacy.updated);
  assert.deepEqual({...record.nodes[0],status:'waiting'},legacy.nodes[0]);
  assert.deepEqual(record.nodes.slice(1),legacy.nodes.slice(1));
  assert.equal(record.history.at(-1).type,'auto-screening');assert.deepEqual(record.history.slice(0,-1),legacy.history);
  assert.notEqual(after.revision,before.revision);
  assert.throws(()=>s.change(legacy.id,{type:'node',nodeId:'stage-3',data:{status:'waiting'}},before.revision),e=>e.status===409);
  const files=s.backups();assert.equal(files.length,1);assert.match(files[0],/^before-screening-/);
  assert.deepEqual(s.readBackup(files[0]).records,before.records);
  assert.equal(s.export().records[0].nodes[0].status,'passed');
  s.close();s=f.open();assert.deepEqual(s.snapshot(),after);assert.deepEqual(s.backups(),files);
});

test('更新旧简历状态时备份或数据库写入失败均不改变记录和版本',t=>{
  for(const failure of ['backup','write']){
    const f=fixture(t),s=f.open(),created=s.create(basics,s.revision()),legacy=structuredClone(created.record);
    legacy.nodes[4].status='waiting';
    s.db.prepare('UPDATE applications SET document=? WHERE id=?').run(JSON.stringify(legacy),legacy.id);
    const before=s.snapshot();
    if(failure==='backup')writeFileSync(join(f.directory,'backups'),'blocked backup directory');
    else s.db.exec("CREATE TRIGGER reject_update BEFORE UPDATE ON applications BEGIN SELECT RAISE(ABORT, 'simulated update failure'); END;");
    assert.throws(()=>s.migrateResumeScreening());assert.deepEqual(s.snapshot(),before);
  }
});

test('恢复旧备份也应用自动筛选规则，保留其他节点和原备份内容',t=>{
  const s=fixture(t).open();s.create(basics,s.revision());
  const backup=s.export();backup.records[0].nodes[2].status='skipped';
  const original=structuredClone(backup),result=s.restore(backup,s.revision());
  assert.equal(result.records[0].nodes[0].status,'passed');assert.equal(result.records[0].nodes[2].status,'skipped');
  assert.deepEqual(s.snapshot().records,result.records);assert.deepEqual(backup,original);
  assert.equal(result.records[0].history.at(-1).type,'auto-screening');
});

test('删除仅移除指定投递，重新打开数据库和导出后仍保持删除结果',t=>{
  const f=fixture(t);let s=f.open();
  const first=s.create(basics,s.snapshot().revision),second=s.create(basics,first.revision);
  const removed=s.remove(first.record.id,second.revision);
  assert.equal(removed.id,first.record.id);assert.notEqual(removed.revision,second.revision);
  assert.deepEqual(s.snapshot().records,[second.record]);assert.deepEqual(s.export().records,[second.record]);
  s.close();s=f.open();assert.deepEqual(s.snapshot().records,[second.record]);assert.equal(s.snapshot().revision,removed.revision);
  s.remove(second.record.id,removed.revision);assert.deepEqual(s.snapshot().records,[]);
});

test('删除拒绝过期版本、缺失版本及不存在的记录，现有数据和版本保持不变',t=>{
  const s=fixture(t).open(),created=s.create(basics,s.snapshot().revision);
  s.change(created.record.id,{type:'node',nodeId:'stage-4',data:{status:'passed'}},created.revision);
  const before=s.snapshot();
  assert.throws(()=>s.remove(created.record.id,created.revision),e=>e.status===409);
  assert.throws(()=>s.remove(created.record.id,undefined),e=>e.status===409);
  assert.throws(()=>s.remove('missing-record',before.revision),e=>e.status===404);
  assert.deepEqual(s.snapshot(),before);
});

test('删除时数据库写入失败，记录及版本一并回滚',t=>{
  const s=fixture(t).open();s.create(basics,s.snapshot().revision);const before=s.snapshot();
  s.db.exec("CREATE TRIGGER reject_delete BEFORE DELETE ON applications BEGIN SELECT RAISE(ABORT, 'simulated delete failure'); END;");
  assert.throws(()=>s.remove(before.records[0].id,before.revision),/simulated delete failure/);
  assert.deepEqual(s.snapshot(),before);
});
test('旧页面写入发生冲突，不能覆盖已保存的新内容',t=>{
  const s=fixture(t).open(),a=s.create(basics,s.snapshot().revision);
  s.change(a.record.id,{type:'node',nodeId:'stage-4',data:{status:'passed'}},a.revision);
  assert.throws(()=>s.change(a.record.id,{type:'node',nodeId:'stage-4',data:{status:'failed'}},a.revision),e=>e.status===409);
  assert.equal(s.snapshot().records[0].nodes[4].status,'passed');
});
test('备份与恢复包含完整数据，恢复前副本可找回替换前的数据',t=>{
  const f=fixture(t),s=f.open(),a=s.create(basics,s.snapshot().revision),backup=s.export();
  s.change(a.record.id,{type:'node',nodeId:'stage-4',data:{status:'waiting',notes:'恢复前的信息'}},a.revision);
  const before=s.snapshot(),restored=s.restore(backup,before.revision);
  assert.deepEqual(s.snapshot().records,backup.records);
  assert.notEqual(restored.revision,before.revision);
  const safety=JSON.parse(readFileSync(join(f.directory,'backups',restored.safetyBackup),'utf8'));
  assert.deepEqual(safety.records,before.records);
  s.restore(s.readBackup(restored.safetyBackup),restored.revision);assert.deepEqual(s.snapshot().records,before.records);
});
test('损坏或不兼容备份不能改动任何现有数据',t=>{
  const s=fixture(t).open();s.create(basics,s.snapshot().revision);const before=s.snapshot();
  const backup=s.export();backup.records[0].nodes[0].date='2026-99-12';
  assert.throws(()=>s.restore(backup,before.revision),/日期/);
  assert.deepEqual(s.snapshot(),before);assert.equal(s.backups().length,0);
});
test('安全备份写入失败时恢复被拒绝，原数据库保持不变',t=>{
  const f=fixture(t),s=f.open();s.create(basics,s.snapshot().revision);const before=s.snapshot();
  writeFileSync(join(f.directory,'backups'),'simulate unavailable backup directory');
  assert.throws(()=>s.restore({...s.export(),records:[]},before.revision));
  assert.deepEqual(s.snapshot(),before);
});
test('恢复过程中数据库写入失败，事务回滚保留全部旧记录',t=>{
  const s=fixture(t).open();s.create(basics,s.snapshot().revision);const before=s.snapshot(),backup=s.export();
  s.db.exec("CREATE TRIGGER reject_insert BEFORE INSERT ON applications BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;");
  assert.throws(()=>s.restore(backup,before.revision),/simulated write failure/);
  assert.deepEqual(s.snapshot(),before);
});
test('约 100 条记录及较长流程可以完整保存和导出',t=>{
  const s=fixture(t).open();let revision=s.snapshot().revision;
  for(let i=0;i<100;i++){const data=s.create({...basics,company:`投递 ${i}`},revision);revision=data.revision;}
  assert.equal(s.export().records.length,100);
  const a=s.snapshot().records[0];
  const nodes=[...a.nodes,...Array.from({length:24},(_,i)=>({...a.nodes[0],id:`extra-${i}`,key:null,name:`自定义面试 ${i}`,status:'idle'}))];
  s.change(a.id,{type:'workflow',nodes},revision);assert.equal(s.snapshot().records.find(r=>r.id===a.id).nodes.length,33);
});
