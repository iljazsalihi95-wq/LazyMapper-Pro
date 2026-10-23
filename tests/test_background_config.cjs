const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
const fields={importApiKey:{value:'import-fixture'},backendToken:{value:'different-worker-token'}};
const c=vm.createContext({document:{getElementById:id=>fields[id]}});
vm.runInContext(script.match(/function lmImportKey\(field\)\{[^\n]+/)[0],c);
assert.equal(c.lmImportKey(null),'import-fixture');
assert.equal(c.lmImportKey({value:' per-import '}),'per-import');
fields.importApiKey.value='';
assert.equal(c.lmImportKey(null),''); // Never forward the worker token to the import provider.
assert.match(html,/id="importApiKey" type="password"/);
console.log('PASS: separate import and worker credentials; worker token never used as import fallback');
