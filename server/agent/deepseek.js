import { setTimeout as delay } from 'node:timers/promises';
import { AppError } from '../../shared/model.js';

export class DeepSeek {
  constructor(config, fetchImpl=fetch) {this.config=config;this.fetch=fetchImpl;}
  async complete(messages, {tools, json=false, signal, onRetry=()=>{}}={}) {
    if(!this.config.key)throw new AppError('请在 .env.local 配置 DEEPSEEK_API_KEY',503);
    for(let attempt=0;attempt<3;attempt++) {
      signal?.throwIfAborted();
      if(attempt)onRetry();
      let response;
      try {
        response=await this.fetch('https://api.deepseek.com/chat/completions',{
          method:'POST',redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(60000),...(signal?[signal]:[])]),
          headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.config.key}`},
          body:JSON.stringify({model:this.config.model,messages,thinking:{type:'disabled'},max_tokens:4096,...(tools?{tools}:{}),...(json?{response_format:{type:'json_object'}}:{})})
        });
      } catch {if(signal?.aborted)signal.throwIfAborted();if(attempt<2){await delay(1000*(attempt+1),null,{signal});continue;}throw new AppError('DeepSeek 连接超时或网络异常，请稍后重试',503);}
      if(!response.ok){
        await response.body?.cancel();
        if((response.status===429||response.status>=500)&&attempt<2){await delay(1000*(attempt+1),null,{signal});continue;}
        throw new AppError(({401:'DeepSeek API Key 无效',402:'DeepSeek 余额不足',429:'DeepSeek 请求限流，请稍后重试'})[response.status]||`DeepSeek 请求失败（${response.status}），请检查模型配置`,503);
      }
      const chunks=[];let size=0;
      for await(const chunk of response.body){size+=chunk.length;if(size>1024*1024)throw new AppError('模型响应过大',502);chunks.push(chunk);}
      let data;try{data=JSON.parse(Buffer.concat(chunks).toString());}catch{throw new AppError('模型返回无效 JSON',502);}
      const choice=data.choices?.[0];
      if(!choice?.message||choice.finish_reason==='length')throw new AppError('模型输出不完整，请缩小任务范围',502);
      return choice.message;
    }
  }
}
