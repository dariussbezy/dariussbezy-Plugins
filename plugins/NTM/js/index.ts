import { getModules } from '@valenced/modules/finders';
import { withName, withProps } from '@valenced/modules/finders/filters';
import { after } from '@valenced/patcher';
import { cloneElement, isValidElement } from 'react';

export default plugin({
  start({ cleanup, plugin: instance }) {
    let active = true;
    const patched = new WeakSet<object>();
    const callbacks = new WeakMap<Function, (...args: any[]) => any>();
    cleanup(() => { active = false; });
    function decorate(tree: any, depth = 0): any {
      if (!active || depth > 24) return tree;
      if (Array.isArray(tree)) return tree.map(node => decorate(node, depth + 1));
      if (!isValidElement<Record<string, any>>(tree)) return tree;
      const props = tree.props;
      const changes: Record<string, any> = {};
      if (typeof props.onTapUsername === 'function') {
        const original = props.onTapUsername;
        let blocked = callbacks.get(original);
        if (!blocked) {
          blocked = function (this: unknown, ...args: any[]) {
            if (!active) return original.apply(this, args);
          };
          callbacks.set(original, blocked);
        }
        changes.onTapUsername = blocked;
      }
      if (props.children) {
        const children = decorate(props.children, depth + 1);
        if (children !== props.children) changes.children = children;
      }
      return Object.keys(changes).length ? cloneElement(tree, changes) : tree;
    }
    const attach = (namespace: any) => {
      const component = namespace?.default;
      if (!component) return;
      const owner = typeof component === 'function' ? namespace : component;
      const key = typeof component === 'function' ? 'default'
        : typeof component.type === 'function' ? 'type' : 'render';
      if (typeof owner[key] !== 'function' || patched.has(owner)) return;
      patched.add(owner);
      cleanup(after(owner, key, result => decorate(result)));
    };
    cleanup(getModules(withName('MessagesRenderer'), attach, { returnNamespace: true }));
    // Discord exports React.memo(MessagesRenderer), whose outer object has no name.
    cleanup(getModules(withProps<{ type: { name?: string } }>('type'), component => {
      if (component.type?.name === 'MessagesRenderer') attach({ default: component });
    }));
    if (instance.startedLate) instance.requireReload();
  },
});
