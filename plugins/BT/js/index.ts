import { ToastActionCreators } from '@valenced/discord/actions'
import { getModuleWithImportedPath } from '@valenced/discord/utils/modules/finders'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { instead } from '@valenced/patcher'
import { cloneElement, isValidElement } from 'react'
import { Vibration } from 'react-native'
import { applied, remember } from './log'
import SettingsComponent from './settings'
import { DefaultSettings } from './shared'
import type { ReactElement, ReactNode } from 'react'
import type { Settings } from './shared'

/** How long Discord keeps a toast on its own. */
const DISCORD_MS = 5000
/** A toast slides in before it counts as shown: closing it sooner after opening hides it. */
const ENTER_MS = 700

/** Pause between closing the old toast and opening the new one. */
const REPLACE_GAP_MS = 250
/** Most lines a long toast text gets. */
const MAX_LINES = 8
/** Messages longer than 40 characters get this much more time per character, up to the cap. */
const EXTRA_MS_PER_CHAR = 60
const MAX_EXTRA_MS = 10_000
/** With pause on, Discord's own timer is made so long that only ours closes the toast. */
const LONG_MS = 120_000
/** A finger must travel this far (in points) for a touch to count as a swipe. */
const SWIPE_DISTANCE = 50
/** A touch that moved less than this is a tap. */
const TAP_DISTANCE = 12
/** A held toast stays at least this long after the finger lifts. */
const MIN_AFTER_HOLD_MS = 1500
const ERROR_VARIANT = /fail|error|danger|critical|destructive/i

interface ToastOptions {
	text?: unknown
	content?: unknown
	duration?: number
	toastDurationMs?: number
	variant?: unknown
	type?: unknown
}

type Props = {
	children?: unknown
	numberOfLines?: number
	lineClamp?: number
	maxLines?: number
	pointerEvents?: string
}

/** Names of the props that limit how many lines a text uses. */
const LINE_PROPS = ['numberOfLines', 'lineClamp', 'maxLines'] as const

/**
 * Lets text in the toast use more lines and lets touches reach it. Returns the same node when
 * nothing changed, keeps children and keys as they were, and counts changes in `found`.
 */
function adjust(
	node: ReactNode,
	options: { lines: boolean; touch: boolean },
	found: { lines: number; touch: number },
	depth = 0,
): ReactNode {
	if (depth > 10) return node
	if (Array.isArray(node)) {
		let changed = false
		const next = node.map(child => {
			const result = adjust(child, options, found, depth)
			if (result !== child) changed = true
			return result
		})
		return changed ? next : node
	}
	if (!isValidElement(node)) return node
	const element = node as ReactElement<Props>
	const patch: Props = {}
	if (options.lines)
		for (const name of LINE_PROPS)
			if (typeof element.props[name] === 'number') {
				patch[name] = MAX_LINES
				found.lines++
			}
	if (options.touch && element.props.pointerEvents === 'none') {
		// Never 'auto': a layer that took touches itself would block the whole screen, not just the toast.
		patch.pointerEvents = 'box-none'
		found.touch++
	}
	const { children } = element.props
	if (children != null && typeof children !== 'function') {
		const result = adjust(children as ReactNode, options, found, depth + 1)
		if (result !== children) patch.children = result
	}
	return Object.keys(patch).length > 0 ? cloneElement(element, patch) : node
}

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: { load: true, default: DefaultSettings },
	SettingsComponent,
	async start({ cleanup, jsonStorage, logger }) {
		// Android can start the plugin before its saved settings are read, which made the options look off.
		await jsonStorage.get()
		const settings = () => ({ ...DefaultSettings, ...jsonStorage.cache })
		/** When the toast on screen goes away, by our own count. */
		let visibleUntil = 0
		/** The same moment, kept apart because a held toast moves visibleUntil far away. */
		let deadline = 0
		/** True while a finger holds the toast and its timer is stopped. */
		let held = false
		/** Text of the toast that opened last, for copying. */
		let lastText = ''
		let active = true
		let timer: ReturnType<typeof setTimeout> | undefined
		/** A toast waiting its turn after the old one was closed. */
		let pending: ReturnType<typeof setTimeout> | undefined

		cleanup(() => {
			active = false
			clearTimeout(timer)
			clearTimeout(pending)
		})

		cleanup(
			instead(ToastActionCreators, 'open', ((
				args: unknown[],
				original: (...args: unknown[]) => unknown,
			) => {
				const show = () => {
					try {
						const first = args[0] as unknown
						const isNew = typeof first === 'string'
						// Discord before 350204 takes one options object, newer versions a key and options.
						const options = (isNew ? args[1] : first) as
							| ToastOptions
							| undefined
						const text = isNew ? options?.text : options?.content
						lastText = typeof text === 'string' ? text : ''
						const variant = String(options?.variant ?? options?.type ?? '')
						const config = settings()
						let ms = Math.round(Math.max(2, config.seconds) * 1000)
						if (config.byLength)
							ms += Math.min(
								MAX_EXTRA_MS,
								Math.max(0, lastText.length - 40) * EXTRA_MS_PER_CHAR,
							)
						// With pause on, only our timer closes the toast, so it can be stopped while touched.
						const closeByHand = applied.pause || ms + ENTER_MS < DISCORD_MS
						if (options && typeof options === 'object') {
							const duration = applied.pause ? LONG_MS : ms
							if (isNew) options.duration = duration
							else options.toastDurationMs = duration
						}
						if (config.history && lastText !== '') remember(lastText, variant)
						if (config.haptic && ERROR_VARIANT.test(variant))
							Vibration.vibrate(40)
						clearTimeout(timer)
						deadline = Date.now() + ms + ENTER_MS
						visibleUntil = deadline
						// Discord ignores a duration shorter than its own, so a short toast is closed by hand.
						if (closeByHand)
							timer = setTimeout(
								() => ToastActionCreators.close(),
								ms + ENTER_MS,
							)
					} catch (error) {
						logger.error('Could not change a toast', error)
					}
					return Reflect.apply(original, undefined, args)
				}
				// Closing and opening in the same instant can swallow the new toast, so the new one waits a moment.
				if (
					settings().replace &&
					(pending !== undefined || Date.now() < visibleUntil)
				) {
					clearTimeout(pending)
					clearTimeout(timer)
					ToastActionCreators.close()
					visibleUntil = 0
					pending = setTimeout(() => {
						pending = undefined
						show()
					}, REPLACE_GAP_MS)
					return undefined
				}
				return show()
			}) as never),
		)

		// Options that change how Discord draws the toast. They patch its ToastContainer, so they need a reload.
		const { full, copy, pause, swipe } = settings()
		applied.full = full
		applied.copy = copy
		applied.pause = pause
		applied.swipe = swipe
		const touchy = copy || pause || swipe
		if (!full && !touchy) return

		/**
		 * Patches the render of one of Discord's toast components, found by its source path
		 * (the toast is drawn by these Mana components). `change` gets what the component returned.
		 */
		const watch = (
			path: string,
			label: string,
			change: (
				tree: ReactNode,
				props: Record<string, unknown> | undefined,
			) => ReactNode,
		) => {
			cleanup(
				getModuleWithImportedPath(path, namespace => {
					try {
						const ns = namespace as Record<string, unknown> | undefined
						// The component is the default export or an export named like the component,
						// and is either a plain function or a memo/forwardRef object.
						let target: Record<string, unknown> | undefined
						let key = ''
						for (const holder of [ns?.default, ns?.[label]] as const) {
							if (typeof holder === 'function') {
								target = ns
								key = holder === ns?.default ? 'default' : label
								break
							}
							const object = holder as Record<string, unknown> | undefined
							if (typeof object?.type === 'function') {
								target = object
								key = 'type'
								break
							}
							if (typeof object?.render === 'function') {
								target = object
								key = 'render'
								break
							}
						}
						if (!target || !key) return
						// Not undone on stop: this just passes through once the plugin is off.
						instead(target as never, key, ((
							args: unknown[],
							original: (...args: unknown[]) => unknown,
						) => {
							const ret = Reflect.apply(original, undefined, args)
							if (!active || ret == null) return ret
							try {
								return change(
									ret as ReactNode,
									args[0] as Record<string, unknown> | undefined,
								)
							} catch (error) {
								logger.error(`Could not change ${label}`, error)
								return ret
							}
						}) as never)
					} catch (error) {
						logger.error(`Could not patch ${label}`, error)
					}
				}),
			)
		}

		if (full || touchy) {
			// The toast itself is the square the user sees: it gets more lines and, for copying, the tap.
			watch(
				'design/mana/components/Toast/Toast.native.tsx',
				'Toast',
				(tree, props) => {
					let next = tree
					if (full) {
						const found = { lines: 0, touch: 0 }
						next = adjust(next, { lines: true, touch: false }, found)
					}
					const text = typeof props?.text === 'string' ? props.text : lastText
					if (touchy && isValidElement(next)) {
						let touch = { x: 0, y: 0, dx: 0, dy: 0 }
						/** The finger lifted or the touch was taken away: the timer runs again. */
						const letGo = () => {
							if (!held) return
							held = false
							const left = Math.max(MIN_AFTER_HOLD_MS, deadline - Date.now())
							deadline = Date.now() + left
							visibleUntil = deadline
							clearTimeout(timer)
							timer = setTimeout(() => ToastActionCreators.close(), left)
						}
						type Press = { nativeEvent: { pageX: number; pageY: number } }
						next = cloneElement(
							next as ReactElement<Props>,
							{
								onStartShouldSetResponder: () => {
									return true
								},
								onResponderGrant: (event: Press) => {
									touch = {
										x: event.nativeEvent.pageX,
										y: event.nativeEvent.pageY,
										dx: 0,
										dy: 0,
									}
									if (pause && !held) {
										held = true
										clearTimeout(timer)
										deadline = Math.max(deadline, Date.now())
										visibleUntil = Date.now() + LONG_MS
									}
								},
								onResponderMove: (event: Press) => {
									touch.dx = event.nativeEvent.pageX - touch.x
									touch.dy = event.nativeEvent.pageY - touch.y
								},
								onResponderRelease: () => {
									const far = Math.hypot(touch.dx, touch.dy)
									if (swipe && far >= SWIPE_DISTANCE) {
										held = false
										clearTimeout(timer)
										visibleUntil = 0
										ToastActionCreators.close()
										return
									}
									if (copy && far < TAP_DISTANCE && text !== '') {
										void Clipboard.setString(text)
									}
									letGo()
								},
								onResponderTerminate: letGo,
							} as never,
						)
					}
					return next
				},
			)
		}
		if (full) {
			// The entity (icon and similar) can limit lines too.
			watch(
				'design/mana/components/Toast/ToastEntity.native.tsx',
				'ToastEntity',
				tree => {
					const found = { lines: 0, touch: 0 }
					const next = adjust(tree, { lines: true, touch: false }, found)
					return next
				},
			)
		}
		if (touchy) {
			/** Lets touches pass through the layers around the toast to the toast itself, and only to it. */
			const touchify = (node: ReactNode): ReactNode => {
				const found = { lines: 0, touch: 0 }
				const next = adjust(node, { lines: false, touch: true }, found)
				return next
			}
			watch(
				'design/mana/components/Toast/ToastContainer.native.tsx',
				'ToastContainer',
				tree => {
					if (!isValidElement(tree)) return tree
					const element = tree as ReactElement<
						Props & {
							renderItem?: unknown
							wrapChildren?: unknown
						}
					>
					const { renderItem, wrapChildren } = element.props
					const patch: Record<string, unknown> = {}
					// The group draws each toast with `renderItem` and wraps them all with `wrapChildren`:
					// both are wrapped so touches can reach the toast.
					if (typeof renderItem === 'function') {
						const original = renderItem as (...args: unknown[]) => ReactNode
						patch.renderItem = (...args: unknown[]) => {
							const drawn = original(...args)
							return touchify(drawn)
						}
					}
					if (typeof wrapChildren === 'function') {
						const original = wrapChildren as (...args: unknown[]) => ReactNode
						patch.wrapChildren = (...args: unknown[]) => {
							const wrapped = original(...args)
							const found = { lines: 0, touch: 0 }
							const next = adjust(wrapped, { lines: false, touch: true }, found)
							return next
						}
					}
					return Object.keys(patch).length > 0
						? cloneElement(element, patch as never)
						: tree
				},
			)
		}
	},
})
