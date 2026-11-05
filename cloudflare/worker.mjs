// One authenticated gateway for the existing UI, Apps Script and analyzer queue.
// Never accepts an upstream origin or authorization header from a client.
const encoder = new TextEncoder();
const keyCache = new Map();
const actions = new Set(['ping','list','importBatch','startJob','jobStatus','statusJob','pauseJob','resumeJob','cancelJob','jobs','genres','channels','create_link','vod_genres','vod_items','series_genres','series_items','media_create_link','stbProfile']);
const portalActions = new Set(['startJob','genres','channels','create_link','vod_genres','vod_items','series_genres','series_items','media_create_link','stbProfile']);
function failure(status, message) { return Response.json({ok:false,error:message}, {status,headers:{'Cache-Control':'no-store'}}); }
function decode(text) {
  if(!/^[A-Za-z0-9_-]+$/.test(text))throw Error('JWT encoding');
  return Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
}
export async function identity(request, env, transport=fetch) {
  const issuer=String(env.ACCESS_ISSUER||'');
  if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer)||!env.ACCESS_AUD)throw Error('Access configuration missing');
  const jwt=request.headers.get('Cf-Access-Jwt-Assertion')||'';
  if(jwt.length>16384)throw Error('JWT size');
  const parts=jwt.split('.');if(parts.length!==3)throw Error('AUTH REQUIRED');
  const header=JSON.parse(new TextDecoder().decode(decode(parts[0])));
  const claims=JSON.parse(new TextDecoder().decode(decode(parts[1])));
  const now=Math.floor(Date.now()/1000);
  if(header.alg!=='RS256'||!header.kid||claims.iss!==issuer||!Array.isArray(claims.aud)||!claims.aud.includes(env.ACCESS_AUD)||!Number.isFinite(claims.exp)||claims.exp<=now||!Number.isFinite(claims.iat)||claims.iat>now+30||(claims.nbf!=null&&claims.nbf>now+30))throw Error('JWT claims');
  let cached=keyCache.get(issuer);
  if(!cached||cached.until<Date.now()){
    const r=await transport(issuer+'/cdn-cgi/access/certs',{redirect:'error',signal:AbortSignal.timeout(8000)});
    if(!r.ok)throw Error('Access keys unavailable');
    cached={keys:(await r.json()).keys,until:Date.now()+300000};
    keyCache.set(issuer,cached);
  }
  const jwk=cached.keys?.find(k=>k.kid===header.kid&&k.kty==='RSA');
  if(!jwk)throw Error('Unknown signing key');
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),encoder.encode(parts[0]+'.'+parts[1])))throw Error('JWT signature');
  const admins=String(env.ADMIN_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(!claims.email||!admins.includes(claims.email.toLowerCase()))throw Error('Administrator required');
  return {email:claims.email,sub:claims.sub};
}
export function fixedOrigin(value) {
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('Upstream configuration invalid');
  return u.origin;
}
export function portalAllowed(value, env) {
  const u=new URL(value);
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('Portal URL invalid');
  if(!String(env.PORTAL_ORIGINS||'').split(',').map(x=>x.trim()).includes(u.origin))throw Error('Portal not authorized');
}
async function readBody(request, max=1048576) {
  if(Number(request.headers.get('content-length'))>max)throw Error('Request too large');
  if(!request.body)throw Error('JSON body required');
  const reader=request.body.getReader(),chunks=[];let length=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>max)throw Error('Request too large');chunks.push(value);}}
  finally{await reader.cancel();}
  const bytes=new Uint8Array(length);let offset=0;for(const x of chunks){bytes.set(x,offset);offset+=x.length;}
  const body=JSON.parse(new TextDecoder().decode(bytes));
  if(!body||Array.isArray(body)||typeof body!=='object')throw Error('JSON object required');
  return body;
}
async function script(body,env,transport) {
  if(!actions.has(body.action))return failure(400,'Unknown script action');
  if(body.action==='statusJob')body.action='jobStatus';
  if(body.serverId&&!/^SERVER_(0[1-9]|1[0-9]|20)$/.test(body.serverId))return failure(400,'Invalid server');
  if(portalActions.has(body.action))portalAllowed(body.portal,env);
  if(body.action==='importBatch'&&(!Array.isArray(body.items)||!body.items.length||body.items.length>40))return failure(400,'Import accepts 1–40 items');
  const url=new URL(env.GAS_URL);
  if(url.origin!=='https://script.google.com'||!/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)||url.search||!env.GAS_API_KEY)throw Error('Apps Script configuration missing');
  if(body.action==='list'){
    if(!body.serverId||!['LIVE','VOD','SERIES','24_7'].includes(body.type))return failure(400,'Invalid list selection');
    url.search=new URLSearchParams({action:'listJsonp',serverId:body.serverId,type:body.type,offset:String(Math.max(0,Number(body.offset)||0)),limit:String(Math.min(500,Math.max(1,Number(body.limit)||500))),callback:'lm_gateway'}).toString();
    const r=await transport(url.href,{redirect:'follow',signal:AbortSignal.timeout(30000)});
    if(!r.ok)return failure(502,'Server list unavailable');
    const text=await r.text(),match=text.match(/^\s*lm_gateway\(([\s\S]*)\);?\s*$/);
    if(!match)return failure(502,'Invalid list JSONP');
    const data=JSON.parse(match[1]);
    if(data?.ok!==true||!Array.isArray(data.items))return failure(502,'Invalid list response');
    return Response.json(data,{headers:{'Cache-Control':'no-store'}});
  }
  const r=await transport(url.href,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...body,apiKey:env.GAS_API_KEY}),redirect:'follow',signal:AbortSignal.timeout(60000)});
  if(!r.ok)return failure(502,'Apps Script HTTP '+r.status);
  const result=await r.json();
  if(result?.ok!==true)return failure(/AUTH|Unauthorized/i.test(result?.error||'')?401:502,'Apps Script rejected action');
  // Server-side adapter returns only the public job/metadata schema. Secrets are
  // never supplied by clients or sent as URL parameters.
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
}
export async function handle(request,env,transport=fetch) {
  const url=new URL(request.url);
  if(!env.ACCESS_ISSUER||!env.ACCESS_AUD||!env.ADMIN_EMAILS)return failure(503,'Access configuration missing');
  let user;
  try{user=await identity(request,env,transport);}catch{return failure(401,'AUTH REQUIRED');}
  // Same-origin cookie authorization; block cross-site mutations and CORS use.
  const origin=request.headers.get('Origin');
  if(origin&&origin!==url.origin)return failure(403,'Origin denied');
  if(!['GET','POST'].includes(request.method))return failure(405,'Method not allowed');
  if(url.pathname.startsWith('/api/')){
    if(!env.RATE_LIMITER)return failure(503,'Rate limiter missing');
    if(!(await env.RATE_LIMITER.limit({key:user.sub||user.email})).success)return failure(429,'RATE LIMITED');
  }
  try{
    if(url.pathname==='/api/session')return Response.json({ok:true,email:user.email,transport:'access-session'},{headers:{'Cache-Control':'no-store'}});
    if(url.pathname==='/api/script'){
      if(request.method!=='POST')return failure(405,'POST required');
      return await script(await readBody(request),env,transport);
    }
    if(url.pathname.startsWith('/api/')){
      const p=url.pathname;
      const read=request.method==='GET'&&(/^\/api\/(health|history|history\.csv)$/.test(p)||/^\/api\/jobs\/[A-Za-z0-9_-]+(?:\/logs)?$/.test(p));
      const write=request.method==='POST'&&(p==='/api/jobs'||p==='/api/source'||/^\/api\/jobs\/[A-Za-z0-9_-]+\/(pause|resume|cancel)$/.test(p));
      if(!read&&!write)return failure(404,'Unknown API route');
      if(!env.ANALYZER_TOKEN)throw Error('Analyzer configuration missing');
      const body=write?await readBody(request,16384):null;
      const r=await transport(fixedOrigin(env.ANALYZER_ORIGIN)+p,{method:request.method,headers:{Authorization:'Bearer '+env.ANALYZER_TOKEN,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(30000)});
      return new Response(r.body,{status:r.status,headers:{'Content-Type':r.headers.get('Content-Type')||'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    }
    if(request.method!=='GET')return failure(405,'GET required');
    return await env.ASSETS.fetch(request);
  }catch(e){return failure(e.name==='TimeoutError'?504:502,e.name==='TimeoutError'?'TIMEOUT':'Upstream unavailable or configuration invalid');}
}
export default {fetch:handle};
