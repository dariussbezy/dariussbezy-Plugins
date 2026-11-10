const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const React=require('react');
const JSX=require('react/jsx-runtime');
const Renderer=require('react-test-renderer');
const {act}=React;
global.IS_REACT_ACT_ENVIRONMENT=true;
const root=path.resolve(__dirname,'..');

function fixture({selected=true,enabled=true,unsupported=false,bridgeError=false,early=false}={}) {
 const hooks=new Map(),cleanups=[],errors=[],registered={};
 const selection=selected?{colors:{plugin:'dariuss.midnight-theme'}}:{};
 let moduleSubscription,stopped=false;
 const native={};
 const bridge={callNativeMethodSync(){if(bridgeError)throw Error('Missing theme bridge');return JSON.stringify(selection)},callNativeMethod:async(name,args)=>{if(name==='valenced.themes.setColors')selection.colors=args[0]?JSON.parse(args[0]):undefined;return null}};
 for(const key of Object.keys(bridge))Object.defineProperty(native,key,{get:()=>bridge[key],enumerable:true});
 const rootTheme={RootThemeContextProvider:()=>null,DisableCustomTheme:()=>null};
 const originalCall=native.callNativeMethod;
 function ChannelHeader(props){React.useState(0);return React.createElement('NativeHeader',props)}
 function ChatInput(props){React.useState(0);return React.createElement('NativeComposer',props)}
 const memo=React.memo(ChannelHeader),identity=memo.type;
 const modules=unsupported?[{default:{}}]:[rootTheme,{default:memo},{default:ChatInput}];
 const mocks={
  react:React,'react/jsx-runtime':JSX,'react-native':{View:'View',ScrollView:'ScrollView'},
  '@valenced/discord/flux':{Stores:{ThemeStore:{theme:'dark',addChangeListener(){},removeChangeListener(){}}}},
  '@valenced/modules/native':native,
  '@valenced/modules/finders/filters':{FilterScopes:{Initialized:4},createFilterGenerator:fn=>(...args)=>(value)=>fn(args,0,value,true)},
  '@valenced/modules/finders':{getModules(filter,callback){moduleSubscription={filter,callback};queueMicrotask(()=>{if(!stopped)modules.filter(filter).forEach(callback)});return()=>{stopped=true}}},
  '@valenced/react/jsx-runtime':{afterJSX(type,callback){hooks.set(type,callback);return()=>hooks.delete(type)}},
  '@valenced/patcher':{after(object,key,hook){const original=object[key];object[key]=function(...args){return hook.call(this,Reflect.apply(original,this,args))};return()=>{object[key]=original}},instead(object,key,hook){const original=object[key];object[key]=function(...args){return hook.call(this,args,original)};return()=>{object[key]=original}}},
  '@valenced/components/Page':{default:({children})=>React.createElement('Page',{},children)},
  '@valenced/discord/design':{Design:{Stack:'Stack',TableRow:'TableRow',TableRowGroup:'TableRowGroup',TableSwitchRow:'TableSwitchRow'}},
 };
 const map=JSON.parse(fs.readFileSync(path.join(root,'../../node_modules/@valenced/types/modules.importmap.json')));
 const aliases={react:'valenced.react.React','react-native':'valenced.react.ReactNative','react/jsx-runtime':'valenced.react.ReactJSXRuntime'};
 const runtime={};
 for(const [name,value]of Object.entries(mocks)) {
  const entry=aliases[name]||map[name],location=typeof entry==='string'?entry:entry?.global;
  assert.ok(location,'Missing official import mapping: '+name);
  const parts=location.split('.').slice(1);let object=runtime;
  for(const key of parts.slice(0,-1))object=object[key]??={};
  object[parts.at(-1)]=Object.assign(value,object[parts.at(-1)]||{});
 }
 const reactBindings={...runtime.react};
 if(early){runtime.react.React=undefined;runtime.react.ReactNative=undefined;runtime.react.ReactJSXRuntime=undefined}
 const shipped=vm.runInNewContext(fs.readFileSync(path.join(root,'build/js/index.js'),'utf8'),{valenced:runtime,plugin:options=>options,console}).default;
 const themes={};for(const name of ['registerGroup','registerTheme','registerFontPack','registerIconPack'])themes[name]=(...args)=>{registered[name]=args.at(-1)};
 const storage={get:async()=>({enhancedLayout:enabled})};
 return {hooks,native,originalCall,errors,registered,memo,identity,
  async start(){shipped.preInit({themes});Object.assign(runtime.react,reactBindings);await shipped.init();await shipped.start({themes,jsonStorage:storage,cleanup:fn=>cleanups.push(fn),plugin:{startedLate:false,reportError:e=>errors.push(e),requireReload(){}}});await Promise.resolve()},
  async stop(){for(const fn of cleanups.splice(0))await fn()},
  refreshTheme(){rootTheme.RootThemeContextProvider()},
  render(kind,props={}){const type=kind==='header'?memo:ChatInput;const element=React.createElement(type,props);return hooks.get(type)?.(element)||element},
  loaded(namespace){if(moduleSubscription?.filter(namespace))moduleSubscription.callback(namespace)},
 };
}

test('official bundle registers local wallpaper, Figtree variants and original moon',async()=>{
 const f=fixture({enabled:false});await f.start();
 const theme=f.registered.registerTheme;
 assert.equal(theme.background.path,'assets/wallpaper.png');
 assert.equal(theme.getColors().semantic.dark.BACKGROUND_BASE_LOWER,'#0D152B99');
 for(const variants of Object.values(f.registered.registerFontPack.families))for(const variant of variants){assert.ok(fs.existsSync(path.join(root,variant.path)));assert.equal(variant.axes.wght,variant.weight)}
 for(const file of Object.values(f.registered.registerIconPack.icons))assert.ok(fs.existsSync(path.join(root,file)));
 assert.equal(f.hooks.size,0);await f.stop();
});

test('real React 19 renders memo header without changing native type or handlers',async()=>{
 const f=fixture();let tree;const onPress=()=>{};
 await act(async()=>{await f.start();tree=Renderer.create(f.render('header',{testID:'native-header',onPress}))});
 assert.deepEqual(f.errors,[],String(f.errors[0]?.stack));
 assert.equal(f.memo.type,f.identity);
 assert.equal(tree.root.findByType('NativeHeader').props.onPress,onPress);
 assert.equal(tree.root.findAllByType('View').length,1);
 const before=f.hooks.size;f.loaded({default:f.memo});assert.equal(f.hooks.size,before);
 await act(async()=>{await f.stop()});assert.equal(f.hooks.size,0);assert.equal(f.native.callNativeMethod,f.originalCall);
 assert.equal(tree.root.findAllByType('View').length,0);
 assert.equal(f.errors.length,0);await act(async()=>tree.unmount());
});

test('another theme has no layout frame; changing selection updates mounted frames',async()=>{
 const f=fixture({selected:false});let tree;
 await act(async()=>{await f.start();tree=Renderer.create(f.render('header'))});
 assert.equal(tree.root.findAllByType('View').length,0);
 await act(async()=>{await f.native.callNativeMethod('valenced.themes.setColors',[JSON.stringify({plugin:'dariuss.midnight-theme'})]);f.refreshTheme()});
 assert.equal(tree.root.findAllByType('View').length,1);
 await act(async()=>{await f.native.callNativeMethod('valenced.themes.setColors',[null]);f.refreshTheme()});
 assert.equal(tree.root.findAllByType('View').length,0);
 await act(async()=>{await f.stop();tree.unmount()});
});

test('composer does not clip attachments or autocomplete above the input',async()=>{
 const f=fixture();let tree;
 await act(async()=>{await f.start();tree=Renderer.create(f.render('composer'))});
 const styles=tree.root.findByType('View').props.style;
 assert.equal(Object.assign({},...styles).overflow,'visible');
 await act(async()=>{await f.stop();tree.unmount()});
});

test('unsupported exports and unavailable native bridge leave Discord untouched',async()=>{
 for(const options of [{unsupported:true},{bridgeError:true}]) {
  const f=fixture(options);await f.start();assert.equal(f.hooks.size,0);
  assert.equal(f.errors.length,options.bridgeError?1:0);
  assert.equal(await f.native.callNativeMethod('unrelated.method',[]),null);
  await f.stop();assert.equal(f.native.callNativeMethod,f.originalCall);
 }
});

test('theme registers before React loads and defers UI until init',async()=>{
 const f=fixture({early:true,enabled:false});await f.start();
 assert.equal(f.registered.registerTheme.name,'Midnight (Auto)');
 assert.equal(f.errors.length,0);await f.stop();
});
