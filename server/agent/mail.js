import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { AppError } from '../../shared/model.js';
import { hash } from './proposals.js';

// Full MIME parsing is bounded; oversized messages are listed for manual review.
export async function parseMail(raw,identity,date) {
  const parsed=await simpleParser(raw,{skipImageLinks:true,skipTextToHtml:true});
  const body=parsed.text||'';
  return {identity,subject:(parsed.subject||'(无主题)').slice(0,500),from:parsed.from?.text||'',replyTo:parsed.replyTo?.value?.[0]?.address||parsed.from?.value?.[0]?.address||'',date:date||parsed.date?.toISOString()||'',body:body.slice(0,12000),truncated:body.length>12000,messageId:parsed.messageId||'',attachments:parsed.attachments.map(a=>a.filename||'附件'),bodyHash:hash(body)};
}
export class QQMail {
  constructor(config,createClient=options=>new ImapFlow(options)){this.config=config;this.createClient=createClient;}
  async connection(signal,action){
    if(!this.config.account||!this.config.password)throw new AppError('请配置 QQ_EMAIL 和 QQ_AUTH_CODE，并开启 QQ 邮箱 IMAP 服务',503);
    const client=this.createClient({host:'imap.qq.com',port:993,secure:true,auth:{user:this.config.account,pass:this.config.password},logger:false,disableAutoIdle:true,connectionTimeout:15000,socketTimeout:30000});
    const abort=()=>client.close();signal?.throwIfAborted();signal?.addEventListener('abort',abort,{once:true});
    client.on('error',()=>{});
    try{await client.connect();return await action(client);}catch(error){if(signal?.aborted)signal.throwIfAborted();if(error instanceof AppError)throw error;throw new AppError('QQ 邮箱连接或读取失败，请检查授权码、IMAP 开关和网络',503);}
    finally{signal?.removeEventListener('abort',abort);client.close();}
  }
  test(signal){return this.connection(signal,async()=>({connected:true}));}
  async scan({since,until,limit=100,known=[]},signal,onMessage){
    return this.connection(signal,async client=>{
      const lock=await client.getMailboxLock('INBOX',{readOnly:true});
      try {
        const ids=await client.search({since:new Date(since),before:new Date(new Date(until).getTime()+86400000)},{uid:true});
        const validity=String(client.mailbox.uidValidity),prefix=`${this.config.account.toLowerCase()}/INBOX/${validity}/`;
        const seen=new Set(known),pending=(ids||[]).filter(uid=>!seen.has(prefix+uid)).sort((a,b)=>a-b);
        for(const uid of pending.slice(0,limit)){
          signal?.throwIfAborted();
          const metadata=await client.fetchOne(uid,{bodyStructure:true,envelope:true,internalDate:true},{uid:true});
          if(!metadata)continue;
          const leaves=[],attachments=[];
          const visit=node=>{if(!node)return;if(node.disposition==='attachment'||node.dispositionParameters?.filename||node.parameters?.name){attachments.push(node.dispositionParameters?.filename||node.parameters?.name||'附件');return;}if(node.type==='message/rfc822')return;if(node.childNodes)node.childNodes.forEach(visit);else if(['text/plain','text/html'].includes(node.type))leaves.push(node);};
          visit(metadata.bodyStructure);
          const bodyPart=leaves.find(n=>n.type==='text/plain')||leaves[0],envelope=metadata.envelope||{};
          let message={body:'无法提取正文，请在 QQ 邮箱查看原文。',truncated:true};
          if(bodyPart){
            const part=bodyPart.part||'1',mime=`${part}.MIME`;
            const item=await client.fetchOne(uid,{bodyParts:[{key:mime,maxLength:16384},{key:part,maxLength:65536}]},{uid:true});
            const content=item?.bodyParts?.get(part),header=item?.bodyParts?.get(mime)||item?.bodyParts?.get(mime.toLowerCase());
            if(content&&header){message=await parseMail(Buffer.concat([header,Buffer.from('\r\n'),content]),prefix+uid);message.truncated=message.truncated||bodyPart.size>65536||header.length>=16384;}
          }
          Object.assign(message,{identity:prefix+uid,subject:(envelope.subject||'(无主题)').slice(0,500),from:(envelope.from||[]).map(a=>`${a.name||''} <${a.address||''}>`).join(', '),replyTo:envelope.replyTo?.[0]?.address||envelope.from?.[0]?.address||'',date:metadata.internalDate?.toISOString()||'',headerDate:envelope.date?String(envelope.date):'',messageId:envelope.messageId||'',inReplyTo:envelope.inReplyTo||'',attachments});
          signal?.throwIfAborted();await onMessage(message);
        }
        return {remaining:Math.max(0,pending.length-limit)};
      }finally{lock.release();}
    });
  }
}
