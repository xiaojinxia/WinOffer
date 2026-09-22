import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication, nodeSchedule, info, sortApplications } from '../shared/model.js';
import { fixture, basics } from './helpers.js';

function legacyRecord(id='legacy-date') {
  const record=createApplication(basics,id);
  Object.assign(record.nodes.find(n=>n.key===2),{status:'scheduled',deadline:'2026-09-23',deadlineTime:'18:30'});
  return record;
}

test('旧截止日期与对应时间用于统一日期和摘要，读取不改变原数据',()=>{
  const record=legacyRecord(),original=structuredClone(record);
  assert.deepEqual(nodeSchedule(record.nodes[2]),{date:'2026-09-23',time:'18:30'});
  assert.equal(info(record).detail,'2026-09-23 18:30');
  assert.deepEqual(record,original);
  assert.deepEqual(nodeSchedule(null),{date:'',time:''});
  Object.assign(record.nodes[2],{date:'2026-09-22',time:''});
  assert.deepEqual(nodeSchedule(record.nodes[2]),{date:'2026-09-22',time:''});
});

test('只填旧截止日期或尚未设置进度的截止日期同样参与节点时间排序',()=>{
  const now=new Date('2026-09-23T18:00').getTime(),near=legacyRecord('near'),far=legacyRecord('far');
  Object.assign(far.nodes[2],{date:'2026-09-25',time:'18:00'});
  assert.deepEqual(sortApplications([far,near],'node-time',now).map(r=>r.id),['near','far']);
  Object.assign(near.nodes[2],{status:'idle',deadlineTime:''});
  assert.deepEqual(sortApplications([far,near],'node-time',now).map(r=>r.id),['near','far']);
  // A later undated step still takes precedence over an earlier dated step.
  near.nodes[3].status='waiting';
  assert.deepEqual(sortApplications([near,far],'node-time',now).map(r=>r.id),['far','near']);
});

test('旧备份恢复、统一日期保存、重新打开及清空日期不会丢失或重新出现旧截止日期',t=>{
  const f=fixture(t);let store=f.open();
  const original=legacyRecord();original.nodes[2].completedDate='2026-09-20';
  store.restore({format:'winoffer-backup',version:1,exportedAt:new Date().toISOString(),records:[original]},store.revision());
  assert.deepEqual(nodeSchedule(store.records()[0].nodes[2]),{date:'2026-09-23',time:'18:30'});
  const saved=store.change(original.id,{type:'node',nodeId:'stage-2',data:{date:'2026-09-24',time:'10:00',deadline:'',deadlineTime:''}},store.revision());
  assert.deepEqual(nodeSchedule(saved.record.nodes[2]),{date:'2026-09-24',time:'10:00'});
  store.close();store=f.open();
  assert.deepEqual(store.records(),[saved.record]);
  const cleared=store.change(original.id,{type:'node',nodeId:'stage-2',data:{date:'',time:'',deadline:'',deadlineTime:''}},store.revision());
  assert.deepEqual(nodeSchedule(cleared.record.nodes[2]),{date:'',time:''});
  assert.equal(cleared.record.nodes[2].completedDate,'2026-09-20');
  assert.deepEqual(store.restore(store.export(),store.revision()).records,[cleared.record]);
});
