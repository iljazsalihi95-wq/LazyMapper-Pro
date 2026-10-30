/* LazyMapper V4 repair. Append AFTER the existing Codice.gs, once.
 * Preserves existing configuration and Script Properties. No embedded keys.
 */
var LM_V4_GET_BASE_ = doGet;
var LM_V4_POST_BASE_ = doPost;
var LM_V4_CREATE_BASE_ = createLazyMapperJob;
var LM_V4_PUBLIC_BASE_ = publicJob_;
var LM_V4_PRIVATE_ACTIONS_ = ['genres','channels','create_link','vod_genres','vod_items','series_genres','series_items','media_create_link','stbProfile'];

doGet = function(e) {
  var action=String(e&&e.parameter&&e.parameter.action||'ping');
  if(action==='jobStatus'||LM_V4_PRIVATE_ACTIONS_.indexOf(action)>=0)
    return json_({ok:false,error:'Use authenticated POST for this action'});
  return LM_V4_GET_BASE_(e);
};

doPost = function(e) {
  try {
    var body=parseBody_(e), action=String(body.action||'');
    if(['startJob','jobStatus','cancelJob','pauseJob','resumeJob','jobs'].indexOf(action)>=0 || LM_V4_PRIVATE_ACTIONS_.indexOf(action)>=0) {
      auth_(body.apiKey);
      if(action==='jobs') return json_({ok:true,jobs:lmV4Jobs_()});
      if(action==='startJob') return json_({ok:true,job:createLazyMapperJob(body)});
      if(action==='jobStatus') return json_({ok:true,job:getJob_(String(body.jobId||''))});
      if(['pauseJob','resumeJob','cancelJob'].indexOf(action)>=0)
        return json_({ok:true,job:lmV4Control_(String(body.jobId||''),action)});
      lmV4ValidatePortal_(body.portal,body.mac);
      var p=String(body.portal), m=String(body.mac), result;
      if(action==='genres') result=stalkerGenres_(p,m);
      if(action==='channels') result=stalkerChannels_(p,m,body.genre,body.page);
      if(action==='create_link') result=stalkerCreateLink_(p,m,body.cmd);
      if(action==='vod_genres'||action==='series_genres') result=stalkerMediaGenres_(p,m,action==='vod_genres'?'vod':'series');
      if(action==='vod_items'||action==='series_items') result=stalkerMediaItems_(p,m,action==='vod_items'?'vod':'series',body.genre,body.page);
      if(action==='media_create_link') result=stalkerMediaCreateLink_(p,m,body.mediaType,body.cmd);
      if(action==='stbProfile') {
        var session=stalkerSession_(p,m), raw=stalkerRequest_(session,'get_profile',{type:'stb'}), profile=stalkerPayload_(raw)||{};
        // Return a bounded diagnostic, never a session token or full provider response.
        result={ok:true,connected:true,profile:{status:String(profile.status||''),model:String(profile.model||profile.stb_type||''),timezone:String(profile.default_timezone||profile.timezone||'')}};
      }
      return json_(result);
    }
    return LM_V4_POST_BASE_(e);
  } catch(error) {
    return json_({ok:false,error:lmV4Error_(error)});
  }
};

function lmV4ValidatePortal_(portal,mac) {
  if(!/^https?:\/\/[^\s\/?#@]+(?:\/[^\s?#]*)?\/?$/i.test(String(portal||''))) throw Error('Portal URL invalid');
  if(!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(String(mac||''))) throw Error('Device MAC invalid');
}
function lmV4Error_(error) {
  var text=String(error&&error.message||error);
  if(/Unauthorized|LAZYMAPPER_API_KEY/.test(text)) return 'AUTH REQUIRED';
  if(/401|403|handshake pa token/i.test(text)) return 'AUTH REQUIRED';
  if(/429|quota|too many/i.test(text)) return 'RATE LIMITED';
  if(/invalid|mungon|mungojnë|nuk u gjet|Use authenticated|state|Queue full/i.test(text)) return text.replace(/https?:\/\/\S+/g,'[URL]').slice(0,180);
  return 'Provider/network error; progress retained';
}
function lmV4Lock_(fn) {
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(5000)) throw Error('Worker busy; retry control shortly');
  try{return fn();}finally{lock.releaseLock();}
}
function lmV4Read_(id) {
  var raw=PropertiesService.getScriptProperties().getProperty(JOB_PREFIX+id);
  if(!raw) throw Error('Job nuk u gjet');
  return JSON.parse(raw);
}
function lmV4Jobs_() {
  var props=PropertiesService.getScriptProperties().getProperties();
  return Object.keys(props).filter(function(k){return k.indexOf(JOB_PREFIX)===0;}).map(function(k){try{return publicJob_(JSON.parse(props[k]));}catch(e){return null;}}).filter(Boolean).sort(function(a,b){return String(b.updatedAt).localeCompare(String(a.updatedAt));}).slice(0,100);
}
publicJob_ = function(j) {
  var out=LM_V4_PUBLIC_BASE_(j);
  out.mediaType=String(j.mediaType||'LIVE');
  out.nextRunAt=Number(j.nextRunAt||0);
  out.retryCount=Number(j.retryCount||0);
  out.progress=j.state==='DONE'?100:Math.min(99,Math.floor(100*Number(j.genreIndex||0)/Math.max(1,Number(j.total||1))));
  out.message=String(out.message||'').replace(/https?:\/\/\S+/g,'[URL]').slice(0,180);
  return out;
};
createLazyMapperJob = function(data) {
  lmV4ValidatePortal_(data.portal,data.mac);
  var mt=String(data.mediaType||data.type||'LIVE').toUpperCase();
  if(['LIVE','VOD','SERIES'].indexOf(mt)<0) throw Error('Media type invalid');
  if(!Array.isArray(data.genres)||!data.genres.length||data.genres.length>500) throw Error('Genres invalid: 1–500 required');
  if(activeJobs_().length>=20) throw Error('Queue full');
  return LM_V4_CREATE_BASE_(data);
};
function lmV4Control_(id,action) {
  var result=lmV4Lock_(function(){
    var job=lmV4Read_(id);
    if(action==='pauseJob') {
      if(['QUEUED','RUNNING'].indexOf(job.state)<0) throw Error('Job state cannot pause');
      job.state='PAUSED'; job.message='Progresi u ruajt; puna u pezullua';
    } else if(action==='resumeJob') {
      if(['PAUSED','ERROR'].indexOf(job.state)<0) throw Error('Job state cannot resume');
      job.state='QUEUED'; job.nextRunAt=0; job.retryCount=0; job.message='Vazhdon nga faqja e ruajtur';
    } else {
      if(['DONE','CANCELLED'].indexOf(job.state)>=0) return publicJob_(job);
      job.state='CANCELLED';job.portal='';job.mac='';job.message='Job u anulua';
    }
    saveJob_(job);writeStatus_(job);return publicJob_(job);
  });
  if(action==='resumeJob') scheduleWorker_();
  return result;
}

// One non-overlapping trigger execution. Control requests only lock page commits.
lazyMapperBackgroundWorker = function() {
  var guard=LockService.getUserLock();
  if(!guard.tryLock(1)) return;
  var started=Date.now();
  try {
    var jobs=activeJobs_();
    for(var i=0;i<jobs.length && Date.now()-started<WORKER_MAX_MS;i++) {
      if(Number(jobs[i].nextRunAt||0)>Date.now()) continue;
      try {lmV4RunJob_(jobs[i].jobId,started);}
      catch(error) {
        (function(id,err){lmV4Lock_(function(){
          var job=lmV4Read_(id);
          if(['PAUSED','CANCELLED','DONE'].indexOf(job.state)>=0) return;
          var reason=lmV4Error_(err);
          job.retryCount=Number(job.retryCount||0)+1;
          job.state=reason==='AUTH REQUIRED'?'AUTH_REQUIRED':reason==='RATE LIMITED'?'RATE_LIMITED':job.retryCount>=4?'ERROR':'QUEUED';
          job.nextRunAt=Date.now()+Math.min(900000,60000*Math.pow(2,job.retryCount-1));
          job.message=reason;saveJob_(job);writeStatus_(job);
        });})(jobs[i].jobId,error);
      }
    }
  } finally {guard.releaseLock();}
};
function lmV4RunJob_(id,started) {
  var pages=0;
  while(pages<PAGES_PER_RUN && Date.now()-started<WORKER_MAX_MS) {
    var job=lmV4Lock_(function(){
      var j=lmV4Read_(id);if(['QUEUED','RUNNING'].indexOf(j.state)<0) return null;
      if(Number(j.nextRunAt||0)>Date.now()) return null;
      j.state='RUNNING';saveJob_(j);return j;
    });
    if(!job) return;
    if(job.genreIndex>=job.genres.length) {lmV4Finish_(id);return;}
    var genre=job.genres[job.genreIndex]||{}, gid=genre.id!==undefined?genre.id:genre.genre_id!==undefined?genre.genre_id:genre.category_id!==undefined?genre.category_id:genre;
    var mt=String(job.mediaType||'LIVE').toUpperCase(), result;
    result=mt==='LIVE'?stalkerChannels_(job.portal,job.mac,String(gid),Number(job.page||1)):stalkerMediaItems_(job.portal,job.mac,mt.toLowerCase(),String(gid),Number(job.page||1));
    if(!result||result.ok===false) throw Error(result&&result.error||'Provider error');
    var input=mt==='LIVE'?(result.channels||[]):(result.items||[]);
    if(!Array.isArray(input)) throw Error('Provider data invalid');
    var committed=lmV4Lock_(function(){
      var current=lmV4Read_(id);
      if(current.state!=='RUNNING') return false; // Pause/Cancel wins during network I/O.
      var items=input.map(function(x,index){
        if(mt==='LIVE') return channelItem_(current,genre,x,index);
        var cc=LM_COUNTRY_FROM_GENRE_FINAL_(genre);
        return {id:String(x.id||x.sourceId||id+'_'+current.genreIndex+'_'+current.page+'_'+index),sourceId:String(x.sourceId||x.id||''),source:'STALKER',type:mt,country:String(x.country||cc.name||'Other'),countryCode:String(x.countryCode||cc.code||'XX'),category:String(x.category||genre.title||genre.name||'General'),name:String(x.name||x.title||'Unknown'),url:String(x.url||x.stream_url||x.cmd||''),logo:String(x.poster||x.logo||''),status:'IMPORTED',serverId:current.serverId};
      });
      var grouped={};items.forEach(function(x){var tp=type_(x.type||mt);(grouped[tp]||(grouped[tp]=[])).push(x);});
      Object.keys(grouped).forEach(function(tp){upsertItems_(current.serverId,current.source,tp,grouped[tp]);});
      current.found=Number(current.found||0)+items.length;current.retryCount=0;current.nextRunAt=0;
      var max=Number(result.max_page||result.maxPage||0);
      if(!input.length||(max&&current.page>=max)){current.genreIndex++;current.page=1;}else{current.page++;}
      current.current=current.genreIndex;current.total=current.genres.length;current.state='QUEUED';current.message=mt+' • kategori '+current.genreIndex+'/'+current.total+' • faqe '+current.page;
      saveJob_(current);writeStatus_(current);return true;
    });
    if(!committed) return;
    pages++;
  }
}
function lmV4Finish_(id) {
  lmV4Lock_(function(){var job=lmV4Read_(id);if(['RUNNING','QUEUED'].indexOf(job.state)<0)return;
    rebuildCategories_(job.serverId);job.state='DONE';job.portal='';job.mac='';job.message='PËRFUNDOI • '+job.found;saveJob_(job);writeStatus_(job);
  });
}
// Never reset an existing private key from a helper or web request.
setupLazyMapperApiKey = function() {auth_(PropertiesService.getScriptProperties().getProperty('LAZYMAPPER_API_KEY'));return 'Existing key retained';};
// Some legacy media adapters return warning + an empty success on HTTP failure.
// Preserve legitimate empty categories, but propagate auth/rate failures to the queue.
var LM_V4_MEDIA_ITEMS_BASE_ = stalkerMediaItems_;
var LM_V4_MEDIA_GENRES_BASE_ = stalkerMediaGenres_;
stalkerMediaItems_ = function(portal,mac,mediaType,genre,page) {
  var result=LM_V4_MEDIA_ITEMS_BASE_(portal,mac,mediaType,genre,page);
  if(result&&/401|403|429|quota|handshake pa token/i.test(String(result.warning||''))) throw Error(String(result.warning));
  return result;
};
stalkerMediaGenres_ = function(portal,mac,mediaType) {
  var result=LM_V4_MEDIA_GENRES_BASE_(portal,mac,mediaType);
  if(result&&/401|403|429|quota|handshake pa token/i.test(String(result.warning||''))) throw Error(String(result.warning));
  return result;
};
