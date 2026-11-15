import { ActionSheetActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { instead } from '@valenced/patcher'
import { cloneElement, isValidElement, useSyncExternalStore } from 'react'
import { arrange, iconsOf, sectionsOf } from './reorder'
import SettingsComponent from './settings'
import {
	bindStorage,
	DefaultSettings,
	getSettings,
	learn,
	sessionIcons,
	setSettings,
	snapshot,
	subscribe,
} from './shared'
import type { ReactElement, ReactNode } from 'react'
import type { IconInfo } from './reorder'
import type { Settings } from './shared'

type Component = (props: unknown) => ReactNode
type Namespace = { default?: unknown; [key: string]: unknown }
type SheetProps = { children?: ReactNode }

const SHEET_KEY = 'MessageLongPressActionSheet'

const nameOf = (component: unknown) => {
	const named = component as { displayName?: string; name?: string } | null
	return named?.displayName ?? named?.name
}

/** Applies `visit` to the first ActionSheet in the tree. */
function mapSheet(
	node: ReactNode,
	visit: (sheet: ReactElement<SheetProps>) => ReactNode,
	depth = 0,
): ReactNode {
	if (depth > 12) return node
	if (Array.isArray(node)) {
		let changed = false
		const next = node.map(child => {
			const result = mapSheet(child, visit, depth + 1)
			if (result !== child) changed = true
			return result
		})
		return changed ? next : node
	}
	if (!isValidElement<SheetProps>(node)) return node
	if (node.type === Design.ActionSheet || nameOf(node.type) === 'ActionSheet')
		return visit(node)
	const children = mapSheet(node.props.children, visit, depth + 1)
	return children === node.props.children
		? node
		: cloneElement(node, { children })
}

let pending: { sections: string[][]; icons: Map<string, IconInfo> } | null =
	null
/** Remembers new action labels and their icons after the render, never during it. */
function remember(sections: string[][], icons: Map<string, IconInfo>) {
	if (!sections.some(section => section.length)) return
	pending = { sections, icons }
	setTimeout(() => {
		if (!pending) return
		const { order, icons: saved } = getSettings()
		const next = learn(order, pending.sections)
		let iconsChanged = false
		const nextIcons = { ...saved }
		for (const [label, { component, name, id }] of pending.icons) {
			if (component) sessionIcons.set(label, component)
			const known = saved[label]
			if ((name || id != null) && (known?.name !== name || known?.id !== id)) {
				nextIcons[label] = { name, id }
				iconsChanged = true
			}
		}
		pending = null
		if (next?.length || iconsChanged)
			setSettings({
				...(next?.length ? { order: next } : {}),
				...(iconsChanged ? { icons: nextIcons } : {}),
			})
	}, 0)
}

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: { load: true, default: DefaultSettings },
	SettingsComponent,
	start({ cleanup, jsonStorage, logger }) {
		bindStorage(jsonStorage)
		const wrappers = new WeakMap<Component, Component>()

		const wrap = (Sheet: Component): Component => {
			let wrapped = wrappers.get(Sheet)
			if (wrapped) return wrapped
			wrapped = function MessageActionsSheet(props) {
				useSyncExternalStore(subscribe, snapshot, snapshot)
				const tree = Sheet(props)
				try {
					const { order, hidden, removed, customized, hideReactions } =
						getSettings()
					return mapSheet(tree, sheet => {
						remember(
							sectionsOf(sheet.props.children),
							iconsOf(sheet.props.children),
						)
						if (!customized && !hideReactions) return sheet
						return cloneElement(sheet, {
							...(hideReactions ? { header: null } : {}),
							...(customized
								? {
										children: arrange(
											sheet.props.children,
											order,
											new Set([...hidden, ...removed]),
										),
									}
								: {}),
						})
					})
				} catch (error) {
					logger.error('Message Actions failed:', error)
					return tree
				}
			}
			wrappers.set(Sheet, wrapped)
			return wrapped
		}

		cleanup(
			() => bindStorage(undefined),
			// `instead` runs after every `before` hook, so the rows other plugins add are already in the sheet.
			instead(ActionSheetActionCreators, 'openLazy', (args, openLazy) => {
				const [promise, key] = args as unknown[]
				if (
					key === SHEET_KEY &&
					typeof (promise as Promise<unknown> | undefined)?.then === 'function'
				)
					(args as unknown[])[0] = (promise as Promise<Namespace>).then(
						module =>
							typeof module?.default === 'function'
								? { ...module, default: wrap(module.default as Component) }
								: module,
					)
				return Reflect.apply(openLazy, ActionSheetActionCreators, args)
			}),
		)
	},
})
