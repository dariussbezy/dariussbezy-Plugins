const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
test('ping sheet has one continuous group and lets native scrolling follow the sheet height',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../plugins/JTP/js/plugin.js'),'utf8');
 const start=source.indexOf('function PingSheet()');
 const end=source.indexOf('\n  function fallbackMenu',start);
 const rows=Array.from({length:60},(_,i)=>({c:String(i),count:1,needs:false}));
 const h=(type,props,...children)=>({type,props:props||{},children});
 const render=vm.runInNewContext('('+source.slice(start,end)+')',{
  React:{createElement:h,useState:value=>[value,()=>{}],useEffect:()=>{}},
  RN:{View:'View',useWindowDimensions:()=>({height:800})}, BottomSheet:{BottomSheetScrollView:'Scroll'},
  Design:{Stack:'Stack',BottomSheetTitleHeader:'Header',TableRowGroup:'Group',TableRow:'Row'},
  getRows:()=>rows,totalOf:()=>60,sheetParts:()=>({ActionSheet:'Sheet'}),resolveRows:()=>{},
  useSheetBottomPadding:()=>24,channelLabel:id=>id,rowIcon:()=>null,rowSubtitle:()=>'',jumpToPing:()=>{},listeners:new Set(),
 });
 function nodes(tree,type){return [tree,...tree.children.flat(Infinity).filter(x=>x&&typeof x==='object').flatMap(x=>nodes(x,type))].filter(x=>x.type===type);}
 const initial=render();
 assert.equal(initial.props.startHeight,444);
 assert.equal(nodes(initial,'Group').length,1);
 assert.equal(nodes(initial,'Row').length,60);
 assert.deepEqual(nodes(initial,'Row').map(row=>row.props.key),rows.map(row=>row.c));
 assert.equal(nodes(initial,'Scroll')[0].props.style.flex,1);
 assert.equal(nodes(initial,'Scroll')[0].props.style.height,undefined);
 assert.equal(nodes(initial,'Scroll')[0].props.contentContainerStyle.paddingBottom,48);
 assert.equal(initial.props.maxHeight,680);
});
test('visiting one message retains the next message after Discord acknowledges the chat',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../plugins/JTP/js/plugin.js'),'utf8');
 const start=source.indexOf('function messagesFor(');
 const end=source.indexOf('\n  function rowSubtitle',start);
 const remainingPings=new Map(),visitedPings=new Map(),captured=new Map(),fetchedMessages=new Map();
 captured.set('c',[{id:'100',t:'first'},{id:'200',t:'second'}]);
 const jumps=[];
 const api=vm.runInNewContext('(function(){'+source.slice(start,end)+';return {messagesFor,visitPing};})()',{
  remainingPings,visitedPings,captured,fetchedMessages,resolved:new Map(),MAX_CHANNELS:300,cfg:()=>({keepUnvisitedPings:true}),
  gte:(a,b)=>BigInt(a)>=BigInt(b),schedule:()=>{},jumpTo:(...args)=>jumps.push(args),
 });
 const row={c:'c',oldest:'100',id:'100',count:2};
 api.visitPing(row,api.messagesFor(row)[0]);
 captured.clear();
 assert.equal(api.messagesFor(row).length,1);
 assert.equal(api.messagesFor(row)[0].id,'200');
 api.visitPing(row,api.messagesFor(row)[0]);
 assert.equal(api.messagesFor(row).length,0);
 assert.deepEqual(jumps,[['c','100'],['c','200']]);
});
test('default mode limits historical DM matches to Discord unread count and Read does not navigate',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../plugins/JTP/js/plugin.js'),'utf8');
 const start=source.indexOf('function messagesFor('),end=source.indexOf('\n  function rowSubtitle',start);
 const remainingPings=new Map([['dm',[{id:'999'}]]]),visitedPings=new Map();
 const fetchedMessages=new Map([['dm',Array.from({length:45},(_,i)=>({id:String(100+i)}))]]);
 const captured=new Map(),resolved=new Map(),jumps=[],reads=[];
 const api=vm.runInNewContext('(function(){'+source.slice(start,end)+';return {messagesFor,visitPing,readChat};})()',{
  remainingPings,visitedPings,captured,fetchedMessages,resolved,MAX_CHANNELS:300,
  cfg:()=>({keepUnvisitedPings:false}),gte:(a,b)=>BigInt(a)>=BigInt(b),schedule:()=>{},toast:()=>{},
  markChannelRead:async id=>reads.push(id),jumpTo:(...args)=>jumps.push(args),
 });
 const row={c:'dm',count:2,oldest:null};
 assert.deepEqual(Array.from(api.messagesFor(row),m=>m.id),['143','144']);
 api.visitPing(row,api.messagesFor(row)[0]);
 assert.equal(remainingPings.has('dm'),false);
 assert.equal(visitedPings.size,0);
 await api.readChat(row);
 assert.deepEqual(reads,['dm']);assert.equal(jumps.length,1);
 assert.equal(fetchedMessages.has('dm'),false);
});
test('message lookup fetches recent DM messages when no oldest unread ID exists',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../plugins/JTP/js/plugin.js'),'utf8');
 const start=source.indexOf('async function fetchPingPage(');
 const end=source.indexOf('\n  function remember(',start);
 const fetchedMessages=new Map(),queries=[];
 const fetchPage=vm.runInNewContext('('+source.slice(start,end)+')',{
  restApi:()=>({get:async request=>{
   queries.push(request.query);
   return {body:[{id:'200',author:{id:'other'}},{id:'100',author:{id:'other'}}]};
  }}),
  generation:1,loadRequested:true,getChannel:()=>({type:1}),myId:()=> 'me',
  pingKind:()=> 'dm',entryFrom:m=>({id:m.id,t:'DM text'}),
  fetchedMessages,MAX_CHANNELS:300,gte:(a,b)=>BigInt(a)>=BigInt(b),
 });
 const first=await fetchPage('dm',null);
 assert.equal(first.id,'100');
 assert.equal(fetchedMessages.get('dm').length,2);
 assert.equal(queries[0].limit,50);
 assert.equal('after' in queries[0],false);
 assert.equal('before' in queries[0],false);
});
