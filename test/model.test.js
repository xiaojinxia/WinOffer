import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication, applyChange, info, hasPendingTask, standard, validateNode, validateBackup, validDate, validUrl, splitCities, advanceResumeScreening } from '../shared/model.js';

const basics={company:'示例公司',role:'后端开发',type:'私企',city:'合肥、南京'};
const fresh=()=>createApplication(basics,'application-1','2026-09-21T00:00:00.000Z');
const node=(r,key,status)=>applyChange(r,{type:'node',nodeId:`stage-${key}`,data:{status}});

test('待完成包含六个标准阶段的待完成状态，不要求填写日期，并兼容旧进行中记录',()=>{
  for(const key of [1,2,3,4,5,6]){
    const r=node(fresh(),key,'scheduled');
    assert.equal(hasPendingTask(r),true,info(r).title);
    assert.equal(info(r).title,`${r.nodes[key].name}待完成`);
    const legacy=node(r,key,'active');
    assert.equal(hasPendingTask(legacy),true);assert.equal(info(legacy).title,info(r).title);
    for(const status of ['idle','waiting','passed','failed','skipped']){
      assert.equal(hasPendingTask(node(r,key,status)),false,`${r.nodes[key].name} ${status}`);
    }
  }
});

test('待完成不包含投递、Offer、自定义阶段及已结束的记录',()=>{
  for(const key of [0,7])assert.equal(hasPendingTask(node(fresh(),key,'scheduled')),false);
  const custom=fresh();custom.nodes.push({...custom.nodes[0],id:'custom',key:null,name:'自定义面试',status:'scheduled'});
  assert.equal(hasPendingTask(custom),false);
  const scheduled=node(fresh(),4,'scheduled');
  assert.equal(hasPendingTask(applyChange(scheduled,{type:'end',reason:'主动放弃'})),false);
  assert.equal(hasPendingTask(node(scheduled,3,'failed')),false);
  for(const decision of ['pending','accepted','declined']){
    assert.equal(hasPendingTask(applyChange(node(scheduled,7,'passed'),{type:'offer',decision})),false);
  }
});

test('待完成跟随当前阶段，旧节点遗留的已安排状态不会重复列为待办',()=>{
  const scheduled=node(fresh(),1,'scheduled');
  for(const status of ['waiting','passed'])assert.equal(hasPendingTask(node(scheduled,3,status)),false);
  assert.equal(hasPendingTask(node(scheduled,3,'scheduled')),true);
  const reordered=node(fresh(),1,'scheduled');
  const assessment=reordered.nodes.splice(1,1)[0];reordered.nodes.splice(5,0,assessment);
  assessment.name='在线测评';
  assert.equal(hasPendingTask(reordered),true);
});

test('面试完成待结果与已通过等待下一轮使用不同摘要，补齐此前空白节点',()=>{
  let r=node(fresh(),4,'waiting');
  assert.equal(info(r).title,'一面待结果');
  assert.equal(r.nodes[0].status,'passed');
  r=node(r,4,'passed');
  assert.equal(info(r).title,'一面已通过');
  assert.equal(info(r).detail,'等待二面安排');
  assert.equal(r.nodes[3].status,'skipped');
});

test('后续各阶段有状态时简历自动通过、前面空白节点自动跳过，不补填日期或修改后续节点',()=>{
  for(const key of [1,2,3,4,5,6,7]){
    for(const status of ['scheduled','active','waiting','passed','failed','skipped']){
      const original=fresh(),result=node(original,key,status);
      assert.equal(result.nodes[0].status,'passed',`${key} ${status}`);
      assert.equal(result.nodes[0].completedDate,'');
      assert.equal(original.nodes[0].status,'waiting');
      for(const other of original.nodes.filter(n=>n.key!==0&&n.key!==key))assert.deepEqual(result.nodes.find(n=>n.id===other.id),other.key<key?{...other,status:'skipped'}:other);
      assert.deepEqual(original.nodes,fresh().nodes);
      assert.equal(result.history.length,original.history.length+1);
      assert.match(result.history.at(-1).text,/投递简历自动标记为已通过/);
      const again=node(result,key,status);assert.doesNotMatch(again.history.at(-1).text,/自动标记/);
    }
  }
});

test('未开始节点仅填写备注或时间不会推进简历，明确设置的简历结果保持不变',()=>{
  const r=applyChange(fresh(),{type:'node',nodeId:'stage-3',data:{date:'2026-09-25',notes:'准备材料'}});
  assert.equal(r.nodes[0].status,'waiting');
  assert.deepEqual(r.nodes.slice(1,3),fresh().nodes.slice(1,3));
  for(const status of ['idle','scheduled','active','passed','failed','skipped']){
    const original=node(fresh(),0,status),result=node(original,3,'scheduled');
    assert.equal(result.nodes[0].status,status);
  }
});

test('自动跳过只填空白状态，保留此前明确填写的结果、安排、备注与日期',()=>{
  for(const status of ['scheduled','active','waiting','passed','failed','skipped']){
    const original=fresh();original.nodes[1].status=status;
    Object.assign(original.nodes[2],{date:'2026-09-25',time:'10:00',notes:'保留准备材料',meetingUrl:'https://example.com/meeting'});
    const result=node(original,4,'waiting');
    assert.deepEqual(result.nodes[1],original.nodes[1]);
    assert.deepEqual(result.nodes[2],{...original.nodes[2],status:'skipped'});
    assert.equal(result.nodes[3].status,'skipped');
    assert.deepEqual(result.nodes.slice(5),original.nodes.slice(5));
    assert.match(result.history.at(-1).text,/前面 2 个未开始节点自动标记为已跳过/);
  }
});

test('自动跳过按调整后的实际顺序处理标准和自定义节点，并允许手动纠正',()=>{
  const original=fresh(),custom={...original.nodes[1],id:'custom',key:null,name:'HR 沟通'};
  original.nodes=[original.nodes[0],original.nodes[4],custom,original.nodes[2],original.nodes[1],original.nodes[3],original.nodes[5],original.nodes[6],original.nodes[7]];
  const result=node(original,2,'scheduled');
  assert.deepEqual(result.nodes.map(n=>n.status),['passed','skipped','skipped','scheduled','idle','idle','idle','idle','idle']);
  const corrected=applyChange(result,{type:'node',nodeId:'custom',data:{status:'passed',notes:'补录结果'}});
  assert.equal(corrected.nodes[2].status,'passed');assert.equal(corrected.nodes[2].notes,'补录结果');
  assert.deepEqual(corrected.nodes.slice(3),result.nodes.slice(3));
  const noResume={...fresh(),nodes:[{...custom},...fresh().nodes.slice(1)]};
  assert.equal(node(noResume,1,'waiting').nodes[0].status,'skipped');
});

test('补存已有进度时补齐前面空白节点，修改未开始节点或基本信息不会批量推进',()=>{
  const original=fresh();original.nodes[0].status='passed';original.nodes[4].status='waiting';
  const saved=applyChange(original,{type:'node',nodeId:'stage-4',data:{notes:'等待通知'}});
  assert.deepEqual(saved.nodes.slice(1,4).map(n=>n.status),['skipped','skipped','skipped']);
  assert.deepEqual(node(original,4,'idle').nodes.slice(0,4),original.nodes.slice(0,4));
  const basicsChanged=applyChange(original,{type:'basics',data:{...original,company:'更新公司'}});
  assert.deepEqual(basicsChanged.nodes,original.nodes);
  const workflowChanged=applyChange(original,{type:'workflow',nodes:original.nodes.filter(n=>n.key!==7)});
  assert.deepEqual(workflowChanged.nodes,original.nodes.slice(0,7));
  assert.deepEqual(applyChange(workflowChanged,{type:'undo-workflow'}).nodes,original.nodes);
});

test('自动筛选按实际流程支持自定义后续节点，流程撤销可恢复原来的待筛选状态',()=>{
  const r=fresh(),custom={...r.nodes[1],id:'custom',key:null,name:'沟通',status:'waiting'};
  const changed=applyChange(r,{type:'workflow',nodes:[...r.nodes,custom]});
  assert.equal(changed.nodes[0].status,'passed');assert.equal(changed.history.at(-1).type,'workflow');
  assert.deepEqual(applyChange(changed,{type:'undo-workflow'}).nodes,r.nodes);
  const beforeResume={...r,nodes:[custom,...r.nodes]};assert.equal(advanceResumeScreening(beforeResume),beforeResume);
  const noResume={...r,nodes:[custom]};assert.equal(advanceResumeScreening(noResume),noResume);
});

test('清除误填的后续节点后回到测评待结果，保留时间备注，任意清除顺序均不会重新跳过',()=>{
  let original=node(fresh(),1,'waiting');
  original=applyChange(original,{type:'node',nodeId:'stage-2',data:{status:'scheduled',date:'2026-09-25',time:'10:00',notes:'准备事项'}});
  original=node(original,3,'passed');
  for(const order of [[2,3],[3,2]]){
    let cleared=original;
    for(const key of order){
      const before=cleared;cleared=node(cleared,key,'idle');
      assert.deepEqual(cleared.nodes[key],{...before.nodes[key],status:'idle'});
      for(const other of before.nodes.filter(n=>n.key!==key))assert.deepEqual(cleared.nodes.find(n=>n.id===other.id),other);
    }
    assert.deepEqual(cleared.nodes.map(n=>n.status),['passed','waiting','idle','idle','idle','idle','idle','idle']);
    assert.equal(info(cleared).title,'测评待结果');assert.equal(hasPendingTask(cleared),false);
    assert.equal(cleared.history.length,original.history.length+2);
  }
});

test('清除误填的失败和 Offer 进度时，状态和 Offer 决定重新计算',()=>{
  const waiting=node(fresh(),1,'waiting');
  const failed=node(waiting,3,'failed');
  assert.equal(info(node(failed,3,'idle')).kind,'active');
  const accepted=applyChange(node(waiting,7,'passed'),{type:'offer',decision:'accepted'});
  const cleared=node(accepted,7,'idle');
  assert.equal(cleared.offerDecision,'pending');assert.equal(info(cleared).title,'测评待结果');
});
test('未通过结束投递，纠正结果恢复活动状态，不修改后续节点',()=>{
  let r=node(fresh(),4,'failed');
  assert.equal(info(r).kind,'ended');assert.equal(r.nodes[5].status,'idle');
  r=node(r,4,'waiting');assert.equal(info(r).kind,'active');
});
test('主动结束与节点拒绝相互独立，恢复不会把拒绝改成通过',()=>{
  let r=node(fresh(),4,'failed');
  r=applyChange(r,{type:'end',reason:'主动放弃'});assert.equal(info(r).title,'主动放弃');
  r=applyChange(r,{type:'resume'});assert.equal(info(r).title,'一面未通过');
});
test('跳过不算通过，摘要寻找下一个有效阶段',()=>{
  let r=node(fresh(),4,'passed');r=node(r,5,'skipped');
  assert.equal(info(r).detail,'等待三面安排');assert.equal(r.nodes[5].status,'skipped');
});
test('Offer 可以接受、婉拒和改回待定，纠正收到状态后清除决定',()=>{
  let r=node(fresh(),7,'passed');assert.equal(info(r).kind,'offer');
  r=applyChange(r,{type:'offer',decision:'accepted'});assert.equal(info(r).title,'已接受 Offer');
  r=applyChange(r,{type:'offer',decision:'declined'});assert.equal(info(r).kind,'ended');
  r=applyChange(r,{type:'offer',decision:'pending'});assert.equal(info(r).kind,'offer');
  r=node(r,7,'waiting');assert.equal(r.offerDecision,'pending');assert.equal(info(r).kind,'active');
});
test('调整流程保留删除前的状态和备注，可以完整撤销',()=>{
  let r=applyChange(fresh(),{type:'node',nodeId:'stage-4',data:{status:'passed',notes:'保留面试复盘',date:'2026-09-20'}});
  const before=structuredClone(r.nodes);
  r=applyChange(r,{type:'workflow',nodes:r.nodes.filter(n=>n.key!==4)});
  assert.equal(r.nodes.length,7);assert.equal(standard(r),true);
  r=applyChange(r,{type:'undo-workflow'});assert.deepEqual(r.nodes,before);
  assert.throws(()=>applyChange(r,{type:'undo-workflow'}),/最近一次/);
});
test('调整标准阶段先后或加入自定义节点时使用实际流程',()=>{
  const r=fresh();[r.nodes[2],r.nodes[3]]=[r.nodes[3],r.nodes[2]];assert.equal(standard(r),false);
  r.nodes.push({...r.nodes[0],id:'hr',key:null,name:'HR 面'});assert.equal(standard(r),false);
});
test('撤销移除 Offer 节点时也恢复此前的接受决定',()=>{
  let r=node(fresh(),7,'passed');r=applyChange(r,{type:'offer',decision:'accepted'});
  r=applyChange(r,{type:'workflow',nodes:r.nodes.filter(n=>n.key!==7)});
  assert.equal(r.offerDecision,'pending');
  r=applyChange(r,{type:'undo-workflow'});assert.equal(r.offerDecision,'accepted');assert.equal(info(r).title,'已接受 Offer');
});
test('日期精度与时间关系得到验证，非法日期不会漏到服务器错误',()=>{
  assert.equal(validDate(''),'');assert.equal(validDate('2024-02-29'),'2024-02-29');
  for(const d of ['2026-02-29','2026-13-01','2026-00-00','2026-04-31'])assert.throws(()=>validDate(d),/有效日期/);
  assert.throws(()=>validateNode({...fresh().nodes[0],time:'12:00'}),/安排日期/);
  assert.throws(()=>validateNode({...fresh().nodes[0],deadlineTime:'12:00'}),/截止日期/);
});
test('链接仅允许网页地址，多城市规范化且不丢失',()=>{
  assert.throws(()=>validUrl('javascript:alert(1)'),/http/);
  assert.throws(()=>validUrl('https://user:secret@example.com'),/http/);
  assert.equal(validUrl('https://example.com/jobs?id=1'),'https://example.com/jobs?id=1');
  assert.deepEqual(splitCities('合肥，南京、合肥; 上海'),['合肥','南京','上海']);
});
test('备份完整验证包含重复标识、节点状态、版本和历史',()=>{
  const backup={format:'winoffer-backup',version:1,exportedAt:'2026-09-21T00:00:00.000Z',records:[fresh()]};
  assert.deepEqual(validateBackup(backup),backup);
  assert.throws(()=>validateBackup({...backup,version:2}),/版本/);
  assert.throws(()=>validateBackup({...backup,records:[fresh(),fresh()]}),/重复/);
  const bad=structuredClone(backup);bad.records[0].nodes[0].status='unknown';assert.throws(()=>validateBackup(bad),/状态/);
});
test('岗位可以不填，未填写岗位的记录仍能编辑和备份恢复',()=>{
  const r=createApplication({company:'可选岗位公司',type:'私企'},'optional-role');
  assert.equal(r.role,'');
  const updated=applyChange(r,{type:'node',nodeId:'stage-4',data:{status:'waiting'}});
  const backup={format:'winoffer-backup',version:1,exportedAt:new Date().toISOString(),records:[updated]};
  assert.equal(validateBackup(backup).records[0].role,'');
});
test('岗位分类兼容大小写和空格，同时保留无法归类的历史岗位',()=>{
  assert.equal(createApplication({...basics,role:'ai应用'},'ai-role').role,'AI应用');
  assert.equal(createApplication({...basics,role:'JAVA 后端'},'java-role').role,'Java后端');
  const legacy=createApplication({...basics,role:'嵌入式软件工程师'},'legacy-role');
  assert.equal(applyChange(legacy,{type:'node',nodeId:'stage-4',data:{status:'passed'}}).role,'嵌入式软件工程师');
});
