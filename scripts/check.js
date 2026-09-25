import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function check(directory) {
  for(const entry of readdirSync(directory,{withFileTypes:true})) {
    const path=join(directory,entry.name);
    if(entry.isDirectory())check(path);
    else if(entry.name.endsWith('.js')){
      const result=spawnSync(process.execPath,['--check',path],{stdio:'inherit',windowsHide:true});
      if(result.status!==0)process.exit(result.status||1);
    }
  }
}
for(const directory of ['server','shared','public','scripts'])check(directory);
console.log('JavaScript syntax checks passed.');
