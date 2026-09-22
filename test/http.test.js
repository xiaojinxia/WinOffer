import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server/http.js';
import { fixture, basics } from './helpers.js';

async function setup(t){
  const f=fixture(t),store=f.open(),server=createAppServer(store);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}`;
  const req=(path,method='GET',data,headers={})=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
  return {store,server,base,req};
}
test('真实 HTTP 新建、更新、导出、恢复闭环',async t=>{
  const {req}=await setup(t);
  let state=await (await req('/api/state')).json();assert.equal(state.records.length,0);
  let response=await req('/api/records','POST',{revision:state.revision,record:basics});assert.equal(response.status,201);
  let saved=await response.json();
  response=await req(`/api/records/${saved.record.id}`,'PATCH',{revision:saved.revision,change:{type:'node',nodeId:'stage-4',data:{status:'passed'}}});assert.equal(response.status,200);
  saved=await response.json();
  const backup=await (await req('/api/backup')).json();assert.equal(backup.records[0].nodes[4].status,'passed');
  response=await req('/api/restore/preview','POST',{backup});assert.equal((await response.json()).count,1);
  response=await req('/api/restore','POST',{revision:saved.revision,backup});assert.equal(response.status,200);
  assert.equal((await (await req('/api/backups')).json()).files.length,1);
});
test('本地服务拒绝跨站修改，不对外暴露数据库或任意文件',async t=>{
  const {req}=await setup(t);
  const response=await req('/api/records','POST',{record:basics},{Origin:'https://unrelated.example'});assert.equal(response.status,403);
  for(const path of ['/data/winoffer.sqlite','/server/store.js','/.git/config','/../package.json'])assert.equal((await req(path)).status,404);
  assert.equal((await req('/api/state')).status,200);
});

test('删除接口校验来源和版本，成功后列表与备份不再含被删除记录',async t=>{
  const {req}=await setup(t);
  const initial=await (await req('/api/state')).json();
  const created=await (await req('/api/records','POST',{revision:initial.revision,record:basics})).json();
  const path=`/api/records/${created.record.id}`;
  assert.equal((await req(path,'DELETE',{revision:created.revision},{Origin:'https://unrelated.example'})).status,403);
  assert.equal((await req(path,'DELETE',{revision:created.revision},{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await req(path,'DELETE',{})).status,409);
  assert.equal((await req(path,'DELETE',null)).status,400);
  assert.equal((await req(path,'DELETE',{revision:initial.revision})).status,409);
  const before=await (await req('/api/state')).json();assert.equal(before.records.length,1);assert.equal(before.revision,created.revision);
  const response=await req(path,'DELETE',{revision:created.revision});assert.equal(response.status,200);
  const removed=await response.json();assert.equal(removed.id,created.record.id);assert.notEqual(removed.revision,created.revision);
  assert.deepEqual((await (await req('/api/state')).json()).records,[]);
  assert.deepEqual((await (await req('/api/backup')).json()).records,[]);
  assert.equal((await req(path,'DELETE',{revision:removed.revision})).status,404);
  assert.equal((await (await req('/api/state')).json()).revision,removed.revision);
});
test('无效 JSON、字段和版本返回明确错误，页面加载和旧链接重定向正常',async t=>{
  const {req,base}=await setup(t);
  assert.equal((await req('/api/records','POST',null)).status,400);
  let response=await fetch(base+'/api/records',{method:'POST',headers:{'Content-Type':'application/json'},body:'{broken'});assert.equal(response.status,400);
  response=await req('/api/restore/preview','POST',{backup:{version:5}});assert.equal(response.status,400);
  response=await req('/');assert.equal(response.status,200);assert.match(await response.text(),/WinOffer/);
  response=await fetch(base+'/prototype?variant=A',{redirect:'manual'});assert.equal(response.status,302);assert.equal(response.headers.get('location'),'/');
});
