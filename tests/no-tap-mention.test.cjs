const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const React=require('react');
test('native message callback is blocked while avatar and long press stay intact; disabling restores existing rows',()=>{
 let mentions=0,avatars=0,longs=0;
 const nativeProps={onTapUsername:()=>++mentions,onTapAvatar:()=>++avatars,onLongPressUsername:()=>++longs};
 const component=React.memo(function MessagesRenderer(){return React.createElement('container',null,React.createElement('NativeChat',nativeProps));});
 const namespace={default:component};
 const cleanups=[];
 const modules={
  '@valenced/modules/finders':{getModules:(filter,callback)=>{
   if(filter==='MessagesRenderer'&&component.name==='MessagesRenderer')callback(namespace);
   if(filter==='type'&&'type' in component)callback(component);
   return()=>{};
  }},
  '@valenced/modules/finders/filters':{withName:x=>x,withProps:x=>x},
  '@valenced/patcher':{after:(owner,key,callback)=>{const old=owner[key];owner[key]=function(...args){return callback(old.apply(this,args),args)??old.apply(this,args);};return()=>{owner[key]=old;};},instead:()=>()=>{}},
  react:React,
 };
 const source=fs.readFileSync('plugins/NTM/js/index.ts','utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 const exports={};vm.runInNewContext(js,{exports,plugin:v=>v,require:name=>modules[name]});
 exports.default.start({cleanup:fn=>cleanups.push(fn),plugin:{startedLate:false}});
 const row=namespace.default.type().props.children;
 row.props.onTapUsername({userId:'123'});assert.equal(mentions,0);
 row.props.onTapAvatar();row.props.onLongPressUsername();assert.equal(avatars,1);assert.equal(longs,1);
 assert.notEqual(row.props.onTapUsername,nativeProps.onTapUsername);
 cleanups.reverse().forEach(fn=>fn());row.props.onTapUsername();assert.equal(mentions,1);
});
