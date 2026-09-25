import { AppError } from '../../shared/model.js';
import { requireValue } from './proposals.js';

function page(items,url) {
  const limit=Number(url.searchParams.get('limit')||20),offset=Number(url.searchParams.get('cursor')||0);
  requireValue(Number.isInteger(limit)&&limit>0&&limit<=100&&Number.isInteger(offset)&&offset>=0,'分页参数无效');
  return {items:items.slice(offset,offset+limit),nextCursor:offset+limit<items.length?String(offset+limit):null,total:items.length};
}
export async function agentRoute(agent,req,url,readBody){
  const path=url.pathname,method=req.method;
  if(method==='GET'){
    if(path==='/api/agent/status')return agent.status();
    if(path==='/api/agent/tasks')return page(agent.tasks().map(({input,fingerprint,...task})=>task),url);
    if(path==='/api/agent/emails')return page(agent.repo.messages().map(({body,...m})=>m),url);
    if(path==='/api/agent/proposals')return page(agent.repo.list().filter(p=>!url.searchParams.get('state')||p.state===url.searchParams.get('state')),url);
    if(path==='/api/agent/drafts')return page(agent.drafts(),url);
    const match=path.match(/^\/api\/agent\/(tasks|emails|proposals)\/([\w-]+)$/);
    if(match){if(match[1]==='tasks'){const {input,fingerprint,...task}=agent.task(match[2]);return task;}return match[1]==='emails'?agent.repo.message(match[2]):agent.repo.get(match[2]);}
  }
  if(method==='POST'){
    const data=await readBody(req,256*1024);
    if(path==='/api/agent/cache/clear')return agent.repo.clearCache(Date.now());
    const kinds={'/api/agent/sync':'sync','/api/agent/tasks':'chat','/api/agent/analyze':'analyze','/api/agent/drafts':'draft','/api/agent/test-connection':'test','/api/agent/demo':'demo'};
    if(kinds[path])return {task:agent.start(kinds[path],data)};
    if(path==='/api/agent/proposals/preview')return agent.repo.preview(data.proposalId,data);
    let match=path.match(/^\/api\/agent\/tasks\/([\w-]+)\/cancel$/);
    if(match)return agent.cancel(match[1],data.expectedVersion);
    match=path.match(/^\/api\/agent\/proposals\/([\w-]+)\/(confirm|ignore|reopen)$/);
    if(match)return match[2]==='confirm'?agent.repo.confirm(match[1],data):agent.repo.transition(match[1],data.expectedVersion,match[2]==='reopen');
  }
  throw new AppError('未找到邮件助手操作',404);
}
