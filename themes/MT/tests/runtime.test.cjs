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

function fixture({selected=true,enabled=true,unsupported=false,bridgeError=false,early=false,icons='default',baseIcon=true,iconError=false}={}) {
 const hooks=new Map(),cleanups=[],errors=[],registered={};
 const selection=selected?{colors:{plugin:'dariuss.midnight-theme'}}:{};
 if(icons!=='default')selection.icons={plugin:icons==='moon'?'dariuss.midnight-theme':'other.icons',group:'midnight',pack:'moon'};
 let moduleSubscription,stopped=false;
 const native={};
 const bridge={callNativeMethodSync(){if(bridgeError)throw Error('Missing theme bridge');return JSON.stringify(selection)},callNativeMethod:async(name,args)=>{if(name==='valenced.themes.setColors')selection.colors=args[0]?JSON.parse(args[0]):undefined;if(name==='valenced.themes.setIcons')selection.icons=args[0]?JSON.parse(args[0]):undefined;return null}};
 for(const key of Object.keys(bridge))Object.defineProperty(native,key,{get:()=>bridge[key],enumerable:true});
 const rootTheme={RootThemeContextProvider:()=>null,DisableCustomTheme:()=>null};
 const originalCall=native.callNativeMethod;
 function ChannelHeader(props){React.useState(0);return props.hidden?null:React.createElement('NativeHeader',props)}
 function ChatInput(props){React.useState(0);return React.createElement('NativeComposer',props)}
 const memo=React.memo(ChannelHeader),identity=memo.type;
 function ChatIcon(props){return React.createElement('NativeChatIcon',props)}
 function BaseIconImage(props){if(iconError)throw Error('Native icon unavailable');return React.createElement('NativeIconImage',props)}
 const jsx=(type,props)=>{const element=React.createElement(type,props);return hooks.get(type)?.(element)||element};
 function GuildsBarMessages(props){return React.createElement('NativeHomeButton',props,jsx(ChatIcon,{color:props.color||'white',size:'md'}))}
 const nav=React.memo(GuildsBarMessages);
 const modules=unsupported?[{default:{}}]:[rootTheme,{default:memo},{default:ChatInput},{GuildsBarMessages:nav},{ChatIcon},...(baseIcon?[{BaseIconImage}]:[])];
 const mocks={
  react:React,'react/jsx-runtime':JSX,'react-native':{View:'View',ScrollView:'ScrollView'},
  '@valenced/discord/flux':{Stores:{ThemeStore:{theme:'dark',addChangeListener(){},removeChangeListener(){}}}},
  '@valenced/modules/native':native,
  '@valenced/plugins/constants':{pluginDistDirFor:id=>'/plugins/'+id},
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
  render(kind,props={}){const type=kind==='header'?memo:kind==='composer'?ChatInput:kind==='navigation'?nav:ChatIcon;const element=React.createElement(type,props);return hooks.get(type)?.(element)||element},
  loaded(namespace){if(moduleSubscription?.filter(namespace))moduleSubscription.callback(namespace)},
 };
}

test('official bundle registers local wallpaper, Figtree variants and original moon',async()=>{
 const f=fixture({enabled:false});await f.start();
 const theme=f.registered.registerTheme;
 assert.equal(theme.background.path,'assets/wallpaper.png');
 assert.equal(theme.getColors().semantic.dark.BACKGROUND_BASE_LOWER,'#0D152B');
 for(const variants of Object.values(f.registered.registerFontPack.families))for(const variant of variants){assert.ok(fs.existsSync(path.join(root,variant.path)));assert.equal(variant.axes.wght,variant.weight)}
 for(const file of Object.values(f.registered.registerIconPack.icons))assert.ok(fs.existsSync(path.join(root,file)));
 assert.equal(f.hooks.has(f.memo),false);await f.stop();
});

test('real React 19 preserves the native header parent, type and handlers',async()=>{
 const f=fixture();let tree;const onPress=()=>{};
 await act(async()=>{await f.start();tree=Renderer.create(f.render('header',{testID:'native-header',onPress}))});
 assert.deepEqual(f.errors,[],String(f.errors[0]?.stack));
 assert.equal(f.memo.type,f.identity);
 assert.equal(tree.root.findByType('NativeHeader').props.onPress,onPress);
 assert.equal(tree.root.findAllByType('View').length,0);
 const before=f.hooks.size;f.loaded({default:f.memo});assert.equal(f.hooks.size,before);
 await act(async()=>{await f.stop()});assert.equal(f.hooks.size,0);assert.equal(f.native.callNativeMethod,f.originalCall);
 assert.equal(tree.root.findAllByType('View').length,0);
 assert.equal(f.errors.length,0);await act(async()=>tree.unmount());
});

test('theme switches update rounding without reparenting native controls',async()=>{
 const f=fixture({selected:false});let tree;
 await act(async()=>{await f.start();tree=Renderer.create(f.render('header',{style:{height:56,borderRadius:0}}))});
 const native=tree.root.findByType('NativeHeader');
 assert.equal(native.props.style.borderRadius,0);
 await act(async()=>{await f.native.callNativeMethod('valenced.themes.setColors',[JSON.stringify({plugin:'dariuss.midnight-theme'})]);f.refreshTheme()});
 assert.equal(tree.root.findByType('NativeHeader'),native);
 assert.equal(Object.assign({},...native.props.style).borderRadius,16);
 assert.equal(tree.root.findAllByType('View').length,0);
 await act(async()=>{await f.native.callNativeMethod('valenced.themes.setColors',[null]);f.refreshTheme()});
 assert.equal(native.props.style.borderRadius,0);
 await act(async()=>{await f.stop();tree.unmount()});
});

test('composer keeps its own clipping, height and layout options',async()=>{
 for(const overflow of ['visible','hidden']){
  const f=fixture();let tree;
  await act(async()=>{await f.start();tree=Renderer.create(f.render('composer',{style:{overflow,height:56}}))});
  const styles=tree.root.findByType('NativeComposer').props.style;
  const flat=Object.assign({},...styles);
  assert.equal(flat.overflow,overflow);assert.equal(flat.height,56);assert.equal(flat.borderRadius,14);
  assert.equal(flat.marginHorizontal,undefined);assert.equal(flat.borderWidth,undefined);
  assert.equal(tree.root.findAllByType('View').length,0);
  await act(async()=>{await f.stop();tree.unmount()});
 }
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

test('Home icon uses the moon pack on the mobile navigation button',async()=>{
 const f=fixture({enabled:false});await f.start();
 assert.equal(f.registered.registerIconPack.icons.HomeIcon,'assets/moon.png');
 await f.stop();
});

test('wallpaper uses a light blur and native controls keep opaque base colors',async()=>{
 const f=fixture({enabled:false});await f.start();
 const theme=f.registered.registerTheme;
 assert.equal(theme.background.blur,3);
 for(const base of ['dark','darker','midnight','light'])for(const token of ['BACKGROUND_BASE_LOWER','CHAT_INPUT_BACKGROUND','CHANNELTEXTAREA_BACKGROUND','BACKGROUND_FLOATING']){
  assert.match(theme.getColors().semantic[base][token],/^#[0-9a-f]{6}$/i,base+'/'+token);
 }
 await f.stop();
});

async function nativeGeometry(json) {
 const Yoga=(await import('yoga-layout')).default;
 function flatten(style){return Array.isArray(style)?Object.assign({},...style.map(flatten)):style||{}}
 function build(element){
  const node=Yoga.Node.create(),style=flatten(element.props?.style);
  if(style.width!==undefined)node.setWidth(style.width);
  if(style.height!==undefined)node.setHeight(style.height);
  if(style.flex!==undefined)node.setFlex(style.flex);
  if(style.position==='absolute')node.setPositionType(Yoga.POSITION_TYPE_ABSOLUTE);
  for(const [name,edge]of [['top',Yoga.EDGE_TOP],['bottom',Yoga.EDGE_BOTTOM],['left',Yoga.EDGE_LEFT],['right',Yoga.EDGE_RIGHT]])if(style[name]!==undefined)node.setPosition(edge,style[name]);
  for(const [name,edge]of [['marginTop',Yoga.EDGE_TOP],['marginBottom',Yoga.EDGE_BOTTOM],['marginHorizontal',Yoga.EDGE_HORIZONTAL],['marginVertical',Yoga.EDGE_VERTICAL]])if(style[name]!==undefined)node.setMargin(edge,style[name]);
  if(style.borderWidth!==undefined)node.setBorder(Yoga.EDGE_ALL,style.borderWidth);
  const children=(element.children||[]).filter(child=>typeof child==='object').map(build);
  children.forEach((child,i)=>node.insertChild(child.node,i));
  return {node,element,children};
 }
 const tree=build(json),rects={};tree.node.calculateLayout(undefined,undefined,Yoga.DIRECTION_LTR);
 function collect(current,x=0,y=0){const r=current.node.getComputedLayout();const next={left:x+r.left,top:y+r.top,width:r.width,height:r.height};rects[current.element.type]=next;for(const child of current.children)collect(child,next.left,next.top)}
 collect(tree);tree.node.freeRecursive();return rects;
}

test('Yoga preserves native absolute header and composer placement without extra parents',async()=>{
 for(const kind of ['header','composer']){
  const f=fixture();let tree;
  const nativeStyle={position:'absolute',left:0,right:0,height:56,...(kind==='header'?{top:0}:{bottom:0})};
  await act(async()=>{await f.start();tree=Renderer.create(React.createElement('Screen',{style:{width:412,height:860}},f.render(kind,{style:nativeStyle})))});
  const geometry=await nativeGeometry(tree.toJSON());
  const actual=geometry[kind==='header'?'NativeHeader':'NativeComposer'];
  assert.deepEqual(actual,{left:0,top:kind==='header'?0:804,width:412,height:56},kind+' must retain Discord layout');
  assert.equal(tree.root.findAllByType('View').length,0,'styling must not insert native layout containers');
  await act(async()=>{await f.stop();tree.unmount()});
 }
});

test('navigation moon replaces ChatIcon only inside the Home button',async()=>{
 const f=fixture();let tree;const onPress=()=>{};
 await act(async()=>{await f.start();tree=Renderer.create(React.createElement('Screen',{},f.render('navigation',{onPress}),f.render('chat')))});
 const image=tree.root.findByType('NativeIconImage');
 assert.equal(image.props.source.uri,'file:///plugins/dariuss.midnight-theme/assets/moon.png');
 assert.equal(image.props.size,'md');
 assert.equal(tree.root.findByType('NativeHomeButton').props.onPress,onPress);
 assert.equal(tree.root.findAllByType('NativeChatIcon').length,1,'other chat icons must remain unchanged');
 assert.equal(f.registered.registerIconPack.icons.ChatIcon,undefined,'do not replace ChatIcon globally');
 await act(async()=>{await f.stop();tree.unmount()});
});

test('hidden native headers do not leave an empty border or spacer',async()=>{
 const f=fixture();let tree;
 await act(async()=>{await f.start();tree=Renderer.create(f.render('header',{hidden:true}))});
 assert.equal(tree.toJSON(),null);
 await act(async()=>{await f.stop();tree.unmount()});
});

test('custom icon packs are respected and missing icon renderers fall back safely',async()=>{
 for(const options of [{icons:'other'},{baseIcon:false},{selected:false}]){
  const f=fixture(options);let tree;
  await act(async()=>{await f.start();tree=Renderer.create(f.render('navigation'))});
  assert.equal(tree.root.findAllByType('NativeIconImage').length,0);
  assert.equal(tree.root.findAllByType('NativeChatIcon').length,1);
  assert.equal(f.errors.length,0);
  await act(async()=>{await f.stop();tree.unmount()});
 }
});

test('the selected moon pack works independently of color theme and rounding',async()=>{
 const f=fixture({selected:false,enabled:false,icons:'moon'});let tree;
 await act(async()=>{await f.start();tree=Renderer.create(f.render('navigation'))});
 assert.equal(tree.root.findAllByType('NativeIconImage').length,1);
 assert.equal(f.hooks.has(f.memo),false);
 await act(async()=>{await f.stop();tree.unmount()});
});

test('native icon rendering errors restore the original button icon',async()=>{
 const f=fixture({iconError:true});let tree;const logged=[];const originalError=console.error;console.error=(...args)=>logged.push(args);
 try{await act(async()=>{await f.start();tree=Renderer.create(f.render('navigation'))})}
 finally{console.error=originalError}
 assert.equal(tree.root.findAllByType('NativeChatIcon').length,1);
 assert.equal(tree.root.findAllByType('NativeHomeButton').length,1);
 assert.equal(f.errors.length,1);
 await act(async()=>{await f.stop();tree.unmount()});
});
