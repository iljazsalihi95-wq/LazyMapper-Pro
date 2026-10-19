// Replace scheduleWorker_ in the existing V3 project with this implementation.
// Do not install a second project or change existing web-app URLs.
function scheduleWorker_(){
  const guard=LockService.getUserLock();
  if(!guard.tryLock(5000)) throw new Error('Worker scheduler busy; retry');
  try{
    const props=PropertiesService.getScriptProperties();
    const expected=props.getProperty('LM_RECURRING_WORKER_ID');
    const triggers=ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()===WORKER_FN;});
    if(expected && triggers.some(function(t){return t.getUniqueId()===expected;})) return;
    const recurring=ScriptApp.newTrigger(WORKER_FN).timeBased().everyMinutes(1).create();
    props.setProperty('LM_RECURRING_WORKER_ID',recurring.getUniqueId());
    triggers.forEach(function(t){ScriptApp.deleteTrigger(t);});
  }finally{guard.releaseLock();}
}
function repairLazyMapperWorker(){
  scheduleWorker_();
  return {ok:true,activeJobs:activeJobs_().length,mode:'recurring-1-minute',message:'Worker trigger verified; existing jobs preserved'};
}
