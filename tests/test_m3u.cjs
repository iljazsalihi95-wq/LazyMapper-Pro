const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
const script=html.match(/<script>([\s\S]*)<\/script>/)[1];
new vm.Script(script); // Syntax-check the entire shipped UI.
const core=script.slice(script.indexOf('function parseM3U('),script.indexOf('\nlet mTesting'));
const context=vm.createContext({});vm.runInContext(core,context);
const text='\uFEFF#EXTM3U\r\n#EXTINF:-1 tvg-id="id-1" tvg-name="Name" tvg-logo="https://media.example/logo.png" tvg-country="AL" group-title="News, World",Channel, HD\r\n#EXTVLCOPT:http-referrer=https://media.example/\r\nhttps://media.example/live.ts?token=authorized\r\n';
const rows=context.parseM3U(text);
assert.equal(rows.length,1);assert.equal(rows[0].name,'Channel, HD');assert.equal(rows[0].group,'News, World');
assert.equal(rows[0].tvgId,'id-1');assert.equal(rows[0].tvgName,'Name');assert.equal(rows[0].country,'AL');
assert.equal(rows[0].url,rows[0].originalUrl);assert.equal(rows[0].directives.length,1);
const roundtrip=context.parseM3U(context.exportM3U(rows));
assert.equal(roundtrip[0].url,rows[0].url);assert.equal(roundtrip[0].logo,rows[0].logo);
assert.equal(roundtrip[0].name,rows[0].name);assert.equal(roundtrip[0].group,rows[0].group);
assert.equal(context.parseM3U('#EXTM3U\n#EXTINF:-1,missing').length,0);
assert.equal(context.exportM3U([{name:'bad',url:'javascript:alert(1)'}]),'#EXTM3U\n');
console.log('M3U import/metadata/export roundtrip, malformed entries and UI syntax: PASS');

const hls='#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts';
assert.throws(()=>context.parseM3U(hls));
assert.equal(context.parseM3U(hls,'https://media.example/live.m3u8')[0].url,'https://media.example/live.m3u8');
console.log('HLS manifests remain streams, not channel lists: PASS');
