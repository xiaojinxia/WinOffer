// Stage keys are persisted in records and backups; keep Offer at key 7.
export const STAGES = ['投递简历', '测评', 'AI 面试', '笔试', '一面', '二面', '三面', 'Offer', 'HR 面'];
export const STAGE_ORDER = [0, 1, 2, 3, 4, 5, 6, 8, 7];
const INTERVIEW_KEYS = [4, 5, 6, 8];
export const NODE_STATES = { scheduled: '待完成', waiting: '待结果', passed: '已通过', failed: '未通过', skipped: '已跳过' };
// Keep unset nodes and legacy in-progress values readable in existing records and backups.
export const STATES = { idle: '未开始', ...NODE_STATES, active: NODE_STATES.scheduled };
export const COMPANY_TYPES = ['私企', '央国企', '外企', '其他'];
export const JOB_ROLES = ['AI应用', 'Java后端', '研发', '通用', '未知'];
export function normalizeRole(value = '') {
  const role = value.trim();
  return JOB_ROLES.find(option => option.toLowerCase() === role.replace(/\s/g, '').toLowerCase()) ?? role;
}
export const END_REASONS = ['主动放弃', '岗位关闭', '其他原因'];
export const BACKUP_VERSION = 1;

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const requireValue = (condition, message) => { if (!condition) throw new AppError(message); };
export function text(value, label, max = 200, required = false) {
  requireValue(typeof value === 'string', `${label}必须是文本`);
  const result = value.trim();
  requireValue(result.length <= max, `${label}不能超过 ${max} 个字符`);
  requireValue(!required || result.length > 0, `请填写${label}`);
  return result;
}
export function validDate(value, label = '日期') {
  const date = text(value, label, 10);
  if (date) requireValue(/^\d{4}-\d{2}-\d{2}$/.test(date) && date >= '1900-01-01' && date <= '9999-12-31' && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date, `${label}不是有效日期`);
  return date;
}
function validTime(value, label) {
  const time = text(value, label, 5);
  requireValue(!time || /^([01]\d|2[0-3]):[0-5]\d$/.test(time), `${label}不是有效时间`);
  return time;
}
export function validUrl(value, label = '链接') {
  const url = text(value, label, 2000);
  if (!url) return '';
  try { const parsed = new URL(url); requireValue(['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password, `${label}请填写 http 或 https 地址`); }
  catch { throw new AppError(`${label}请填写完整的 http 或 https 地址`); }
  return url;
}
function validId(value) { requireValue(typeof value === 'string' && /^[\w-]{1,80}$/.test(value), '记录或节点标识无效'); return value; }
function timestamp(value) { requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)), '记录时间无效'); return value; }
export function nodeSchedule(node) {
  // Read older backups without losing a deadline or mixing times from different dates.
  if (node?.date) return { date: node.date, time: node.time || '' };
  return { date: node?.deadline || '', time: node?.deadline ? node.deadlineTime || '' : '' };
}
export function validateNode(input) {
  requireValue(input && typeof input === 'object' && !Array.isArray(input), '流程节点格式无效');
  requireValue(input.key === null || (Number.isInteger(input.key) && input.key >= 0 && input.key < STAGES.length), '标准阶段标识无效');
  requireValue(Object.hasOwn(STATES, input.status), '节点状态无效');
  const node = { id: validId(input.id), key: input.key, name: text(input.name, '节点名称', 40, true), status: input.status };
  if (node.key === 3 && node.name === '技术笔试') node.name = STAGES[3];
  for (const field of ['date', 'deadline', 'completedDate']) node[field] = validDate(input[field] ?? '', { date: '安排/截止日期', deadline: '截止日期', completedDate: '完成日期' }[field]);
  for (const field of ['time', 'deadlineTime']) node[field] = validTime(input[field] ?? '', field === 'time' ? '安排时间' : '截止时间');
  requireValue(!node.time || node.date, '填写具体时间时，请同时填写安排/截止日期');
  requireValue(!node.deadlineTime || node.deadline, '填写截止时间时，请同时填写截止日期');
  node.location = text(input.location ?? '', '地点', 300);
  node.meetingUrl = validUrl(input.meetingUrl ?? '', '会议链接');
  node.notes = text(input.notes ?? '', '阶段备注', 20000);
  return node;
}
export function validateNodes(input) {
  requireValue(Array.isArray(input) && input.length >= 1 && input.length <= 64, '招聘流程应包含 1 至 64 个节点');
  const nodes = input.map(validateNode);
  requireValue(new Set(nodes.map(n => n.id)).size === nodes.length, '流程中存在重复的节点标识');
  const keys = nodes.filter(n => n.key !== null).map(n => n.key);
  requireValue(new Set(keys).size === keys.length, '同一标准阶段不能重复添加，请使用自定义节点');
  return nodes;
}
export function splitCities(value) { return [...new Set(value.split(/[,，、;；]/).map(c => c.trim()).filter(Boolean))]; }
export function validateBasics(input) {
  requireValue(input && typeof input === 'object', '投递信息格式无效');
  requireValue(COMPANY_TYPES.includes(input.type), '企业性质无效');
  const result = { type: input.type };
  for (const [field,label,max,required] of [
    ['company','公司名称',120,true], ['role','岗位',150,false], ['city','工作城市',200,false],
    ['department','部门',150,false], ['batch','招聘批次',100,false], ['applicationNo','申请编号',100,false],
    ['salary','薪资信息',200,false], ['notes','投递备注',20000,false],
  ]) result[field] = text(input[field] ?? '', label, max, required);
  result.city = splitCities(result.city).join('、');
  result.role = normalizeRole(result.role);
  result.applied = validDate(input.applied ?? '', '投递日期');
  result.url = validUrl(input.url ?? '', '招聘链接');
  return result;
}
export function defaultNodes() {
  return STAGE_ORDER.map(key => ({ id: `stage-${key}`, key, name: STAGES[key], status: key === 0 ? 'waiting' : 'idle', date: '', time: '', deadline: '', deadlineTime: '', completedDate: '', location: '', meetingUrl: '', notes: '' }));
}
export function createApplication(input, id, now = new Date().toISOString()) {
  return { id: validId(id), ...validateBasics(input), workflowVersion: 2, created: now, updated: now, ended: false, endReason: '', offerDecision: 'pending', nodes: defaultNodes(), history: [] };
}
export function upgradeHrWorkflow(record) {
  if (record.workflowVersion === 2) return record;
  const upgrade = nodes => {
    if (nodes.some(n => n.key === 8)) return nodes;
    const existing = nodes.find(n => n.key === null && /^hr\s*面$/i.test(n.name));
    if (existing) return nodes.map(n => n === existing ? { ...n, key: 8, name: STAGES[8] } : n);
    // Preserve full custom workflows without exceeding the existing node limit.
    if (nodes.length >= 64) return nodes;
    const offer = nodes.findIndex(n => n.key === 7);
    const lastInterview = nodes.findLastIndex(n => INTERVIEW_KEYS.includes(n.key));
    const index = offer >= 0 ? offer : lastInterview >= 0 ? lastInterview + 1 : nodes.length;
    let id = 'stage-8';
    while (nodes.some(n => n.id === id)) id += '-hr';
    const status = nodes.slice(index).some(n => n.status !== 'idle') ? 'skipped' : 'idle';
    const hr = { ...defaultNodes().find(n => n.key === 8), id, status };
    return [...nodes.slice(0, index), hr, ...nodes.slice(index)];
  };
  return { ...record, workflowVersion: 2, nodes: upgrade(record.nodes), history: record.history.map(h => h.beforeNodes ? { ...h, beforeNodes: upgrade(h.beforeNodes) } : h) };
}
export function validateApplication(input) {
  requireValue(input && typeof input === 'object', '投递记录格式无效');
  requireValue(input.workflowVersion === undefined || [1, 2].includes(input.workflowVersion), '招聘流程版本无效');
  requireValue(typeof input.ended === 'boolean', '投递结束状态无效');
  requireValue(['pending','accepted','declined'].includes(input.offerDecision), 'Offer 接受状态无效');
  const nodes = validateNodes(input.nodes);
  requireValue(input.offerDecision === 'pending' || nodes.some(n => n.key === 7 && n.status === 'passed'), '接受或婉拒 Offer 前应先记录已收到 Offer');
  const endReason = text(input.endReason, '结束原因', 100);
  requireValue(!input.ended || END_REASONS.includes(endReason), '请选择有效的结束原因');
  requireValue(Array.isArray(input.history) && input.history.length <= 10000, '操作历史格式无效或超出限制');
  const history = input.history.map(h => {
    requireValue(h && typeof h === 'object', '历史记录格式无效');
    const entry = { time: timestamp(h.time), type: text(h.type, '历史类型', 40, true), text: text(h.text, '历史说明', 500, true) };
    if (h.beforeNodes) entry.beforeNodes = validateNodes(h.beforeNodes);
    if (h.beforeOfferDecision !== undefined) {
      requireValue(['pending','accepted','declined'].includes(h.beforeOfferDecision), '历史 Offer 状态无效');
      entry.beforeOfferDecision = h.beforeOfferDecision;
    }
    return entry;
  });
  return upgradeHrWorkflow({ id: validId(input.id), ...validateBasics(input), workflowVersion: input.workflowVersion ?? 1, created: timestamp(input.created), updated: timestamp(input.updated), ended: input.ended, endReason, offerDecision: input.offerDecision, nodes, history });
}
export function validateBackup(input) {
  requireValue(input?.format === 'winoffer-backup' && input.version === BACKUP_VERSION, '这不是受支持的 WinOffer 备份文件（需要版本 1）');
  timestamp(input.exportedAt);
  requireValue(Array.isArray(input.records) && input.records.length <= 10000, '备份记录格式无效，最多支持 10000 条投递');
  const records = input.records.map(validateApplication);
  requireValue(new Set(records.map(r => r.id)).size === records.length, '备份中存在重复的投递标识');
  return { format: 'winoffer-backup', version: BACKUP_VERSION, exportedAt: input.exportedAt, records };
}
export function info(record) {
  if (record.ended) return { kind: 'ended', title: record.endReason || '已主动结束', detail: '记录已保留，可以恢复投递', node: null };
  const failed = record.nodes.find(n => n.status === 'failed');
  if (failed) return { kind: 'ended', title: `${failed.name}未通过`, detail: '修改该节点的结果可纠正状态', node: failed };
  const offer = record.nodes.find(n => n.key === 7 && n.status === 'passed');
  if (offer) return { kind: record.offerDecision === 'declined' ? 'ended' : 'offer', title: { pending: '已收到 Offer', accepted: '已接受 Offer', declined: '已婉拒 Offer' }[record.offerDecision], detail: record.salary || '可在详情中记录接受情况', node: offer };
  // Later evidence takes precedence without inventing results for earlier stages.
  const lastIndex = record.nodes.findLastIndex(n => !['idle','skipped'].includes(n.status));
  const current = record.nodes[lastIndex];
  if (current && current.status !== 'passed') {
    const title = current.key === 0 && current.status === 'waiting' ? '已投递 · 等待筛选' : `${current.name}${STATES[current.status]}`;
    const schedule = nodeSchedule(current);
    return { kind: 'active', title, detail: schedule.date ? `${schedule.date} ${schedule.time}`.trim() : current.status === 'waiting' ? '等待招聘团队反馈' : '完成后更新进度', node: current };
  }
  const next = record.nodes.slice(lastIndex + 1).find(n => n.status !== 'skipped');
  return { kind: 'active', title: current ? `${current.name}已通过` : next ? '准备进入流程' : '所有阶段均已跳过', detail: next ? `等待${next.name}${next.key === 0 ? '' : '安排'}` : '等待最终反馈', node: next || current || null };
}
export function inInterview(record) { const state = info(record); return state.kind === 'active' && INTERVIEW_KEYS.includes(state.node?.key); }
export function hasPendingTask(record) {
  const state = info(record);
  // Earlier scheduled nodes may be stale once the application has moved to a later stage.
  return state.kind === 'active' && ['scheduled','active'].includes(state.node?.status) && [1, 2, 3, ...INTERVIEW_KEYS].includes(state.node.key);
}
export function pendingTaskKind(record) {
  if (!hasPendingTask(record)) return null;
  const key = info(record).node.key;
  return key === 1 ? 'assessment' : key === 3 ? 'written' : key === 2 || INTERVIEW_KEYS.includes(key) ? 'interview' : null;
}
function latestNodeDistance(record, now) {
  // Follow the actual workflow, including dates entered before choosing a status.
  // Do not fall back to an earlier node when the latest node has no date.
  const node = record.nodes.findLast(n => n.status !== 'skipped' && (n.status !== 'idle' || nodeSchedule(n).date));
  const schedule = nodeSchedule(node);
  if (!schedule.date) return Infinity;
  const start = new Date(`${schedule.date}T${schedule.time || '00:00'}`).getTime();
  if (!Number.isFinite(start)) return Infinity;
  if (schedule.time) return Math.abs(start - now);
  // A date without a time represents the whole local day, so today stays nearest.
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return Math.max(start - now, now - (end.getTime() - 1), 0);
}
export function sortApplications(records, sort = 'node-time', now = Date.now()) {
  if (sort === 'node-time') {
    return records.map(record => ({ record, distance: latestNodeDistance(record, now) }))
      .sort((a,b) => a.distance - b.distance || b.record.updated.localeCompare(a.record.updated))
      .map(({ record }) => record);
  }
  return [...records].sort((a,b) => sort === 'company' ? a.company.localeCompare(b.company, 'zh-CN') : sort === 'applied' ? b.applied.localeCompare(a.applied) : b.updated.localeCompare(a.updated));
}
export function standard(record) { return record.nodes.every((n,i) => n.key !== null && (i === 0 || STAGE_ORDER.indexOf(n.key) > STAGE_ORDER.indexOf(record.nodes[i - 1].key))); }
export const AUTO_SCREENING_NOTE = '后续节点已有进度，投递简历自动标记为已通过';
export function advanceResumeScreening(record) {
  const index = record.nodes.findIndex(n => n.key === 0);
  if (index < 0 || record.nodes[index].status !== 'waiting' || !record.nodes.slice(index + 1).some(n => n.status !== 'idle')) return record;
  return { ...record, nodes: record.nodes.map((n,i) => i === index ? { ...n, status: 'passed' } : n) };
}
export function applyChange(record, change, now = new Date().toISOString()) {
  const next = structuredClone(record);
  let message;
  let beforeNodes;
  switch (change?.type) {
    case 'basics': Object.assign(next, validateBasics(change.data)); message = '更新了投递基本信息'; break;
    case 'node': {
      const index = next.nodes.findIndex(n => n.id === change.nodeId);
      requireValue(index >= 0, '找不到该流程节点，请重新打开投递');
      const previous = next.nodes[index];
      const node = validateNode({ ...previous, ...change.data, id: previous.id, key: previous.key, name: previous.name });
      next.nodes[index] = node;
      message = previous.status === node.status ? `更新了${node.name}的时间与备注` : `${node.name}：${STATES[previous.status]} → ${STATES[node.status]}`;
      if (node.status !== 'idle') {
        let skipped = 0;
        next.nodes = next.nodes.map((earlier, i) => {
          // Follow the actual workflow order; resume screening has its own rule below.
          if (i >= index || earlier.key === 0 || earlier.status !== 'idle') return earlier;
          skipped++;
          return { ...earlier, status: 'skipped' };
        });
        if (skipped) message += `；前面 ${skipped} 个未开始节点自动标记为已跳过`;
      }
      break;
    }
    case 'workflow': beforeNodes = structuredClone(next.nodes); next.nodes = validateNodes(change.nodes); message = '调整了招聘流程'; break;
    case 'undo-workflow': {
      const last = next.history.at(-1);
      requireValue(last?.type === 'workflow' && last.beforeNodes, '只有最近一次操作是流程调整时才能撤销');
      next.nodes = structuredClone(last.beforeNodes);
      next.offerDecision = last.beforeOfferDecision ?? 'pending';
      message = '撤销了上一次流程调整'; break;
    }
    case 'end': requireValue(END_REASONS.includes(change.reason), '请选择结束原因'); next.ended = true; next.endReason = change.reason; message = `结束投递：${change.reason}`; break;
    case 'resume': next.ended = false; next.endReason = ''; message = '取消了主动结束标记'; break;
    case 'offer': requireValue(['pending','accepted','declined'].includes(change.decision) && next.nodes.some(n => n.key === 7 && n.status === 'passed'), '请先标记已收到 Offer'); next.offerDecision = change.decision; message = { pending: 'Offer 改为待决定', accepted: '已接受 Offer', declined: '已婉拒 Offer' }[change.decision]; break;
    default: throw new AppError('不支持的修改操作');
  }
  const advanced = advanceResumeScreening(next);
  if (advanced !== next) { next.nodes = advanced.nodes; message += `；${AUTO_SCREENING_NOTE}`; }
  if (!next.nodes.some(n => n.key === 7 && n.status === 'passed')) next.offerDecision = 'pending';
  next.updated = now;
  next.history.push({ time: now, type: change.type, text: message, ...(beforeNodes ? { beforeNodes, beforeOfferDecision: record.offerDecision } : {}) });
  return validateApplication(next);
}
