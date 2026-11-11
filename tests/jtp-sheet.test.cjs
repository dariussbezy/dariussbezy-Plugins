const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
test('ping sheet starts with three rows and expands to a scrollable full list',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../plugins/JTP/js/plugin.js'),'utf8');
 const start=source.indexOf('function PingSheet()');
 const end=source.indexOf('\n  function fallbackMenu',start);
 let expanded=false;
 const rows=Array.from({length:60},(_,i)=>({c:String(i),count:1,needs:false}));
 const h=(type,props,...children)=>({type,props:props||{},children});
 const render=vm.runInNewContext('('+source.slice(start,end)+')',{
  React:{createElement:h,useState:value=>[typeof value==='boolean'?expanded:value,()=>{expanded=true}],useEffect:()=>{}},
  RN:{View:'View',useWindowDimensions:()=>({height:800})}, BottomSheet:{BottomSheetScrollView:'Scroll'},
  Design:{Stack:'Stack',BottomSheetTitleHeader:'Header',TableRowGroup:'Group',TableRow:'Row'},
  getRows:()=>rows,totalOf:()=>60,sheetParts:()=>({ActionSheet:'Sheet'}),resolveRows:()=>{},
  useSheetBottomPadding:()=>24,channelLabel:id=>id,rowIcon:()=>null,rowSubtitle:()=>'',jumpToPing:()=>{},listeners:new Set(),
 });
 function nodes(tree,type){return [tree,...tree.children.flat(Infinity).filter(x=>x&&typeof x==='object').flatMap(x=>nodes(x,type))].filter(x=>x.type===type);}
 const initial=render();
 assert.equal(initial.props.startHeight,388);
 assert.equal(nodes(initial,'Row').length,60);
 assert.deepEqual(nodes(initial,'Row').map(row=>row.props.key),rows.map(row=>row.c));
 const firstHeight=nodes(initial,'Scroll')[0].props.style.height;
 initial.props.onExpand();
 const full=render();
 assert.ok(nodes(full,'Scroll')[0].props.style.height>firstHeight);
 assert.equal(full.props.maxHeight,680);
});
