const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
