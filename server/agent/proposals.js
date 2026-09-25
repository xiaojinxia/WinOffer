import { randomUUID, createHash } from 'node:crypto';
import { AppError, applyChange, text } from '../../shared/model.js';

export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const requireValue = (value, message, status = 400) => { if (!value) throw new AppError(message, status); };
const fields = new Set(['status','date','time','location','meetingUrl','notes','completedDate']);
const business = record => ({ nodes:record.nodes, ended:record.ended, endReason:record.endReason, offerDecision:record.offerDecision });
export function operationsFor(record, input) {
  requireValue(Array.isArray(input) && input.length > 0 && input.length <= 10, '每条建议需要 1 至 10 个节点操作');
  return input.map(operation => {
    requireValue(operation && operation.type === 'node' && record.nodes.some(n=>n.id===operation.nodeId), '请选择现有节点');
    requireValue(operation.data && typeof operation.data === 'object' && !Array.isArray(operation.data), '节点字段无效');
    requireValue(Object.keys(operation).every(k=>['type','nodeId','data'].includes(k)), '存在不支持的操作字段');
    requireValue(Object.keys(operation.data).every(k=>fields.has(k)), '只允许修改节点状态、安排和备注');
    requireValue(Object.values(operation.data).every(v=>typeof v==='string'), '未知字段请省略，清空字段须使用空文本');
    return structuredClone(operation);
  });
}
export function buildPreview(record, operations, now = new Date().toISOString()) {
  let after = record;
  for (const operation of operationsFor(record, operations)) after = applyChange(after, operation, now);
  const diff = [];
  for (let i=0;i<record.nodes.length;i++) {
    const before=record.nodes[i], next=after.nodes[i];
    for (const key of Object.keys(next)) if (before[key] !== next[key]) diff.push({ node:before.name, field:key, before:before[key], after:next[key] });
  }
  if (record.offerDecision!==after.offerDecision) diff.push({node:'Offer',field:'offerDecision',before:record.offerDecision,after:after.offerDecision});
  return { after, diff, businessHash:hash(business(after)) };
}

export class Proposals {
  constructor(store) { this.store=store; this.db=store.db; }
  message(id) { const row=this.db.prepare('SELECT document FROM agent_messages WHERE id=?').get(id); requireValue(row,'邮件不存在',404);return JSON.parse(row.document); }
  messages() { return this.db.prepare('SELECT document FROM agent_messages ORDER BY created DESC,id DESC').all().map(r=>JSON.parse(r.document)); }
  saveMessage(message) {
    const existing=this.db.prepare('SELECT id FROM agent_messages WHERE identity=?').get(message.identity);
    if(existing) return this.message(existing.id);
    const result={...message,id:randomUUID(),created:new Date().toISOString()};
    this.db.prepare('INSERT INTO agent_messages VALUES(?,?,?,?)').run(result.id,result.identity,result.created,JSON.stringify(result));
    return result;
  }
  list() { return this.db.prepare('SELECT document FROM agent_proposals ORDER BY created DESC,id DESC').all().map(r=>JSON.parse(r.document)); }
  get(id) {const row=this.db.prepare('SELECT document FROM agent_proposals WHERE id=?').get(id);requireValue(row,'建议不存在',404);return JSON.parse(row.document);}
  save(p) { this.db.prepare('INSERT INTO agent_proposals VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,document=excluded.document').run(p.id,p.messageId,p.state,p.created,JSON.stringify(p));return p; }
  clearCache(before = Date.now()-90*86400000) {
    const protectedIds=new Set(this.list().filter(p=>['pending','needs_input','stale'].includes(p.state)).map(p=>p.messageId));
    let count=0;
    return this.store.atomic(()=>{
      for(const m of this.messages())if(!protectedIds.has(m.id)&&Date.parse(m.created)<before&&m.body){m.body='';m.cacheCleared=true;this.db.prepare('UPDATE agent_messages SET document=? WHERE id=?').run(JSON.stringify(m),m.id);count++;}
      return {count};
    });
  }
  create(messageId, analysis) {
    const old=this.db.prepare('SELECT id FROM agent_proposals WHERE message_id=?').get(messageId);
    if(old)return this.get(old.id);
    this.message(messageId);
    return this.save({id:randomUUID(),messageId,analysis,state:'needs_input',version:1,applicationId:null,preview:null,created:new Date().toISOString()});
  }
  record(id) { const row=this.db.prepare('SELECT document FROM applications WHERE id=?').get(id);requireValue(row,'投递不存在',404);return JSON.parse(row.document); }
  preview(id, input) {
    return this.store.atomic(()=>{
      const p=this.get(id);
      requireValue(p.state!=='applied','已应用建议不能重新执行',409);
      requireValue(input.expectedVersion===p.version,'建议已改变，请刷新',409);
      const record=this.record(input.applicationId);
      requireValue(!record.ended && record.offerDecision!=='accepted','投递已结束或已接受 Offer，请使用工作台手动处理',422);
      const operations=operationsFor(record,input.operations), calculated=buildPreview(record,operations);
      requireValue(calculated.diff.length,'与当前记录相同，无需更新',422);
      p.version++;p.applicationId=record.id;p.state='pending';p.reason='';
      p.preview={id:randomUUID(),version:p.version,baseRevision:this.store.revision(),operations,diff:calculated.diff,businessHash:calculated.businessHash,company:record.company,role:record.role,created:new Date().toISOString()};
      return this.save(p);
    });
  }
  confirm(id, input) {
    return this.store.atomic(()=>{
      const p=this.get(id), audit=this.db.prepare('SELECT preview_id,document FROM agent_audit WHERE proposal_id=?').get(id);
      if(audit) {requireValue(audit.preview_id===input.previewId,'已应用的是另一版本预览',409);return {...JSON.parse(audit.document),replayed:true};}
      requireValue(p.state==='pending' && p.version===input.expectedVersion && p.preview?.id===input.previewId,'预览已失效，请重新检查',409);
      requireValue(p.preview.baseRevision===this.store.revision(),'投递已发生变化，请重新生成预览',409);
      const record=this.record(p.applicationId), calculated=buildPreview(record,p.preview.operations);
      requireValue(calculated.businessHash===p.preview.businessHash,'业务规则已变化，请重新预览',409);
      const message=this.message(p.messageId), next=calculated.after;
      next.history.at(-1).text=text(`${next.history.at(-1).text}；邮件来源：${message.subject.slice(0,100)} [${p.id}]`,'历史说明',500,true);
      const revision=randomUUID(), result={applied:true,auditId:p.id,record:next,resultRevision:revision,source:{subject:message.subject,from:message.from,date:message.date,evidence:p.analysis.events.map(e=>e.evidence).join('\n').slice(0,4000)},before:record};
      this.db.prepare('UPDATE applications SET document=? WHERE id=?').run(JSON.stringify(next),record.id);
      this.db.prepare('INSERT INTO agent_audit VALUES(?,?,?)').run(p.id,p.preview.id,JSON.stringify(result));
      p.state='applied';p.version++;this.save(p);
      this.db.prepare("UPDATE metadata SET value=? WHERE key='revision'").run(revision);
      return {...result,replayed:false};
    });
  }
  transition(id,version,reopen=false) {
    return this.store.atomic(()=>{const p=this.get(id);requireValue(p.state!=='applied' && p.version===version,'建议已更新或已应用',409);p.state=reopen?'needs_input':'ignored';p.version++;p.preview=null;return this.save(p);});
  }
}
