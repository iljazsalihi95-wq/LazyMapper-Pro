const {chromium}=require('playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mapper-media-'));
 execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc=size=320x180:rate=15','-t','3','-an','-c:v','libvpx','-pix_fmt','yuv420p',path.join(temp,'sample.webm')]);
 execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc=size=320x180:rate=15','-t','3','-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',path.join(temp,'sample.mp4')]);
 let base,imports=[],stored=new Map(),actions=[],failNext=0,authFail=false;
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,base);
  const json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  if(url.pathname==='/api/session')return json({ok:true,email:'fixture@example.test',transport:'access-session'});
  if(url.pathname==='/sample.webm'){res.setHeader('Content-Type','video/webm');return res.end(fs.readFileSync(path.join(temp,'sample.webm')));}
  if(url.pathname==='/sample.mp4'){res.setHeader('Content-Type','video/mp4');return res.end(fs.readFileSync(path.join(temp,'sample.mp4')));}
  if(url.pathname==='/api/script'||url.pathname==='/api/source'){
   let raw='';for await(const data of req)raw+=data;const body=JSON.parse(raw);
   assert(!('apiKey' in body),'Browser must not send a private key through the session gateway');
   if(url.pathname==='/api/source'){
    const source=new URL(body.url),action=source.searchParams.get('action');
    if(!action)return json({user_info:{auth:1,status:'Active'}});
    if(action==='get_series_categories')return json([{category_id:'cat',category_name:'AL Drama'}]);
    if(action==='get_series')return json([{series_id:77,name:'Fixture series',category_id:'cat'}]);
    if(action==='get_series_info')return json({episodes:{1:[{id:88,title:'Episode one',container_extension:'mp4',episode_num:1}]}});
    return json([]);
   }
   actions.push(body.action);
   if(body.action==='list'){
    const items=body.serverId==='SERVER_20'?[{NAME:'Authorized MP4 fixture',STREAM_URL_CMD:base+'/sample.mp4',SERVER_ID:'SERVER_20'}]:[];
    return json({ok:true,total:items.length,items});
   }
   if(body.action==='importBatch'){
    imports.push(body);
    if(authFail){res.statusCode=401;return json({ok:false,error:'AUTH REQUIRED'});}
    if(failNext>0){failNext--;res.statusCode=503;return json({ok:false,error:'Transient fixture failure'});}
    for(const item of body.items)stored.set(body.serverId+'|'+body.source+'|'+item.id,item);
    await new Promise(r=>setTimeout(r,250));return json({ok:true,added:body.items.length,updated:0});
   }
   if(body.action==='genres')return json({ok:true,genres:[{id:1,title:'Albania'}]});
   if(body.action==='channels')return json({ok:true,max_page:1,channels:[{id:1,name:'Authorized local fixture',cmd:'provider-command'}]});
   if(body.action==='create_link')return json({ok:true,stream:base+'/sample.webm'});
   return json({ok:false,error:'Unexpected fixture action'});
  }
  const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
  if(!['index.html','server.html','diagnostika.html','ballina.html'].includes(name)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type','text/html');res.end(fs.readFileSync(name));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  // The fixture uses HTTP loopback. Enable only the fixture's session discovery;
  // production discovery deliberately requires HTTPS. All real provider calls blocked.
  await page.route('**/*',route=>{
   if(route.request().url()===base+'/index.html')return route.fulfill({contentType:'text/html',body:fs.readFileSync('index.html','utf8').replace('location.protocol!=="https:"','false')});
   if(route.request().url().startsWith(base+'/server.html?'))return route.fulfill({contentType:'text/html',body:fs.readFileSync('server.html','utf8').replace("location.protocol!=='https:'",'false')});
   return route.request().url().startsWith(base)?route.continue():route.abort();
  });
  await page.goto(base+'/index.html');
  await page.waitForFunction(()=>lmGateway===true);
  await page.locator('[data-page=m3u]').click();
  const playlist='#EXTM3U\n'+Array.from({length:45},(_,i)=>'#EXTINF:-1 tvg-id="'+i+'" tvg-country="AL" group-title="News",Fixture '+i+'\n'+base+'/sample.webm?channel='+i).join('\n');
  await page.locator('#m3uText').fill(playlist);await page.locator('#m3uParse').click();
  await page.locator('#mSelectAll').click();await page.locator('#mDest').selectOption('SERVER_20');
  assert.equal(await page.locator('#mKey').isVisible(),false);
  await page.locator('#mSend').click();
  while(imports.length===0)await new Promise(r=>setTimeout(r,20));
  await page.locator('#mStopUpload').click();
  await page.waitForFunction(()=>!mUploadBusy);
  assert.equal(imports.length,1);assert.equal(imports[0].items.length,40);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('LM_TRANSFER_PROGRESS')).next),40);
  assert.equal(imports[0].serverId,'SERVER_20');assert.equal(imports[0].items[0].status,'NOT TESTED');
  await page.locator('#mSend').click();await page.waitForFunction(()=>!mUploadBusy);
  assert.equal(imports.length,2);assert.equal(imports[1].items.length,5);assert.equal(stored.size,45);
  assert.equal(await page.evaluate(()=>localStorage.getItem('LM_TRANSFER_PROGRESS')),null);
  // A transient batch failure retries the identical destination and payload.
  failNext=1;const beforeRetry=imports.length;
  await page.locator('#m3uText').fill('#EXTM3U\n#EXTINF:-1 group-title="News",Retry fixture\n'+base+'/sample.webm?retry');
  await page.locator('#m3uParse').click();await page.locator('#mSelectAll').click();await page.locator('#mSend').click();await page.waitForFunction(()=>!mUploadBusy);
  assert.equal(imports.length,beforeRetry+2);assert.deepEqual(imports.at(-1),imports.at(-2));assert.equal(stored.size,46);
  // Authentication failures stop immediately and are never retried.
  authFail=true;const beforeAuth=imports.length;
  await page.locator('#mSend').click();await page.waitForFunction(()=>!mUploadBusy);
  assert.equal(imports.length,beforeAuth+1);assert.match(await page.locator('#mUploadStatus').innerText(),/401/);authFail=false;

  await page.locator('#m3uList .item button').first().click();
  await page.waitForFunction(()=>document.getElementById('previewStatus').textContent.includes('PLAYING'),{timeout:15000});
  assert.ok(await page.locator('#previewVideo').evaluate(v=>v.currentTime>0&&v.videoWidth===320));
  await page.screenshot({path:'ui-checks/integration-real-playback-phone.png',fullPage:true});
  await page.locator('#previewClose').click();
  assert.equal(await page.locator('#previewVideo').getAttribute('src'),null);
  await page.locator('[data-page=xtream]').click();
  await page.locator('#xHost').fill('https://provider.example.test');await page.locator('#xUser').fill('authorized-user');await page.locator('#xPass').fill('private-fixture');
  await page.locator('#xConnect').click();await page.waitForFunction(()=>document.getElementById('xStatus').textContent.includes('u krye'));
  await page.locator('[data-x-type=SERIES]').click();await page.locator('#xList .item button').first().click();
  await page.waitForFunction(()=>xRows[0]?._episodeUrl);
  assert.equal(await page.evaluate(()=>xStreamUrl(xRows[0])),'https://provider.example.test/series/authorized-user/private-fixture/88.mp4');
  await page.locator('[data-page=stalker]').click();await page.locator('#sPortal').fill('https://provider.example.test');await page.locator('#sMac').fill('00:11:22:33:44:55');
  await page.locator('#sConnect').click();await page.waitForFunction(()=>!sBusy&&sRows.length===1);
  await page.locator('[data-stalker-preview]').click();
  await page.waitForFunction(()=>document.getElementById('previewStatus').textContent.includes('PLAYING'));
  assert(actions.includes('create_link'));
  await page.locator('#previewClose').click();
  await page.goto(base+'/server.html?server=SERVER_20');
  await page.getByRole('button',{name:'PREVIEW',exact:false}).filter({hasText:'▶ PREVIEW'}).click();
  await page.waitForFunction(()=>document.getElementById('previewStatus').textContent.includes('PLAYING'));
  assert.ok(await page.locator('#previewVideo').evaluate(v=>v.currentTime>0&&v.videoWidth===320));
  await page.locator('#stopPreview').click();
  assert.equal(await page.locator('#previewVideo').getAttribute('src'),null);
  await page.evaluate(()=>{window.LazyMapperNative={preview:(...args)=>{window.fixtureNativePreview=args;}};});
  await page.getByRole('button',{name:'▶ PREVIEW',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.fixtureNativePreview),[base+'/sample.mp4','Authorized MP4 fixture','AUTO']);
  assert.deepEqual(errors,[]);
  console.log('Session UI, 40+5 import with STOP/Resume into SERVER_20, identical-payload transient Retry, no auth retry, no fake WORKING, Xtream episodes and Stalker CREATE_LINK: PASS (fixture APIs)');
  console.log('Actual VP8 and H.264 MP4 decoded/played in Chromium, stopped on close, Android bridge arguments verified: PASS');
 }finally{await browser.close();await new Promise(r=>server.close(r));fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
