const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
let triggers=[],props={},next=0,fail=false,locked=false;
function trigger(id){return {getUniqueId:()=>id,getHandlerFunction:()=> 'lazyMapperBackgroundWorker'};}
const context=vm.createContext({WORKER_FN:'lazyMapperBackgroundWorker',activeJobs_:()=>[],
 LockService:{getUserLock:()=>({tryLock:()=>{locked=true;return true;},releaseLock:()=>{locked=false;}})},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k],setProperty:(k,v)=>props[k]=v})},
 ScriptApp:{getProjectTriggers:()=>triggers.slice(),deleteTrigger:t=>{triggers=triggers.filter(x=>x!==t);},
 newTrigger:()=>({timeBased:()=>({everyMinutes:n=>{assert.equal(n,1);return {create:()=>{if(fail)throw Error('quota');const t=trigger('new'+ ++next);triggers.push(t);return t;}};}})})}});
vm.runInContext(fs.readFileSync('apps-script/WorkerRepair.gs','utf8'),context);
triggers=[trigger('old-one-shot')];context.scheduleWorker_();assert.equal(triggers.length,1);assert.equal(next,1);
context.scheduleWorker_();assert.equal(next,1);assert.equal(triggers.length,1);
triggers=[];context.scheduleWorker_();assert.equal(triggers.length,1);assert.equal(next,2);
props={};fail=true;assert.throws(()=>context.scheduleWorker_());assert.equal(locked,false);assert.equal(triggers.length,1);
console.log('Apps Script: recurring trigger migration, idempotency, recovery and lock release: PASS');
