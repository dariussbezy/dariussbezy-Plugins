const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {unzipSync,strFromU8}=require('fflate');
const root=path.resolve(__dirname,'..');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const expected=['dariuss.quick-translate','dariuss.jump-to-ping','dariuss.performance-monitor','dariuss.show-hidden-channels','dariuss.voice-messages-to-text','dariuss.liquid-glass-youbar','dariuss.midnight-theme'];
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
test('single index serves all seven beta plugins with valid artifact digests',()=>{
 const index=read('index.json');assert.deepEqual(Object.keys(index.plugins).sort(),[...expected].sort());
 for(const {dir,manifest}of sources()){
  const item=index.plugins[manifest.id];assert.deepEqual(item.channels,{beta:'1.0.0-beta'});
  const entry=item.versions[manifest.version];const file=manifest.id+'@'+manifest.version+'.zip';const zip=fs.readFileSync(path.join(root,'pool',file));
  assert.equal(entry.url,'https://raw.githubusercontent.com/dariussbezy/dariussbezy-Plugins/refs/heads/main/pool/'+file);
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
