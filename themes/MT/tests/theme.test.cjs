const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const esbuild=require('esbuild');
const React=require('react');
const base=path.resolve(__dirname,'..');
function load(file,modules={}) {
 const source=esbuild.buildSync({entryPoints:[path.join(base,'js',file)],bundle:true,write:false,format:'cjs',platform:'node',external:['react','react-native','@valenced/*'],jsx:'automatic'}).outputFiles[0].text;
 const module={exports:{}};
 vm.runInNewContext(source,{module,exports:module.exports,require:(id)=>id==='react'?React:id==='react/jsx-runtime'?require('react/jsx-runtime'):modules[id],console,Symbol,Set,Map,WeakSet,Promise});
 return module.exports;
}
const exists=fs.existsSync(path.join(base,'js/palette.json'));
test('primary and secondary button labels remain readable in every appearance and state',()=>{
 const palette=JSON.parse(fs.readFileSync(path.join(base,'js/palette.json')));
 function luminance(hex){
  const rgb=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
  return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
 }
 for(const [appearance,colors] of Object.entries(palette.semantic)){
  for(const control of ['PRIMARY','SECONDARY']){
   for(const state of ['DEFAULT','HOVER','ACTIVE']){
    const a=luminance(colors['CONTROL_'+control+'_BACKGROUND_'+state]);
    const b=luminance(colors['CONTROL_'+control+'_TEXT_'+state]);
    assert.ok((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)>=4.5,appearance+' '+control+' '+state);
   }
  }
 }
});
test('mobile palette exists and contains dark, darker, midnight and light',()=>{
 assert.ok(exists,'Missing mobile palette');
 const p=JSON.parse(fs.readFileSync(path.join(base,'js/palette.json')));
 for(const theme of ['dark','darker','midnight','light']) {
  assert.ok(Object.keys(p.semantic[theme]).length>=45);
  for(const c of Object.values(p.semantic[theme]))assert.match(c,/^#[a-f0-9]{6}([a-f0-9]{2})?$/i);
 }
 assert.notEqual(p.semantic.dark.TEXT_NORMAL,p.semantic.light.TEXT_NORMAL);
 assert.equal(p.semantic.dark.BACKGROUND_BASE_LOWER,'#0D152B');
});
test('selection is enabled only for this theme provider',()=>{
 const {isMidnightSelection}=load('layout.tsx');
 assert.equal(isMidnightSelection({colors:{plugin:'dariuss.midnight-theme'}}),true);
 assert.equal(isMidnightSelection({colors:{plugin:'another.theme'}}),false);
 assert.equal(isMidnightSelection({}),false);
 assert.equal(isMidnightSelection(null),false);
});
test('memo and forwardRef exports resolve without changing component identities',()=>{
 const {resolveTargets}=load('layout.tsx');
 function ChannelHeader(){};
 const memo=React.memo(ChannelHeader);
 const before=memo.type;
 const targets=resolveTargets({default:memo},new Set(['ChannelHeader']));
 assert.equal(targets.length,1);assert.equal(targets[0].type,memo);
 assert.equal(memo.type,before);
 assert.equal(resolveTargets({default:{}},new Set(['ChannelHeader'])).length,0);
 assert.equal(resolveTargets(null,new Set(['ChannelHeader'])).length,0);
});
test('decorator preserves original element, key, ref, children and press handler',()=>{
 const {decorateElement}=load('layout.tsx');
 function Original(){};function Frame(){};const ref={current:null},press=()=>{};
 const original=React.createElement(Original,{key:'original-key',ref,onPress:press},'child');
 const framed=decorateElement(original,Frame);
 assert.equal(framed.type,Frame);assert.equal(framed.key,'original-key');
 assert.equal(framed.props.original,original);
 assert.equal(framed.props.original.props.ref,ref);
 assert.equal(framed.props.original.props.onPress,press);
 assert.equal(framed.props.original.props.children,'child');
});
module.exports={load,base};

test('published ZIP and beta index agree, and include no development files',()=>{
 const {unzipSync,strFromU8}=require('fflate');
 const {createHash}=require('node:crypto');
 const archive=fs.readFileSync(path.join(base,'../../pool/dariuss.midnight-theme@1.0.2-beta.zip'));
 const files=unzipSync(archive);
 const manifest=JSON.parse(strFromU8(files['manifest.json']));
 const index=JSON.parse(fs.readFileSync(path.join(base,'../../index.json')));
 const entry=index.plugins[manifest.id];
 assert.deepEqual(entry.channels,{beta:'1.0.2-beta'});
 assert.equal(entry.versions[manifest.version].size,archive.length);
 assert.equal(entry.versions[manifest.version].sha256,createHash('sha256').update(archive).digest('hex'));
 for(const name of ['assets/wallpaper.png','assets/moon.png','assets/Figtree.ttf','assets/Figtree-Italic.ttf','assets/Figtree-OFL.txt','assets/NOTICE.txt'])assert.ok(files[name]?.length,name);
 assert.ok(Object.keys(files).every(name=>name==='manifest.json'||name==='index.js'||name.startsWith('assets/')));
 assert.equal(manifest.version,'1.0.2-beta');
 assert.equal(manifest.dependencies['valenced.api'].version,'>=1 <2');
});

test('decorators preserve missing React keys instead of creating duplicate null keys',()=>{
 const {decorateElement}=load('layout.tsx');
 function Icon(){};function Decorator(){};
 const original=React.createElement(Icon,{});
 assert.equal(original.key,null);
 assert.equal(decorateElement(original,Decorator).key,null);
});

test('elements hidden by earlier JSX hooks remain hidden',()=>{
 const {decorateElement}=load('layout.tsx');
 function Decorator(){};
 assert.equal(decorateElement(null,Decorator),null);
 assert.equal(decorateElement(undefined,Decorator),undefined);
});
