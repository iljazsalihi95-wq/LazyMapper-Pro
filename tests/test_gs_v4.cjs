const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
let store={},rows=[],fetches=0,controlDuringFetch=false;
const lock=()=>({tryLock:()=>true,releaseLock(){}});
const c=vm.createContext({Date,JSON,Math,Number,String,Array,Object,Error,console,
 JOB_PREFIX:'LM_JOB_',WORKER_MAX_MS:10000,PAGES_PER_RUN:3,
 LockService:{getScriptLock:lock,getUserLock:lock},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>store[k],setProperty:(k,v)=>store[k]=v,getProperties:()=>({...store})})},
 doGet:e=>({base:true}),doPost:e=>({base:true,body:JSON.parse(e.postData.contents)}),
 parseBody_:e=>JSON.parse(e.postData.contents),json_:x=>x,
 auth_:key=>{if(key!=='test-only')throw Error('Unauthorized')},
 createLazyMapperJob:d=>({mediaType:d.mediaType}),publicJob_:j=>({...j,portal:undefined,mac:undefined}),
 activeJobs_:()=>Object.values(store).map(JSON.parse).filter(j=>['QUEUED','RUNNING'].includes(j.state)),
 getJob_:id=>c.publicJob_(JSON.parse(store['LM_JOB_'+id])),
 saveJob_:j=>store['LM_JOB_'+j.jobId]=JSON.stringify(j),writeStatus_(){},scheduleWorker_(){},
 stalkerChannels_:()=>{fetches++;if(controlDuringFetch)c.lmV4Control_('one','pauseJob');return {ok:true,channels:[{name:'Fixture'}],max_page:1}},
 stalkerMediaGenres_:()=>({ok:true,genres:[]}),
 stalkerMediaItems_:()=>({ok:true,items:[{id:'vod',name:'Film',cmd:'https://fixture.example/movie.mp4'}],max_page:1}),
 channelItem_:(j,g,x)=>({name:x.name,type:'LIVE'}),LM_COUNTRY_FROM_GENRE_FINAL_:()=>({name:'Albania',code:'AL'}),type_:s=>s,
 upsertItems_:(s,src,t,items)=>rows.push(...items),rebuildCategories_(){}});
vm.runInContext(fs.readFileSync('apps-script/RepairV4.gs','utf8'),c);
function seed(mt='LIVE'){store={LM_JOB_one:JSON.stringify({jobId:'one',state:'QUEUED',serverId:'SERVER_01',source:'STALKER',mediaType:mt,portal:'https://fixture.example',mac:'00:11:22:33:44:55',genreIndex:0,page:1,genres:[{id:'1',title:'Fixture'}],found:0})};rows=[];fetches=0;controlDuringFetch=false;}
const post=body=>c.doPost({postData:{contents:JSON.stringify(body)}});
assert.equal(post({action:'startJob'}).error,'AUTH REQUIRED');
assert.equal(c.doGet({parameter:{action:'genres'}}).ok,false);
assert.throws(()=>c.lmV4ValidatePortal_('javascript:alert(1)','00:11:22:33:44:55'));
assert.throws(()=>c.lmV4ValidatePortal_('https://fixture.example','wrong'));
seed();assert.equal(post({action:'pauseJob',jobId:'one',apiKey:'test-only'}).job.state,'PAUSED');
c.lazyMapperBackgroundWorker();assert.equal(fetches,0);
post({action:'resumeJob',jobId:'one',apiKey:'test-only'});c.lazyMapperBackgroundWorker();assert.equal(c.lmV4Read_('one').state,'DONE');assert.equal(rows.length,1);assert.equal(c.lmV4Read_('one').mac,'');
seed();controlDuringFetch=true;c.lazyMapperBackgroundWorker();assert.equal(c.lmV4Read_('one').state,'PAUSED');assert.equal(rows.length,0);
seed('VOD');c.lazyMapperBackgroundWorker();assert.equal(rows[0].type,'VOD');assert.equal(c.lmV4Read_('one').state,'DONE');
seed();c.stalkerChannels_=()=>{throw Error('HTTP 429 secret-url')};c.lazyMapperBackgroundWorker();assert.equal(c.lmV4Read_('one').state,'RATE_LIMITED');assert(!c.lmV4Read_('one').message.includes('secret'));
seed();c.stalkerChannels_=()=>{throw Error('network timeout')};c.lazyMapperBackgroundWorker();assert.equal(c.lmV4Read_('one').state,'QUEUED');assert(c.lmV4Read_('one').nextRunAt>Date.now());
seed();post({action:'cancelJob',jobId:'one',apiKey:'test-only'});assert.equal(c.lmV4Read_('one').portal,'');assert.equal(c.lmV4Read_('one').state,'CANCELLED');
console.log('Apps Script V4 authenticated actions, pause/resume/cancel, in-flight race, VOD dispatch, backoff and rate-limit stop: PASS');

const batch={action:'importBatch',apiKey:'test-only',serverId:'SERVER_20',source:'M3U',items:[{id:'one',type:'LIVE'},{id:'one',type:'LIVE'}]};
assert.equal(post({...batch,apiKey:'wrong'}).error,'AUTH REQUIRED');
assert.match(post({...batch,serverId:'SERVER_21'}).error,/invalid/i);
assert.equal(post(batch).body.items.length,1);
assert.equal(post({...batch,items:[{id:'one',serverId:'SERVER_01'}]}).ok,false);
assert.equal(post({action:'statusJob',jobId:'one',apiKey:'test-only'}).ok,true);
console.log('Apps Script batch authorization, destination validation, duplicate input protection and statusJob alias: PASS');
