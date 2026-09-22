import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { Store } from '../server/store.js';

export const basics={company:'持久化测试公司',role:'后端开发工程师',type:'私企',city:'合肥、南京',url:'https://example.com/jobs',department:'研发部',batch:'2026 秋招',applicationNo:'A-001',salary:'20k × 15 薪',notes:'测试备注'};
export function fixture(t) {
  const root=resolve('.preview');mkdirSync(root,{recursive:true});
  const directory=mkdtempSync(join(root,'test-')),filename=join(directory,'winoffer.sqlite');
  const stores=[];
  function open(){const store=new Store(filename);stores.push(store);return store;}
  t.after(()=>{
    for(const store of stores){try{store.close();}catch{}}
    // The only recursive cleanup target is a directory created by this fixture.
    const target=resolve(directory);
    if(!target.startsWith(root+sep)||!target.startsWith(join(root,'test-')))throw new Error('Unsafe test cleanup path');
    rmSync(target,{recursive:true,force:true});
  });
  return {directory,filename,open};
}
