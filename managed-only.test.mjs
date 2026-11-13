import test from 'node:test';
import assert from 'node:assert/strict';
import {managedPreferences} from './launcher/managed-preferences.mjs';
import {javaSearchLocations} from './launcher/java-discovery.mjs';
test('old external library preferences are ignored without losing managed roots or launch settings',()=>{
 const input={root:'D:\\PCL\\.minecraft',selectedRoot:'D:\\PCL',javaPath:'D:\\PCL\\runtime\\bin\\java.exe',managedRoot:'D:\\Joincraft',managedRoots:['E:\\Joincraft'],managedLaunchInputs:{one:{name:'Player_1'}},updateNotifiedVersion:'0.9.25'};
 const result=managedPreferences(input,{platform:'win32'});assert.equal(result.root,undefined);assert.equal(result.selectedRoot,undefined);assert.equal(result.javaPath,null);assert.equal(result.managedRoot,input.managedRoot);assert.deepEqual(result.managedRoots,input.managedRoots);assert.deepEqual(result.managedLaunchInputs,input.managedLaunchInputs);assert.equal(input.root,'D:\\PCL\\.minecraft');
});
test('managed runtime and system Java selections remain available',()=>{
 for(const javaPath of ['C:\\Program Files\\Java\\bin\\java.exe','D:\\PCL\\Joincraft\\runtimes\\bin\\java.exe']){
  const result=managedPreferences({root:'D:\\PCL\\.minecraft',managedRoot:'D:\\PCL\\Joincraft',javaPath},{platform:'win32'});assert.equal(result.javaPath,javaPath);
 }
});
test('managed Java discovery includes its runtimes and system installations without external game directories',()=>{
 const search=javaSearchLocations({platform:'win32',externalRuntimes:false,home:'C:\\Users\\Player',root:'D:\\Joincraft',env:{JAVA_HOME:'C:\\Java\\jdk17',ProgramFiles:'C:\\Program Files',APPDATA:'C:\\Users\\Player\\AppData\\Roaming'}});
 assert(search.folders.includes('D:\\Joincraft\\runtimes'));assert(search.folders.includes('C:\\Java\\jdk17'));assert(search.folders.includes('C:\\Program Files\\Eclipse Adoptium'));
 assert(!search.folders.some(folder=>/PCL|\\\.minecraft|curseforge|\\Minecraft(?: Launcher)?\\runtime|\\\.ftba/i.test(folder)));
 assert(!search.folders.includes('D:\\runtime'));
});
