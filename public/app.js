import { STAGES, defaultNodes, validateBasics, validateNode } from './model.js';
import { icon, esc } from './icons.js';
import * as view from './views.js';

const app=document.querySelector('#app'), dialog=document.querySelector('#editor');
let records=[], revision='', editorRevision='', loaded=false, busy=false, dirty=false;
let stateGeneration=0;
let searchComposing=false, searchFrame;
let activeRecordId, workflowDraft, pendingBackup, returnFocus, toastTimer;
let listData, listFrame, recordHeight=70;
const listResizeObserver=new ResizeObserver(()=>resizeList());
const state={query:'',quick:'all',filter:'all',type:'all',city:'all',stage:'all',sort:'node-time',page:1,connected:true,stale:false};
const find=id=>records.find(r=>r.id===id);

class RequestError extends Error { constructor(message,status){super(message);this.status=status;} }
async function request(path, options={}) {
  let response;
  try { response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(30000)}); }
  catch { state.connected=false; throw new RequestError('本地服务未响应，无法确认保存结果。填写内容已保留，请启动服务并重新连接，检查记录后再继续。',0); }
  let data;
  try { data=await response.json(); } catch { throw new RequestError('服务返回了无法识别的内容，请重新连接后再试。',500); }
  state.connected=true;
  if(!response.ok) throw new RequestError(data.error||'操作未完成，请重试。',response.status);
  return data;
}
function render({resetTableScroll=false}={}) {
  // Keep the native input and its IME session alive until composition has committed.
  if(!loaded||searchComposing||searchFrame!==undefined) return;
  const focused=document.activeElement?.id, input=document.querySelector('#search');
  const selection=focused==='search'?[input.selectionStart,input.selectionEnd]:null;
  const previousTable=app.querySelector('.table-scroll'),tablePosition={row:(previousTable?.scrollTop||0)/recordHeight,left:previousTable?.scrollLeft||0};
  const pageControl=document.activeElement?.dataset.pageControl;
  listResizeObserver.disconnect();
  listData=view.listRecords(records,state);state.page=listData.page;
  app.innerHTML=view.workspace(records,state,listData);
  if(state.stale) app.querySelector('main').insertAdjacentHTML('afterbegin','<div class="connection-alert" role="alert">其他页面已更新记录。<button data-action="reload">重新加载最新记录</button></div>');
  const table=app.querySelector('.table-scroll');
  if(table){
    measureRows(table);table.scrollLeft=tablePosition.left;table.scrollTop=resetTableScroll?0:tablePosition.row*recordHeight;
    syncListPosition();listResizeObserver.observe(table);
  }
  if(selection){const next=document.querySelector('#search');next.focus({preventScroll:true});next.setSelectionRange(...selection);}
  else if(pageControl)restorePageFocus(pageControl);
}
function restorePageFocus(key) {
  const next=[...app.querySelectorAll('[data-page-control]')].find(el=>el.dataset.pageControl===key&&!el.disabled)||app.querySelector('.pagination [aria-current="page"]');
  next?.focus({preventScroll:true});
}
function measureRows(table) {
  const available=table.clientHeight-table.querySelector('.table-head').offsetHeight;
  table.style.setProperty('--record-height',`${Math.max(70,Math.floor(available/listData.size*64)/64)}px`);
  recordHeight=parseFloat(getComputedStyle(table.querySelector('.application-row')).height);
}
function resizeList() {
  const table=app.querySelector('.table-scroll');if(!table)return;
  const row=table.scrollTop/recordHeight;
  measureRows(table);table.scrollTop=row*recordHeight;syncListPosition();
}
function syncListPosition() {
  const table=app.querySelector('.table-scroll');if(!table||!listData?.total)return;
  // Allow for independently rounded viewport and content heights at CSS zoom.
  const first=Math.min(listData.total-1,Math.max(0,Math.floor((table.scrollTop+2)/recordHeight)));
  const visibleHeight=Math.max(0,table.clientHeight-table.querySelector('.table-head').offsetHeight);
  listData.start=first+1;listData.end=Math.min(listData.total,Math.max(first+1,Math.ceil((table.scrollTop+visibleHeight-.5)/recordHeight)));
  const page=Math.floor(first/listData.size)+1;
  if(page!==state.page){
    const focused=document.activeElement?.dataset.pageControl;
    state.page=page;listData.page=page;
    app.querySelector('.pagination').outerHTML=view.paginationControls(listData);
    app.querySelector('.pagination-summary').textContent=view.paginationSummary(listData);
    if(focused)restorePageFocus(focused);
  }
  const range=app.querySelector('.page-range'),text=view.recordRange(listData,records.length);
  if(range.textContent!==text)range.textContent=text;
}
function updateSearch(input) {
  state.query=input.value;state.page=1;
  if(searchFrame!==undefined)cancelAnimationFrame(searchFrame);
  // Some browsers send a final input event after compositionend; let both finish first.
  searchFrame=requestAnimationFrame(()=>{searchFrame=undefined;render({resetTableScroll:true});});
}
async function loadRecords() {
  const generation=++stateGeneration;
  try {
    const data=await request('/api/state');
    if(generation!==stateGeneration)return;
    records=data.records;revision=data.revision;loaded=true;state.stale=false;render();
  } catch(error) {
    if(generation!==stateGeneration)return;
    if(loaded) render();
    else app.innerHTML=`<main class="startup-state" role="alert"><img src="/mark.svg" width="48" height="48" alt=""><h1>暂时无法打开工作区</h1><p>${esc(error.message)}</p><button class="button primary" data-action="reload">重新连接</button></main>`;
    throw error;
  }
}
function notify(message,isError=false) {
  const toast=document.querySelector('#toast');
  toast.classList.toggle('error',isError);toast.innerHTML=`${icon(isError?'close':'check')}<span>${esc(message)}</span>`;
  toast.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('visible'),isError?7000:3200);
}
function showError(error) {
  if(error.status===409){state.stale=true;render();}
  if(error.status===0) render();
  if(dialog.open){
    dialog.querySelector('.form-error')?.remove();
    dialog.querySelector('.dialog-header').insertAdjacentHTML('afterend',`<div class="form-error" role="alert">${esc(error.message)}</div>`);
    dialog.querySelector('.form-error').scrollIntoView({block:'nearest'});
  } else notify(error.message,true);
}
function open(content, options={}) {
  if(!dialog.open){returnFocus=document.activeElement;editorRevision=revision;}
  dialog.className=options.modal?'modal':'drawer';dialog.innerHTML=content;
  dirty=false;
  if(!dialog.open) dialog.showModal();
  dialog.scrollTop=0;
}
function close(force=false) {
  if(busy&&!force)return false;
  if(dirty&&!force&&!confirm('当前修改尚未保存，确定放弃这些修改并关闭？'))return false;
  dialog.close();dirty=false;workflowDraft=undefined;pendingBackup=undefined;activeRecordId=undefined;
  if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});else document.querySelector('[data-action="new"]')?.focus({preventScroll:true});
  return true;
}
function detail(r){activeRecordId=r.id;open(view.detail(r));}
function editNode(r,id){activeRecordId=r.id;open(view.nodeForm(r,r.nodes.find(n=>n.id===id)));}
function editWorkflow(r,preserve=false){activeRecordId=r.id;if(!preserve)workflowDraft=structuredClone(r.nodes);const changed=dirty;open(view.workflow(r,workflowDraft));dirty=preserve?changed:false;}
async function perform(action) {
  if(busy)return;
  busy=true;app.inert=true;dialog.setAttribute('aria-busy','true');
  const buttons=[...dialog.querySelectorAll('button,input,select,textarea')].map(el=>[el,el.disabled]);
  buttons.forEach(([el])=>el.disabled=true);
  try { await action(); }
  catch(error){showError(error);}
  finally {busy=false;app.inert=false;dialog.removeAttribute('aria-busy');buttons.forEach(([el,disabled])=>el.disabled=disabled);}
}
async function change(id,operation) {
  const data=await request(`/api/records/${id}`,{method:'PATCH',body:JSON.stringify({revision:editorRevision,change:operation})});
  stateGeneration++;
  records=records.map(r=>r.id===id?data.record:r);revision=data.revision;editorRevision=revision;dirty=false;render();
  return data.record;
}
async function previewBackup(backup) {
  pendingBackup=undefined;
  document.querySelector('#restore-preview').innerHTML='';
  const preview=await request('/api/restore/preview',{method:'POST',body:JSON.stringify({backup})});
  pendingBackup=backup;
  document.querySelector('#restore-preview').innerHTML=view.restorePreview(preview,records.length);
  document.querySelector('#restore-preview').scrollIntoView({block:'nearest',behavior:'smooth'});
}
async function downloadBackup() {
  const backup=await request('/api/backup');
  const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=`winoffer-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);notify('备份文件已生成，请确认浏览器完成下载');
}
async function handleAction(button) {
  if(busy)return;
  const {action,id,value,node,index}=button.dataset,r=find(id);
  if(action==='reload') {if(dialog.open&&!close())return;await perform(loadRecords);return;}
  if(action==='close'){close();return;}
  if(action==='filter'){state.filter=value;state.quick='all';state.page=1;render({resetTableScroll:true});return;}
  if(action==='quick-filter'){state.quick=state.quick===value?'all':value;state.filter='all';state.stage='all';state.page=1;render({resetTableScroll:true});app.querySelector(`[data-action="quick-filter"][data-value="${value}"]`)?.focus({preventScroll:true});return;}
  if(action==='type'){state.type=value;state.page=1;render({resetTableScroll:true});return;}
  if(action==='clear'){Object.assign(state,{query:'',quick:'all',filter:'all',type:'all',city:'all',stage:'all',page:1});render({resetTableScroll:true});return;}
  if(action==='page'){
    const page=Number(value),table=app.querySelector('.table-scroll');
    if(!table||!Number.isInteger(page)||page<1||page>listData.pages)return;
    table.scrollTo({top:(page-1)*listData.size*recordHeight,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});return;
  }
  if(action==='new'){open(view.recordForm());return;}
  if(action==='help'){open(view.help(),{modal:true});return;}
  if(action==='detail'){detail(r);return;}
  if(action==='delete-record'){
    open(view.deleteConfirmation(r),{modal:true});
    dialog.querySelector('[data-action="cancel-delete"]').focus();return;
  }
  if(action==='cancel-delete'){
    detail(r);dialog.querySelector('[data-action="delete-record"]').focus();return;
  }
  if(action==='confirm-delete'){
    await perform(async()=>{
      const data=await request(`/api/records/${id}`,{method:'DELETE',body:JSON.stringify({revision:editorRevision})});
      stateGeneration++;
      records=records.filter(record=>record.id!==data.id);revision=data.revision;editorRevision=revision;state.stale=false;
      render();close(true);notify(`已删除“${r.company}”的投递记录`);
    });return;
  }
  if(action==='edit-record'){open(view.recordForm(r));return;}
  if(action==='node'){editNode(r,node);return;}
  if(action==='clear-node-progress'){
    const form=button.closest('#node-form');
    if(!form.reportValidity())return;
    const data={...Object.fromEntries(new FormData(form)),deadline:'',deadlineTime:'',status:'idle'};
    await perform(async()=>{
      const n=r.nodes.find(n=>n.id===node);
      validateNode({...n,...data});
      await change(id,{type:'node',nodeId:node,data});close(true);notify(`${n.name}进度已清除，时间与备注已保留`);
    });return;
  }
  if(action==='workflow'){editWorkflow(r);return;}
  if(action==='move-node'){
    const i=Number(index),j=i+Number(value);if(j<0||j>=workflowDraft.length)return;
    [workflowDraft[i],workflowDraft[j]]=[workflowDraft[j],workflowDraft[i]];dirty=true;editWorkflow(find(activeRecordId),true);return;
  }
  if(action==='remove-node'){
    if(workflowDraft.length<=1)return;
    const n=workflowDraft[Number(index)];
    if((n.status!=='idle'||n.notes||n.date||n.deadline||n.location||n.meetingUrl||n.completedDate)&&!confirm(`移除“${n.name}”会一并移除其状态、时间和备注。保存后可撤销最近一次流程调整。确定移除？`))return;
    workflowDraft.splice(Number(index),1);dirty=true;editWorkflow(find(activeRecordId),true);return;
  }
  if(action==='save-workflow'){await perform(async()=>{const saved=await change(id,{type:'workflow',nodes:workflowDraft});detail(saved);notify('招聘流程已保存');});return;}
  if(action==='undo-workflow'){await perform(async()=>{detail(await change(id,{type:'undo-workflow'}));notify('已撤销上一次流程调整');});return;}
  if(action==='end'){open(view.endForm(r));return;}
  if(action==='resume'){await perform(async()=>{detail(await change(id,{type:'resume'}));notify('已取消主动结束标记，状态按节点结果重新计算');});return;}
  if(action==='backups'){
    await perform(async()=>{const data=await request('/api/backups');open(view.backupsPanel(data.files,records.length));});return;
  }
  if(action==='export'){await perform(downloadBackup);return;}
  if(action==='preview-safety'){
    const filename=document.querySelector('#safety-backup').value;
    if(!filename){notify('请先选择一份自动备份',true);return;}
    await perform(async()=>previewBackup(await request(`/api/backups/${encodeURIComponent(filename)}`)));return;
  }
  if(action==='restore'){
    if(!pendingBackup||!document.querySelector('#confirm-restore')?.checked)return;
    await perform(async()=>{
      const data=await request('/api/restore',{method:'POST',body:JSON.stringify({revision:editorRevision,backup:pendingBackup})});
      stateGeneration++;
      records=data.records;revision=data.revision;state.stale=false;
      Object.assign(state,{query:'',quick:'all',filter:'all',type:'all',city:'all',stage:'all',page:1});render({resetTableScroll:true});close(true);
      notify(`已恢复 ${records.length} 条投递，恢复前的数据已自动备份`);
    });
  }
}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-action]');if(button)handleAction(button).catch(showError);
});
app.addEventListener('scroll',event=>{
  if(!event.target.matches('.table-scroll')||listFrame!==undefined)return;
  // Update only the footer; keep the records and native scrolling uninterrupted.
  listFrame=requestAnimationFrame(()=>{listFrame=undefined;syncListPosition();});
},{capture:true,passive:true});

document.addEventListener('compositionstart',event=>{
  if(event.target.id!=='search')return;
  searchComposing=true;
  if(searchFrame!==undefined){cancelAnimationFrame(searchFrame);searchFrame=undefined;}
});
document.addEventListener('compositionend',event=>{
  if(event.target.id!=='search')return;
  searchComposing=false;updateSearch(event.target);
});
document.addEventListener('input',event=>{
  if(event.target.id==='search'){
    if(event.isComposing)searchComposing=true;
    if(!searchComposing)updateSearch(event.target);
    return;
  }
  if(dialog.contains(event.target)&&event.target.closest('form')&&!event.target.closest('#add-node-form'))dirty=true;
});
document.addEventListener('change',event=>{
  const keys={'stage-filter':'stage','type-filter':'type','city-filter':'city',sort:'sort'};
  if(keys[event.target.id]){state[keys[event.target.id]]=event.target.value;state.page=1;render({resetTableScroll:true});return;}
  if(event.target.id==='confirm-restore'){dialog.querySelector('[data-action="restore"]').disabled=!event.target.checked;return;}
  if(event.target.id==='backup-file'){
    const file=event.target.files[0];if(!file)return;
    perform(async()=>{
      if(file.size>64*1024*1024)throw new Error('备份文件不能超过 64 MB');
      let data;try{data=JSON.parse(await file.text());}catch{throw new Error('所选文件不是有效的 JSON 备份');}
      await previewBackup(data);
    });
  }
});
document.addEventListener('submit',event=>{
  event.preventDefault();if(busy)return;
  const form=event.target,data=Object.fromEntries(new FormData(form)),id=form.dataset.id;
  if(form.id==='add-node-form'){
    if(workflowDraft.length>=64){showError(new Error('最多支持 64 个流程节点'));return;}
    const key=data.kind==='custom'?null:Number(data.kind),name=key===null?data.name.trim():STAGES[key];
    if(!name){showError(new Error('请填写自定义节点名称'));return;}
    const node={...defaultNodes()[0],id:crypto.randomUUID(),key,name,status:'idle'};
    const offer=workflowDraft.findIndex(n=>n.key===7);
    workflowDraft.splice(offer>=0?offer:workflowDraft.length,0,node);dirty=true;editWorkflow(find(activeRecordId),true);return;
  }
  perform(async()=>{
    if(form.id==='record-form'){
      // A disabled legacy option stays visible without becoming a new selectable category.
      if(!Object.hasOwn(data,'role')&&id)data.role=find(id).role;
      const basics=validateBasics(data);
      if(id) await change(id,{type:'basics',data:basics});
      else {
        const response=await request('/api/records',{method:'POST',body:JSON.stringify({revision:editorRevision,record:basics})});
        stateGeneration++;
        records.push(response.record);revision=response.revision;
        Object.assign(state,{query:'',quick:'all',filter:'all',type:'all',city:'all',stage:'all',sort:'node-time',page:1});render({resetTableScroll:true});
      }
      dirty=false;close(true);notify(id?'投递信息已保存':'投递已保存，祝你收获好消息');
    }
    if(form.id==='node-form'){
      const n=find(id).nodes.find(n=>n.id===form.dataset.node);
      // The single date/time pair replaces either legacy date field, including when cleared.
      Object.assign(data,{deadline:'',deadlineTime:''});
      validateNode({...n,...data});
      await change(id,{type:'node',nodeId:n.id,data});close(true);notify(`${n.name}进度已保存`);
    }
    if(form.id==='end-form'){detail(await change(id,{type:'end',reason:data.reason}));notify('已结束投递，全部记录仍保留');}
    if(form.id==='offer-form'){detail(await change(id,{type:'offer',decision:data.decision}));notify('Offer 接受情况已保存');}
  });
});
dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
dialog.addEventListener('click',event=>{
  if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();}
});
document.addEventListener('keydown',event=>{
  if(searchComposing||event.isComposing||dialog.open||event.altKey||event.ctrlKey||event.metaKey||event.target.closest('input,textarea,select,[contenteditable="true"]'))return;
  if(event.key==='/'){event.preventDefault();document.querySelector('#search')?.focus();}
});
window.addEventListener('beforeunload',event=>{if(dirty||busy){event.preventDefault();event.returnValue='';}});
window.addEventListener('focus',()=>{if(loaded&&!busy&&!dialog.open)loadRecords().catch(()=>{});});
app.innerHTML='<main class="startup-state" role="status"><img src="/mark.svg" width="48" height="48" alt=""><h1>正在打开你的工作区…</h1><p>读取本地投递记录</p></main>';
loadRecords().catch(()=>{});
