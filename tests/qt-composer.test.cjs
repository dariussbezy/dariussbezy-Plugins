const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function draftButton(job, succeeds = true) {
 const source = fs.readFileSync(path.join(__dirname, '../plugins/QT/js/original.js'), 'utf8');
 const start = source.indexOf('  const onPress = () => {', source.indexOf('  const translateSendMode ='));
 const end = source.indexOf('\n  const openPanel =', start);
 const calls = [];
 const usual = { targetOut: 'en', sourceOut: 'auto' };
 const context = {
  armed: job, props: { position: 'send' },
  settings: { draftBeforeSend: true, keepArmed: true },
  run: async (tl, sl) => { calls.push({ tl, sl }); return succeeds; },
  notifyButton() {}, toast() {}, getChatLanguages: () => usual,
 };
 const press = vm.runInNewContext(source.slice(start, end) + '\nonPress;', context);
 return { context, calls, usual, press };
}

test('a one-time draft language leaves the translated draft ready to send even when translation was already active', async () => {
 const button = draftButton({ tl: 'ro', sl: 'auto', oneShot: true, resume: { tl: 'en', sl: 'auto' } });
 button.press();
 await new Promise(setImmediate);
 assert.deepEqual(button.calls, [{ tl: 'ro', sl: 'auto' }]);
 assert.equal(button.context.armed, null, 'the send slot must return to native Send instead of translating again to English');
 assert.equal(button.usual.targetOut, 'en', 'the saved usual language must not change');
});

test('a failed one-time draft translation remains active for retry', async () => {
 const job = { tl: 'ro', sl: 'auto', oneShot: true, resume: { tl: 'en', sl: 'auto' } };
 const button = draftButton(job, false);
 button.press();
 await new Promise(setImmediate);
 assert.equal(button.context.armed, job);
});

test('translate/send stays on the bottom row of a multiline composer', async () => {
 const Yoga = (await import('yoga-layout')).default;
 const source = fs.readFileSync(path.join(__dirname, '../plugins/QT/js/original.js'), 'utf8');
 const start = source.indexOf('function ComposerSendSlot(');
 const end = source.indexOf('\nfunction ', start + 1);
 for (const height of [40, 200]) {
  for (const active of [false, true]) {
   const render = vm.runInNewContext('(' + source.slice(start, end) + ')', {
    React: {
     createElement: (type, props, ...children) => ({ type, props, children }),
     useState: () => [active, () => {}], useEffect: () => {},
    },
    RN: { View: 'View' }, useQuickTranslate: () => ({ anchor: 'send' }),
    armed: active, buttonListeners: new Set(),
   });
   const tree = render({ button: { type: 'button' }, children: { type: 'send' } });
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
