const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
function ast(file){return ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true);}
function all(tree,predicate){const found=[];function visit(node){if(predicate(node))found.push(node);ts.forEachChild(node,visit);}visit(tree);return found;}

test('settings BUILD labels read their version from the manifest',()=>{
 for(const [code,file]of [['QT','settings.tsx'],['VMTT','settings.tsx']]){
  const tree=ast(`plugins/${code}/js/${file}`);
  const imports=all(tree,n=>ts.isImportDeclaration(n)&&n.moduleSpecifier.text==='../manifest.json');
  assert.ok(imports.some(n=>n.importClause?.name?.text==='manifest'),code+' imports its manifest');
  const builds=all(tree,n=>ts.isVariableDeclaration(n)&&n.name.getText(tree)==='BUILD');
  assert.equal(builds.length,1,code);
  assert.equal(builds[0].initializer.getText(tree),'manifest.version',code+' uses the installed manifest version');
 }
 const midnight=ast('themes/MT/js/settings.tsx');
 assert.ok(all(midnight,n=>ts.isPropertyAccessExpression(n)&&n.getText(midnight)==='manifest.version').length,'Midnight settings use the manifest');
});

test('AML and GPL latest channels publish 2.0.0 with matching manifests',()=>{
 const index=read('index.json'),config=read('repo.config.json');
 for(const [code,id]of [['AML','dariuss.advanced-message-logger'],['GPL','dariuss.ghost-ping-logger']]){
  const manifest=read(`plugins/${code}/manifest.json`);
  assert.equal(manifest.version,'2.0.0');
  assert.equal(index.plugins[id].channels.latest,manifest.version);
  assert.equal(config.channels[id].latest,manifest.version);
 }
});
