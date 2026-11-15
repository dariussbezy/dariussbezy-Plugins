const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {unzipSync,strFromU8}=require('fflate');
const root=path.resolve(__dirname,'..');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const repository=read('index.json').name.endsWith('(Test)')?'dariussbezy/dariussbezy-plugins-test':'dariussbezy/dariussbezy-Plugins';
const expected=['dariuss.quick-translate','dariuss.jump-to-ping','dariuss.voice-messages-to-text','dariuss.midnight-theme','dariuss.advanced-message-logger','dariuss.ghost-ping-logger','dariuss.no-tap-mention','dariuss.no-delete-confirmation','dariuss.message-actions','dariuss.custom-quick-reactions','dariuss.music-controls','dariuss.performance-monitor'];
function sources(){return ['plugins','themes'].flatMap(dir=>fs.readdirSync(path.join(root,dir)).map(name=>({dir:dir+'/'+name,manifest:read(dir+'/'+name+'/manifest.json')})))}
test('one template repository contains every plugin and theme without examples',()=>{
 for(const file of ['build.gradle.kts','settings.gradle.kts','gradlew','gradle/wrapper/gradle-wrapper.jar','tsconfig.base.json','repo.config.json','package.json'])assert.ok(fs.existsSync(path.join(root,file)),file);
 assert.deepEqual(sources().map(s=>s.manifest.id).sort(),[...expected].sort());
 for(const source of sources()){
  assert.equal(read(source.dir+'/tsconfig.json').extends,'../../tsconfig.base.json');
  assert.ok(!source.dir.includes('example'));
  assert.ok(['index.ts','index.tsx'].some(file=>fs.existsSync(path.join(root,source.dir,'js',file))));
 }
});
test('single index serves all nine add-ons with valid artifact digests',()=>{
 const index=read('index.json');assert.deepEqual(Object.keys(index.plugins).sort(),[...expected].sort());
 for(const {dir,manifest}of sources()){
  const item=index.plugins[manifest.id];assert.deepEqual(item.channels,{latest:manifest.version});
  const entry=item.versions[manifest.version];const file=manifest.id+'@'+manifest.version+'.zip';const zip=fs.readFileSync(path.join(root,'pool',file));
  const url=new URL(entry.url);assert.equal(url.origin,'https://raw.githubusercontent.com');
  const prefix='/'+repository+'/';assert.ok(url.pathname.startsWith(prefix));
  assert.match(url.pathname.slice(prefix.length),/^[0-9a-f]{40}\/pool\//);
  assert.equal(url.pathname.split('/').at(-1),file);
  assert.equal(entry.size,zip.length);assert.equal(entry.sha256,createHash('sha256').update(zip).digest('hex'));
  const files=unzipSync(zip);assert.deepEqual(JSON.parse(strFromU8(files['manifest.json'])),manifest);
  assert.ok(files[manifest.dist.script]);
  if(manifest.dist.android){const native=unzipSync(files[manifest.dist.android.path]);assert.ok(native['classes.dex']);assert.equal(Buffer.from(native['classes.dex']).subarray(0,4).toString(),'dex\n')}
  for(const dependency of Object.keys(manifest.dependencies))if(dependency.startsWith('dariuss.'))assert.ok(index.plugins[dependency],dependency);
 }
});

test('published JavaScript bytes match freshly compiled sources for every plugin',()=>{
 for(const {dir,manifest}of sources()){
  const files=unzipSync(fs.readFileSync(path.join(root,'pool',manifest.id+'@'+manifest.version+'.zip')));
  assert.deepEqual(Buffer.from(files[manifest.dist.script]),fs.readFileSync(path.join(root,dir,'build/js/index.js')),manifest.id);
 }
});
