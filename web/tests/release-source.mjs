import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const file=path=>readFile(root+path,'utf8');
const [html,config,main,auth,recovery,layout,adapter]=await Promise.all([
 file('dist/index.html'),file('dist/assets/config.js'),file('dist/assets/main.js'),
 file('dist/assets/auth.js'),file('dist/assets/recovery.js'),
 file('dist/assets/auth-layout.css'),file('dist/assets/recovery-api.js')
]);
assert.ok(!html.includes('preview=1'), 'Production logo must not open Preview');
assert.match(config,/__SASHA_PREVIEW_ENABLED__=false/);
assert.doesNotMatch(main,/fixtureActor|fixtureOrg|review@example\.test/);
assert.doesNotMatch(recovery,/test@example\.com|otp='123456'|value="123"|\?preview=1/);
assert.match(recovery,/stage==='email'/);
assert.match(recovery,/stage==='code'/);
assert.match(recovery,/stage==='password'/);
assert.match(recovery,/stage==='done'/);
for(const method of ['requestResetCode','verifyResetCode','completePasswordReset']){
 assert.ok(adapter.includes('api.'+method+'('), 'Recovery must use the HTTP adapter through '+method);
}
assert.match(html,/assets\/cabinet-reference\.css/);
assert.match(main,/cabinetWorkspace\(\{admin,org\}\)/);
assert.match(main,/await api\.openOrganization/);
assert.match(main,/await api\.reviewOrganization/);
assert.match(await file('dist/assets/cabinet-reference.css'),/@font-face\s*\{\s*font-family:Geist/);
assert.doesNotMatch(main,/SashaPreviewModel|preview-call|SashaRecordings/);
assert.match(auth,/company-lock-icon/);
assert.match(layout,/body\.auth-shell #content:not\(\.workspace\)/);
for (const path of ['sashatel-symbol.svg','sashatel-symbol-transparent.svg','lock.svg']){
 const svg=await file('dist/assets/'+path);
 assert.match(svg,/<svg\b/);assert.match(svg,/<\/svg>/);
}
try {await access(root+'dist/assets/preview-api.js');throw Error('Preview API leaked into production build');}
catch(error){if(error.code!=='ENOENT')throw error;}
console.log('PASS: production assets, SVG, auth layout, recovery UI and preview isolation');
