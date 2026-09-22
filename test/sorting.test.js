import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication, sortApplications } from '../shared/model.js';

const now = new Date('2026-09-22T12:00').getTime();
function record(id, date = '', time = '', updated = '2026-09-21T00:00:00.000Z', key = 4) {
  const r = createApplication({ company: id, type: '私企' }, id, updated);
  Object.assign(r.nodes.find(n => n.key === key), { status: 'scheduled', date, time });
  return r;
}
const ids = records => records.map(r => r.id);

test('默认排序按最后节点时间与现在的绝对距离，过去和未来均参与，且不修改原数组', () => {
  const records = [record('far', '2026-09-25', '12:00'), record('future', '2026-09-22', '13:00'), record('past', '2026-09-22', '11:30')];
  const original = structuredClone(records);
  assert.deepEqual(ids(sortApplications(records, undefined, now)), ['past', 'future', 'far']);
  assert.deepEqual(records, original);
});

test('没有时间的记录排在有时间记录之后，缺少时间及等距离均按最近更新排序', () => {
  const records = [record('undated-old'), record('future', '2026-09-22', '13:00'), record('undated-new', '', '', '2026-09-22T10:00:00.000Z'), record('past-new', '2026-09-22', '11:00', '2026-09-22T09:00:00.000Z')];
  assert.deepEqual(ids(sortApplications(records, 'node-time', now)), ['past-new', 'future', 'undated-new', 'undated-old']);
  for (const input of [records, [...records].reverse(), [records[1], records[3], records[0], records[2]]]) {
    assert.deepEqual(ids(sortApplications(input, 'node-time', now)), ['past-new', 'future', 'undated-new', 'undated-old']);
  }
});

test('最后已进入节点没填时间时不借用更早节点时间，未开始和已跳过的空白节点不影响排序', () => {
  const missing = record('missing', '2026-09-22', '12:00');
  missing.nodes.find(n => n.key === 5).status = 'waiting';
  const dated = record('dated', '2026-09-23', '12:00');
  Object.assign(dated.nodes.find(n => n.key === 6), { status: 'skipped', date: '2026-10-01' });
  assert.deepEqual(ids(sortApplications([missing, dated], 'node-time', now)), ['dated', 'missing']);
  // A completed latest node still counts even though the summary points to the next round.
  const passed = record('passed', '2026-09-22', '12:00');
  passed.nodes.find(n => n.key === 4).status = 'passed';
  assert.deepEqual(ids(sortApplications([dated, passed], 'node-time', now)), ['passed', 'dated']);
});

test('HR 面、自定义节点以及调整后的顺序都使用实际最后节点，时间预填也有效', () => {
  const hr = record('hr', '2026-09-22', '12:20', undefined, 8);
  const custom = record('custom', '2026-10-01', '12:00');
  custom.nodes.push({ ...custom.nodes[1], id: 'custom-interview', key: null, name: '加面', status: 'waiting', date: '2026-09-22', time: '12:10' });
  const reordered = record('reordered', '2026-09-22', '12:00');
  const assessment = reordered.nodes.splice(1, 1)[0];
  Object.assign(assessment, { status: 'scheduled', date: '2026-09-23', time: '12:00' });
  reordered.nodes.push(assessment);
  const planned = record('planned');
  Object.assign(planned.nodes.find(n => n.key === 5), { date: '2026-09-22', time: '12:05' });
  assert.deepEqual(ids(sortApplications([reordered, hr, custom, planned], 'node-time', now)), ['planned', 'custom', 'hr', 'reordered']);
});

test('只填日期时使用本地整天，今天最近，不把日期解析为 UTC 零点', () => {
  const records = [record('tomorrow', '2026-09-23'), record('today', '2026-09-22'), record('yesterday', '2026-09-21')];
  const lateEvening = new Date('2026-09-22T23:30').getTime();
  assert.deepEqual(ids(sortApplications(records, 'node-time', lateEvening)), ['today', 'tomorrow', 'yesterday']);
  assert.deepEqual(ids(sortApplications(records, 'node-time', new Date('2026-09-23T00:30').getTime())), ['tomorrow', 'today', 'yesterday']);
});

test('新建、已结束及 Offer 记录都可排序，原来的三种排序保持可用', () => {
  const a = record('A', '', '', '2026-09-20T00:00:00.000Z');
  const b = record('B', '2026-09-22', '12:10', '2026-09-21T00:00:00.000Z', 7);
  b.nodes.find(n => n.key === 7).status = 'passed';
  const c = record('C', '2026-09-22', '12:05', '2026-09-22T00:00:00.000Z');c.ended = true;
  Object.assign(a, { applied: '2026-09-22' });Object.assign(b, { applied: '2026-09-20' });Object.assign(c, { applied: '2026-09-21' });
  assert.deepEqual(ids(sortApplications([c, b, a], 'company', now)), ['A', 'B', 'C']);
  assert.deepEqual(ids(sortApplications([a, b, c], 'updated', now)), ['C', 'B', 'A']);
  assert.deepEqual(ids(sortApplications([a, b, c], 'applied', now)), ['A', 'C', 'B']);
  assert.deepEqual(ids(sortApplications([a, b, c], 'node-time', now)), ['C', 'B', 'A']);
  assert.deepEqual(ids(sortApplications([createApplication({ company: '新建', type: '私企' }, 'new'), b], 'node-time', now)), ['B', 'new']);
});
