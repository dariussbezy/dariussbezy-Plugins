import { getModules } from '@valenced/modules/finders'
import { withName, withProps } from '@valenced/modules/finders/filters'
import { after } from '@valenced/patcher'
import { cloneElement, isValidElement } from 'react'
import { startStatsFor, withStats } from '../../../lib/stats-ui'
import manifest from '../manifest.json'
import SettingsComponent from './settings'
import type { ReactElement, ReactNode } from 'react'

type Callback = (this: unknown, ...args: unknown[]) => unknown
type ElementProps = {
	onTapUsername?: unknown
	children?: ReactNode
}
type Renderer = (...args: unknown[]) => ReactNode
type RendererKey = 'default' | 'type' | 'render'
type RendererHost = Record<RendererKey, Renderer>

// The tree is only walked this deep; real message rows are far shallower.
const MaxDepth = 24

function isRenderer(value: unknown): value is Renderer {
	return typeof value === 'function'
}

export default plugin({
	SettingsComponent: withStats(manifest, SettingsComponent),
	start({ cleanup, plugin: instance }) {
		cleanup(startStatsFor(manifest))
		let active = true
		const patched = new WeakSet<object>()
		// One stable wrapper per original callback, so React does not see new props on every render.
		const wrappers = new WeakMap<Callback, Callback>()
		cleanup(() => {
			active = false
		})

		function wrap(original: Callback): Callback {
			let wrapper = wrappers.get(original)
			if (!wrapper) {
				wrapper = function (this: unknown, ...args) {
					// Once disabled, rows that are still mounted behave natively again.
					if (!active) return original.apply(this, args)
				}
				wrappers.set(original, wrapper)
			}
			return wrapper
		}

		function blockUsernameTap(tree: ReactNode, depth = 0): ReactNode {
			if (!active || depth > MaxDepth) return tree
			if (Array.isArray(tree))
				return tree.map(node => blockUsernameTap(node, depth + 1))
			if (!isValidElement<ElementProps>(tree)) return tree

			const { onTapUsername, children } = (tree as ReactElement<ElementProps>)
				.props
			const changes: ElementProps = {}
			if (typeof onTapUsername === 'function')
				changes.onTapUsername = wrap(onTapUsername as Callback)
			if (children) {
				const next = blockUsernameTap(children, depth + 1)
				if (next !== children) changes.children = next
			}
			return Object.keys(changes).length ? cloneElement(tree, changes) : tree
		}

		function attach(namespace: { default?: unknown } | undefined) {
			const component = namespace?.default as
				| Record<string, unknown>
				| Renderer
				| undefined
			if (!component) return
			// A plain function lives on the namespace; React.memo / forwardRef wrap it in `type` or `render`.
			const host = (
				isRenderer(component) ? namespace : component
			) as RendererHost
			const key: RendererKey = isRenderer(component)
				? 'default'
				: isRenderer(component.type)
					? 'type'
					: 'render'
			if (!isRenderer(host[key]) || patched.has(host)) return
			patched.add(host)
			cleanup(after(host, key, result => blockUsernameTap(result as ReactNode)))
		}

		cleanup(
			getModules(withName('MessagesRenderer'), attach, {
				returnNamespace: true,
			}),
		)
		// Discord exports React.memo(MessagesRenderer), whose outer object has no name.
		cleanup(
			getModules(withProps<{ type: { name?: string } }>('type'), component => {
				if (component.type?.name === 'MessagesRenderer')
					attach({ default: component })
			}),
		)

		if (instance.startedLate) instance.requireReload()
	},
})
