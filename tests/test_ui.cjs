const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
(async()=>{
 const browser=await chromium.launch({headless:true});
 fs.mkdirSync('ui-checks',{recursive:true});
 try{
  for(const [name,width,height] of [['phone',390,844],['desktop',1440,1000]]){
   const page=await browser.newPage({viewport:{width,height}}),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   // Test fixtures only. Never contact provider portals from CI.
   await page.route('**/*',route=>route.request().url().startsWith('file:')?route.continue():route.abort());
   await page.goto(pathToFileURL(path.resolve('index.html')).href);
   await page.locator('[data-page=m3u]').click();
   await page.locator('#m3uText').fill('#EXTM3U\n#EXTINF:-1 tvg-id="fixture" tvg-country="AL" group-title="News",Authorized fixture\nhttps://media.example/fixture.ts');
   await page.locator('#m3uParse').click();
   assert.equal(await page.locator('#m3uList .item').count(),1);
   assert.match(await page.locator('#m3uList').innerText(),/Authorized fixture/);
   assert.match(await page.locator('#m3uList').innerText(),/NOT TESTED/);
   await page.screenshot({path:`ui-checks/${name}-m3u.png`,fullPage:true});
   await page.locator('[data-page=settings]').click();
   assert.equal(await page.locator('#backendToken').getAttribute('type'),'password');
   assert.ok(await page.locator('#connectBackend').isVisible());
   assert.equal(await page.locator('#importApiKey').getAttribute('type'),'password');
   await page.locator('#backendToken').fill('backend-test-token');
   await page.locator('#importApiKey').fill('import-test-key');
   assert.equal(await page.evaluate(()=>lmImportKey(null)), 'import-test-key');
   await page.locator('#disconnectBackend').click();
   assert.equal(await page.locator('#importApiKey').inputValue(),'');
   assert.equal(await page.locator('#backendToken').inputValue(),'');
   await page.locator('#nativeJobsRefresh').click();
   assert.match(await page.locator('#nativeJobsStatus').innerText(),/Web:/);
   await page.locator('[data-page=diagnostics]').click();
   assert.ok(await page.locator('#historyRefresh').isVisible());
   assert.deepEqual(errors,[]);
   await page.close();
  }
  const nativePage=await browser.newPage();
  await nativePage.addInitScript(()=>{window.portalCalls=[];window.LazyMapperNative={inspectPortal:(text,id)=>{const p=JSON.parse(text);window.portalCalls.push(p);const data=p.action==='genres'?{ok:true,genres:[{id:'fixture',title:'Fixture'}]}:{ok:true,channels:[]};setTimeout(()=>window.LazyMapperNativeReply(id,{ok:true,text:JSON.stringify(data)}),0);}};});
  await nativePage.route('**/*',route=>route.request().url().startsWith('file:')?route.continue():route.abort());
  await nativePage.goto(pathToFileURL(path.resolve('index.html')).href);
  await nativePage.locator('[data-page=stalker]').click();
  await nativePage.locator('#sPortal').fill('https://fixture.example/c/');
  await nativePage.locator('#sMac').fill('00:11:22:33:44:55');
  await nativePage.locator('#sConnect').click();
  await nativePage.waitForFunction(()=>document.getElementById('sStatus').textContent.includes('u lexua:'));
  assert.equal(await nativePage.locator('#importApiKey').inputValue(),'');
  assert.deepEqual(await nativePage.evaluate(()=>window.portalCalls.map(x=>x.action)),['genres','channels']);
  assert.equal(await nativePage.evaluate(()=>window.portalCalls.some(x=>'apiKey' in x)),false);
  await nativePage.close();
  console.log('Android CONNECT uses the supplied portal session without an administrative key: PASS');
  console.log('Phone/desktop navigation, M3U import and settings: PASS');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
