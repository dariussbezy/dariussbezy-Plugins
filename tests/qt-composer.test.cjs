const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = path.join(__dirname, '../plugins/QT/js');

/** Compiles a QT source file to CommonJS and runs it with the given module stubs. */
function load(file, stubs) {
 const code = ts.transpileModule(fs.readFileSync(path.join(source, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
 }).outputText;
 const module = { exports: {} };
 const jsx = (type, props) => {
  const { children, ...rest } = props;
  return { type, props: rest, children: [].concat(children ?? []) };
 };
 const modules = { 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'react-native': { View: 'View' }, ...stubs };
 new Function('exports', 'require', 'module', code)(module.exports, name => {
  if (!(name in modules)) throw new Error('unexpected import ' + name);
  return modules[name];
 }, module);
 return module.exports;
}

function draftSlot(job, succeeds = true) {
 const draft = load('draft.ts', { react: { useSyncExternalStore() {} } });
 draft.setArmed(job);
 const calls = [];
 const press = () => draft.pressTranslateSlot(async (tl, sl) => { calls.push({ tl, sl }); return succeeds; });
 return { draft, calls, press };
}

test('a one-time draft language leaves the translated draft ready to send even when translation was already active', async () => {
 const slot = draftSlot({ tl: 'ro', sl: 'auto', oneShot: true, resume: { tl: 'en', sl: 'auto' } });
 await slot.press();
 assert.deepEqual(slot.calls, [{ tl: 'ro', sl: 'auto' }]);
 assert.equal(slot.draft.getArmed(), null, 'the send slot must return to native Send instead of translating again to English');
});

test('a failed one-time draft translation remains active for retry', async () => {
 const job = { tl: 'ro', sl: 'auto', oneShot: true, resume: { tl: 'en', sl: 'auto' } };
 const slot = draftSlot(job, false);
 await slot.press();
 assert.equal(slot.draft.getArmed(), job);
});

test('translate/send stays on the bottom row of a multiline composer', async () => {
 const Yoga = (await import('yoga-layout')).default;
 for (const height of [40, 200]) {
  for (const active of [false, true]) {
   const { ComposerSendSlot } = load('send-slot.tsx', {
    react: {},
    './draft': { useArmed: () => (active ? { tl: 'en', sl: 'auto' } : null) },
    './store': { useSettings: () => ({ showButton: true, draftBeforeSend: true, anchor: 'send' }) },
   });
   const tree = ComposerSendSlot({ button: { type: 'button' }, children: { type: 'send' } });
   function build(element) {
    const node = Yoga.Node.create();
    if (element.type === 'button' || element.type === 'send') {
     node.setWidth(32); node.setHeight(32); return { node, button: element.type === 'button' ? node : null };
    }
    const style = element.props.style;
    if (style.flexDirection === 'row') node.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
    if (style.alignSelf) node.setAlignSelf(style.alignSelf === 'center' ? Yoga.ALIGN_CENTER : Yoga.ALIGN_FLEX_END);
    if (style.alignItems) node.setAlignItems(Yoga.ALIGN_CENTER);
    if (style.justifyContent) node.setJustifyContent(style.justifyContent === 'center' ? Yoga.JUSTIFY_CENTER : Yoga.JUSTIFY_FLEX_END);
    if (style.position === 'absolute') node.setPositionType(Yoga.POSITION_TYPE_ABSOLUTE);
    for (const [name, edge] of [['top', Yoga.EDGE_TOP], ['bottom', Yoga.EDGE_BOTTOM], ['left', Yoga.EDGE_LEFT], ['right', Yoga.EDGE_RIGHT]]) {
     if (style[name] !== undefined) node.setPosition(edge, style[name]);
    }
    let button;
    for (const child of element.children) {
     const result = build(child); node.insertChild(result.node, node.getChildCount());
     if (result.button) button = result.button;
    }
    return { node, button };
   }
   const root = Yoga.Node.create(); root.setWidth(300); root.setHeight(height);
   root.setFlexDirection(Yoga.FLEX_DIRECTION_ROW); root.setAlignItems(Yoga.ALIGN_FLEX_END);
   const rendered = build(tree); root.insertChild(rendered.node, 0); root.calculateLayout();
   let y = 0, current = rendered.button;
   while (current) { y += current.getComputedTop(); current = current.getParent(); }
   assert.equal(y + 32, height, 'height=' + height + ', active=' + active);
   root.freeRecursive();
  }
 }
});
