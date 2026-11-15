import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,utimes} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {once} from 'node:events';
import {GameDiagnostics,redactDiagnostic,diagnoseSources} from './launcher/diagnostics.mjs';
import {GameLauncher} from './launcher/launch.mjs';
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'joincraft-diagnostics-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(path.join(root,'logs'));await mkdir(path.join(root,'crash-reports'));const instance={id:'owned',root,managed:true,name:'测试整合包',minecraft:'1.20.1',loader:'Forge'},diagnostics=new GameDiagnostics({getInstance:id=>id==='owned'?instance:null});return {root,instance,diagnostics};}
test('known launch and connection failures produce bounded evidence and concrete suggestions',()=>{
 const messages=['UnsupportedClassVersionError','java.lang.OutOfMemoryError: Java heap space','Missing mandatory dependencies: library','DuplicateModsFoundException','MixinApplyError','ClassNotFoundException','Connection refused','ENOSPC','AccessDeniedException'];
 const result=diagnoseSources(messages.map(text=>({name:'synthetic.log',text})));assert.equal(result.length,9);for(const finding of result){assert(finding.suggestion.length>15);assert.equal(finding.source,'synthetic.log');}
 assert.deepEqual(diagnoseSources([{name:'normal',text:'Loaded world successfully'}]),[]);
});
test('reports redact credentials, token arguments, personal paths, emails, URL parameters and IPs',()=>{
 const input='--accessToken secret-token-123 --refresh_token another-secret Authorization: Bearer bearer-secret\n{"client_secret":"client-value"} X-Session: session-secret\nC:\\Users\\Alice\\game /Users/Bob/game /home/Carol/game user@example.com https://example.test/a?token=url-secret 192.168.1.2\neyJpayload.eyJbody.signature known-value';
 const safe=redactDiagnostic(input,['known-value']);for(const secret of ['secret-token-123','another-secret','bearer-secret','client-value','session-secret','Alice','Bob','Carol','user@example.com','url-secret','192.168.1.2','eyJpayload','known-value'])assert(!safe.includes(secret),secret);assert(safe.includes('[已隐藏]'));
});
test('bounded tails and recent crash reports are collected without modifying logs',async t=>{
 const f=await fixture(t),file=path.join(f.root,'logs/latest.log'),bytes='old\n'.repeat(100000)+'OutOfMemoryError: test\n';await writeFile(file,bytes);await writeFile(path.join(f.root,'crash-reports/crash-test.txt'),'DuplicateModsFoundException');const report=await f.diagnostics.read({id:'owned'});assert.equal(report.findings.length,2);assert(report.sources.every(s=>s.text.length<=128*1024));assert(report.sources.some(s=>s.truncated));assert.equal(await readFile(file,'utf8'),bytes);
});
test('whole cookie headers and IPv6 are scrubbed, not only the first cookie',()=>{
 const safe=redactDiagnostic('Cookie: session=first-secret; account=second-secret\nAuthorization: Bearer third-secret\nserver 2001:db8::abcd https://user:password@example.test/file');for(const value of ['first-secret','second-secret','third-secret','2001:db8','user:password'])assert(!safe.includes(value));
});
test('fresh startup failures do not diagnose obsolete crashes from a previous launch',async t=>{
 const f=await fixture(t);for(const file of ['logs/latest.log','crash-reports/crash-old.txt']){const p=path.join(f.root,file);await writeFile(p,'OutOfMemoryError');await utimes(p,1,1);}f.diagnostics.begin('owned');f.diagnostics.failed('owned',Error('此实例需要 Java 17'));const report=await f.diagnostics.read({id:'owned'});assert.deepEqual(report.findings.map(f=>f.id),['java-version']);assert.equal(report.sources.length,1);
});
test('external instances and linked log files/directories are not read',async t=>{
 const f=await fixture(t);await assert.rejects(f.diagnostics.read({id:'external'}),/Joincraft/);const external=path.join(f.root,'private.txt');await writeFile(external,'private must not be read');await symlink(external,path.join(f.root,'logs/latest.log'));let report=await f.diagnostics.read({id:'owned'});assert.equal(report.sources.length,0);assert.equal(report.warnings.length,1);await rm(path.join(f.root,'logs'),{recursive:true});await symlink(path.dirname(f.root),path.join(f.root,'logs'));report=await f.diagnostics.read({id:'owned'});assert.equal(report.sources.length,0);assert(report.warnings.length>0);
});
test('empty and unknown failures stay honest; output is bounded and exact tokens never leave a report',async t=>{
 const f=await fixture(t);assert.match((await f.diagnostics.read({id:'owned'})).summary,/尚无/);const record=f.diagnostics.begin('owned');record.secrets=['raw-token'];f.diagnostics.capture(record,Buffer.from('x'.repeat(200000)+'\nunknown failure raw-token\n'));f.diagnostics.failed('owned',Error('unknown error'));const report=await f.diagnostics.read({id:'owned'});assert.match(report.summary,/尚未识别/);assert(!JSON.stringify(report).includes('raw-token'));assert(record.output.length<=128*1024);
});
test('real child stdout and stderr are consumed and abnormal exit is available to diagnostics',async t=>{
 const f=await fixture(t),launcher=new GameLauncher({library:new Map([['owned',f.instance]]),account:{},cacheDir:f.root,prepare:async()=>{},memoryProvider:()=>({totalMB:4096,availableMB:2048})});
 launcher.plan=async()=>({options:{maxMemory:1024,accessToken:'secret-from-account'},argv:[process.execPath,'-e',"process.stdout.write('output secret-from-account\\n');process.stderr.write('OutOfMemoryError: synthetic\\n');setTimeout(()=>process.exit(7),20)"],nativeRoot:path.join(f.root,'natives')});
 await launcher.start({id:'owned',memoryMode:'custom',memoryMB:1024});await once(launcher.runs.get('owned').child,'close');const report=await launcher.diagnostics.read({id:'owned'});assert.equal(report.lastRun.exitCode,7);assert(report.findings.some(f=>f.id==='memory'));assert(!JSON.stringify(report).includes('secret-from-account'));assert.equal(launcher.states()[0].state,'failed');
});
