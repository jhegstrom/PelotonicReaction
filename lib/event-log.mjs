import * as disk from 'node:fs';
import path from 'node:path';

const defaults={level:'INFO',maxFileBytes:5242880,retainedFiles:5,console:false,disabledEvents:[]};
let template=defaults;
try{template=JSON.parse(disk.readFileSync(new URL('../event-log.config.json',import.meta.url),'utf8'));}catch{}
const levels={OFF:Infinity,ERROR:50,WARN:40,INFO:30,DEBUG:20,FULL:10};
const secretKey=/token|secret|password|authorization|cookie|credential|binding/i;
function scrub(text){
  return String(text).replace(/Bearer\s+[^\s"'<>]+/gi,'Bearer [REDACTED]')
    .replace(/((?:access_token|refresh_token|client_secret|password|authorization|cookie|state|code)["']?\s*[=:]\s*["']?)[^\s&,"'<>]+/gi,'$1[REDACTED]').slice(0,2048);
}
function clean(value,depth=0){
  if(depth>6)return '[truncated]';
  if(value instanceof Error)return clean({type:value.name,message:value.message,code:value.code,syscall:value.syscall},depth+1);
  if(typeof value==='string')return scrub(value);
  if(Array.isArray(value))return value.slice(0,20).map(v=>clean(v,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,40).map(([k,v])=>[k,secretKey.test(k)?'[REDACTED]':clean(v,depth+1)]));
  return value;
}
function validate(input){
  if(!input||Array.isArray(input)||typeof input!=='object')throw Error('Configuration must be an object.');
  const c={...defaults,...input};
  if(!Object.hasOwn(levels,c.level))throw Error('level must be OFF, ERROR, WARN, INFO, DEBUG, or FULL.');
  if(!Number.isInteger(c.maxFileBytes)||c.maxFileBytes<256||c.maxFileBytes>100*1024*1024)throw Error('maxFileBytes must be 256–104857600.');
  if(!Number.isInteger(c.retainedFiles)||c.retainedFiles<1||c.retainedFiles>20)throw Error('retainedFiles must be 1–20 (including the current file).');
  if(typeof c.console!=='boolean'||!Array.isArray(c.disabledEvents)||!c.disabledEvents.every(e=>typeof e==='string'))throw Error('console must be boolean and disabledEvents an array of event names.');
  return c;
}
export const nullLogger={event:()=>false};
export class EventLogger {
  constructor(root,{now=Date.now,stderr=line=>process.stderr.write(line),io=disk}={}){
    this.io=io;this.now=now;this.stderr=stderr;this.config={...defaults};
    this.configPath=path.join(root,'event-log.config.json');this.directory=path.join(root,'.data','logs');this.file=path.join(this.directory,'events.jsonl');
    this.lastConfigCheck=-Infinity;this.lastFailure=-Infinity;
    try{io.mkdirSync(root,{recursive:true});if(!io.existsSync(this.configPath))io.writeFileSync(this.configPath,JSON.stringify(template,null,2)+'\n',{flag:'wx',mode:0o600});}
    catch(error){if(error.code!=='EEXIST')this.report('log.config_write_failed',error);}
    this.reload(true);
  }
  report(event,error){
    // A full/unwritable log volume must not stop recording or recurse into itself.
    if(this.now()-this.lastFailure<60000)return;
    this.lastFailure=this.now();
    try{this.stderr(JSON.stringify({timestamp:new Date(this.now()).toISOString(),level:'ERROR',service:'PelotonicReaction',event,...clean({error})})+'\n');}catch{}
  }
  reload(force=false){
    if(!force&&this.now()-this.lastConfigCheck<5000)return;
    this.lastConfigCheck=this.now();
    try{
      const text=this.io.readFileSync(this.configPath,'utf8');if(text===this.configText)return;
      this.config=validate(JSON.parse(text));this.configText=text;
    }catch(error){this.report('log.config_invalid',error);}
  }
  event(level,event,fields={}){
    try{
      this.reload();level=level.toUpperCase();
      if(!Object.hasOwn(levels,level)||level==='OFF'||levels[level]<levels[this.config.level]||this.config.level==='OFF'||this.config.disabledEvents.includes(event))return false;
      const entry=JSON.stringify({...clean(fields),schemaVersion:1,pid:process.pid,timestamp:new Date(this.now()).toISOString(),level,service:'PelotonicReaction',event:scrub(event)})+'\n';
      this.io.mkdirSync(this.directory,{recursive:true,mode:0o700});this.io.chmodSync(this.directory,0o700);
      if(this.io.existsSync(this.file)&&this.io.statSync(this.file).size+Buffer.byteLength(entry)>this.config.maxFileBytes){
        const archive=i=>path.join(this.directory,`events.${i}.jsonl`);
        const last=this.config.retainedFiles-1;
        for(const name of this.io.readdirSync(this.directory)){const match=name.match(/^events\.(\d+)\.jsonl$/);if(match&&Number(match[1])>=this.config.retainedFiles)this.io.unlinkSync(path.join(this.directory,name));}
        if(last){if(this.io.existsSync(archive(last)))this.io.unlinkSync(archive(last));for(let i=last-1;i>=1;i--)if(this.io.existsSync(archive(i)))this.io.renameSync(archive(i),archive(i+1));this.io.renameSync(this.file,archive(1));}
        else this.io.unlinkSync(this.file);
      }
      this.io.appendFileSync(this.file,entry,{mode:0o600});this.io.chmodSync(this.file,0o600);
      if(this.config.console)this.stderr(entry);
      return true;
    }catch(error){this.report('log.write_failed',error);return false;}
  }
}
