const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {unzipSync,strFromU8}=require('fflate');
const root=path.resolve(__dirname,'..');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const expected=['dariuss.quick-translate','dariuss.jump-to-ping','dariuss.show-hidden-channels','dariuss.voice-messages-to-text','dariuss.midnight-theme','dariuss.advanced-message-logger','dariuss.ghost-ping-logger','dariuss.no-tap-mention'];
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
 const index=read('index.json');assert.deepEqual(Object.keys(index.plugins).sort(),[...expected,'dariuss.spotify-controls'].sort());
 for(const {dir,manifest}of sources()){
  const item=index.plugins[manifest.id];assert.deepEqual(item.channels,manifest.id==='dariuss.no-tap-mention'?{latest:manifest.version}:{beta:manifest.version});
  const entry=item.versions[manifest.version];const file=manifest.id+'@'+manifest.version+'.zip';const zip=fs.readFileSync(path.join(root,'pool',file));
  if(manifest.id==='dariuss.advanced-message-logger'){
   const url=new URL(entry.url);assert.equal(url.origin,'https://raw.githubusercontent.com');
   assert.match(url.pathname,/^\/dariussbezy\/dariussbezy-Plugins\/[0-9a-f]{40}\/pool\//);
   assert.equal(url.pathname.split('/').at(-1),file);
  }else assert.equal(entry.url,'https://raw.githubusercontent.com/dariussbezy/dariussbezy-Plugins/refs/heads/main/pool/'+file);
  assert.equal(entry.size,zip.length);assert.equal(entry.sha256,createHash('sha256').update(zip).digest('hex'));
  const files=unzipSync(zip);assert.deepEqual(JSON.parse(strFromU8(files['manifest.json'])),manifest);
  assert.ok(files[manifest.dist.script]);
  if(manifest.dist.android){const native=unzipSync(files[manifest.dist.android.path]);assert.ok(native['classes.dex']);assert.equal(Buffer.from(native['classes.dex']).subarray(0,4).toString(),'dex\n')}
  for(const dependency of Object.keys(manifest.dependencies))if(dependency.startsWith('dariuss.'))assert.ok(index.plugins[dependency],dependency);
 }
});

test('Spotify Controls uses the approved installable 1.0.0-beta artifact',()=>{
 const item=read('index.json').plugins['dariuss.spotify-controls'];assert.deepEqual(item.channels,{beta:'1.0.0-beta'});
 assert.deepEqual(Object.keys(item.versions),['1.0.0-beta']);const entry=item.versions['1.0.0-beta'];
 const zip=fs.readFileSync(path.join(root,'pool','dariuss.spotify-controls@1.0.0-beta.zip'));
 assert.equal(createHash('sha256').update(zip).digest('hex'),'b99eaf9d5d2d7c8d66383beab04e6e8f07c6434591bea45a45ce20b8b73d0cb1');assert.equal(entry.sha256,createHash('sha256').update(zip).digest('hex'));assert.equal(entry.size,zip.length);
 assert.equal(entry.url,'https://raw.githubusercontent.com/dariussbezy/dariussbezy-Plugins/refs/heads/main/pool/dariuss.spotify-controls@1.0.0-beta.zip');
 const files=unzipSync(zip),manifest=JSON.parse(strFromU8(files['manifest.json']));assert.equal(manifest.id,'dariuss.spotify-controls');assert.equal(manifest.version,'1.0.0-beta');assert.deepEqual(Object.keys(files).sort(),['index.js','manifest.json']);
 new (require('node:vm').Script)(strFromU8(files['index.js']));
 assert.deepEqual(read('repo.config.json').channels[manifest.id],{beta:manifest.version});
});
test('published JavaScript bytes match freshly compiled sources for every plugin',()=>{
 for(const {dir,manifest}of sources()){
  const files=unzipSync(fs.readFileSync(path.join(root,'pool',manifest.id+'@'+manifest.version+'.zip')));
  assert.deepEqual(Buffer.from(files[manifest.dist.script]),fs.readFileSync(path.join(root,dir,'build/js/index.js')),manifest.id);
 }
});
