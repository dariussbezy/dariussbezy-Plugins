import manifest from '../manifest.json'
import {
	isRecording,
	pauseRecording,
	record,
	recordStall,
	stopRecording,
} from './recording'

type Fn = (...args: any[]) => any
type Api = Record<string, unknown>

/** One place a plugin hooks into, such as `after render` or `flux MESSAGE_CREATE`. */
export interface Site {
	label: string
	calls: number
	ms: number
	max: number
	slow: number
}

export interface Stats {
	id: string
	/** Calls, time and frame drops of every hook together. */
	calls: number
	ms: number
	max: number
	slow: number
	/** Time spent in preInit, init and start. */
	startup: number
	/** Hooks that are active right now. */
	hooks: number
	sites: Map<string, Site>
}

export interface Stall {
	at: number
	ms: number
}

const SELF = manifest.id
export const UNKNOWN = 'unknown'
/** A call longer than one frame at 60 Hz makes the app stutter. */
export const SLOW_MS = 16
/** The JS thread is checked this often; a check that comes late means it was busy. */
const TICK_MS = 250
const STALL_MS = 100
const STALL_LIMIT = 5
const SOURCE = /Valenced:Plugin:([^\s:)]+)/g

const clock: () => number =
	typeof performance === 'object' && typeof performance.now === 'function'
		? () => performance.now()
		: () => Date.now()

const KEY = Symbol.for('dariuss.performance-monitor.state')
const ORIGINAL = Symbol.for('dariuss.performance-monitor.original')

interface Shared {
	stats: Map<string, Stats>
	names: Map<string, string>
	attribution: { stack: number; context: number; unknown: number }
	thread: {
		stalls: Stall[]
		last: Stall | undefined
		stalledMs: number
		stallCount: number
	}
	state: {
		since: number
		/** Time the app spent suspended in the background, left out of the measured time. */
		pausedMs: number
		active: boolean
		developerMode: boolean
		startedLate: boolean
	}
	timer: ReturnType<typeof setInterval> | undefined
}

// Kept on the global object: when this script is evaluated again (the plugin restarts while the
// app keeps running), hooks wrapped by the earlier run must still feed the numbers the page shows.
const holder = globalThis as { [KEY]?: Shared }
const shared: Shared = (holder[KEY] ??= {
	stats: new Map(),
	names: new Map(),
	attribution: { stack: 0, context: 0, unknown: 0 },
	thread: { stalls: [], last: undefined, stalledMs: 0, stallCount: 0 },
	state: {
		since: Date.now(),
		pausedMs: 0,
		active: false,
		developerMode: false,
		startedLate: false,
	},
	timer: undefined,
})

export const { stats, names, attribution, thread, state } = shared

/** The plugin whose code runs right now, while it starts or inside one of its hooks. */
let current: string | undefined
/** Time measured inside the current hook by nested hooks or by the original function. */
let nested = 0

function statsOf(id: string): Stats {
	let entry = stats.get(id)
	if (!entry) {
		entry = {
			id,
			calls: 0,
			ms: 0,
			max: 0,
			slow: 0,
			startup: 0,
			hooks: 0,
			sites: new Map(),
		}
		stats.set(id, entry)
	}
	return entry
}

function siteOf(entry: Stats, label: string): Site {
	let site = entry.sites.get(label)
	if (!site) {
		site = { label, calls: 0, ms: 0, max: 0, slow: 0 }
		entry.sites.set(label, site)
	}
	return site
}

/** Who registered a hook: the plugin script in the call stack, else the plugin that is running. */
function owner(): string {
	const stack = new Error().stack ?? ''
	SOURCE.lastIndex = 0
	for (let match = SOURCE.exec(stack); match; match = SOURCE.exec(stack)) {
		const id = match[1]
		if (id && id !== SELF) {
			attribution.stack++
			return id
		}
	}
	if (current && current !== SELF) {
		attribution.context++
		return current
	}
	attribution.unknown++
	return UNKNOWN
}

/**
 * Runs `fn` and counts only its own time: time spent in hooks it triggers or in the original
 * function an instead hook calls is left to those.
 */
function run(
	id: string,
	fn: Fn,
	self: unknown,
	args: unknown[],
	done: (ms: number) => void,
) {
	const outer = nested
	const before = current
	nested = 0
	current = id
	const start = clock()
	try {
		return fn.apply(self, args)
	} finally {
		const total = clock() - start
		done(Math.max(0, total - nested))
		nested = outer + total
		current = before
	}
}

function timed(entry: Stats, site: Site, fn: Fn): Fn {
	return function (this: unknown, ...args: unknown[]) {
		if (!state.active) return fn.apply(this, args)
		return run(entry.id, fn, this, args, ms => {
			entry.calls++
			entry.ms += ms
			site.calls++
			site.ms += ms
			if (ms > entry.max) entry.max = ms
			if (ms > site.max) site.max = ms
			const slow = ms >= SLOW_MS
			if (slow) {
				entry.slow++
				site.slow++
			}
			if (isRecording()) record(entry.id, site.label, ms, slow)
		})
	}
}

const excludedCache = new WeakMap<Fn, Fn>()

/** The original function an instead hook calls; its time belongs to Discord, not the plugin. */
function excluded(fn: Fn): Fn {
	// Class components must stay as they are, since React constructs them.
	if (
		typeof fn !== 'function' ||
		(fn.prototype as { isReactComponent?: unknown } | undefined)
			?.isReactComponent
	)
		return fn
	let wrapped = excludedCache.get(fn)
	if (!wrapped) {
		wrapped = function (this: unknown, ...args: unknown[]) {
			if (!state.active) return fn.apply(this, args)
			const outer = nested
			const before = current
			current = undefined
			const start = clock()
			try {
				return fn.apply(this, args)
			} finally {
				nested = outer + (clock() - start)
				current = before
			}
		}
		excludedCache.set(fn, wrapped)
	}
	return wrapped
}

function nameOf(target: unknown): string {
	if (typeof target === 'string') return target
	if (!target || (typeof target !== 'object' && typeof target !== 'function'))
		return ''
	// Module exports can be proxies whose reads throw or load code, so only plain own values count.
	try {
		for (const key of ['displayName', 'name']) {
			const desc = Object.getOwnPropertyDescriptor(target, key)
			if (
				desc &&
				'value' in desc &&
				typeof desc.value === 'string' &&
				desc.value
			)
				return desc.value
		}
	} catch {
		// No name then.
	}
	return ''
}

function label(kind: string, ...parts: unknown[]) {
	const text = parts.map(nameOf).filter(Boolean).join('.')
	return (text ? `${kind} ${text}` : kind).slice(0, 80)
}

/** Wraps a hook so its calls are counted for the plugin that registers it. */
function track(kind: string, parts: unknown[], hook: unknown, instead = false) {
	if (typeof hook !== 'function') return { hook, entry: undefined }
	const entry = statsOf(owner())
	const site = siteOf(entry, label(kind, ...parts))
	const fn = hook as Fn
	const body: Fn = instead
		? function (this: unknown, args: unknown, original: Fn) {
				return fn.call(this, args, excluded(original))
			}
		: fn
	return { hook: timed(entry, site, body), entry }
}

/** Keeps the active hook count in step with the unpatch function a register call returns. */
function counted(entry: Stats | undefined, unpatch: unknown) {
	if (!entry) return unpatch
	entry.hooks++
	if (typeof unpatch !== 'function') return unpatch
	let done = false
	return function (this: unknown, ...args: unknown[]) {
		if (!done) {
			done = true
			entry.hooks--
		}
		return (unpatch as Fn).apply(this, args)
	}
}

function wrapRegister(
	original: unknown,
	kind: string,
	hookIndex: number,
	parts: (args: unknown[]) => unknown[],
	instead = false,
): unknown {
	if (typeof original !== 'function') return original
	// A wrapper left by an earlier run of this script is unwrapped first, so hooks are not timed twice.
	const fn = ((original as Fn & { [ORIGINAL]?: Fn })[ORIGINAL] ??
		original) as Fn
	const wrapper = function (this: unknown, ...args: unknown[]) {
		let entry: Stats | undefined
		try {
			const tracked = track(kind, parts(args), args[hookIndex], instead)
			args[hookIndex] = tracked.hook
			entry = tracked.entry
		} catch {
			// Never break the plugin that registers: its hook is then left as it is.
		}
		return counted(entry, fn.apply(this, args))
	}
	;(wrapper as Fn & { [ORIGINAL]?: Fn })[ORIGINAL] = fn
	return wrapper
}

const patcherKeyParts = (args: unknown[]) => [args[0], args[1]]

/** Copies a module namespace (read-only) into a plain object with some functions replaced. */
function replaced(
	source: unknown,
	changes: Record<string, unknown>,
): Api | undefined {
	if (!source || typeof source !== 'object') return undefined
	return Object.assign({}, source as Api, changes)
}

/** Puts a value on an object and returns how to put the old one back. */
function swap(
	target: unknown,
	key: string,
	value: unknown,
): (() => void) | undefined {
	if (!target || typeof target !== 'object' || value === undefined) return
	const object = target as Api
	const old = Object.getOwnPropertyDescriptor(object, key)
	try {
		Object.defineProperty(object, key, {
			configurable: true,
			enumerable: true,
			writable: true,
			value,
		})
	} catch {
		try {
			object[key] = value
		} catch {
			return
		}
	}
	return () => {
		try {
			if (old) Object.defineProperty(object, key, old)
			else delete object[key]
		} catch {
			try {
				object[key] = old?.value
			} catch {
				// Nothing to restore.
			}
		}
	}
}

interface InternalPlugin {
	manifest: { id: string; name?: string }
	lifecycles: Record<string, unknown>
}

const LIFECYCLES = ['preInit', 'init', 'start'] as const

/** Times each plugin's preInit, init and start, also those set later when a plugin loads. */
function trackLifecycles(plugin: InternalPlugin): (() => void) | undefined {
	const { id } = plugin.manifest
	if (id === SELF || !plugin.lifecycles) return
	const { lifecycles } = plugin
	const undo: (() => void)[] = []
	for (const name of LIFECYCLES) {
		let value = lifecycles[name]
		const wrap = (fn: unknown) => {
			if (typeof fn !== 'function') return fn
			const entry = statsOf(id)
			return function (this: unknown, ...args: unknown[]) {
				if (!state.active) return (fn as Fn).apply(this, args)
				return run(id, fn as Fn, this, args, ms => {
					entry.startup += ms
				})
			}
		}
		let wrapped = wrap(value)
		try {
			Object.defineProperty(lifecycles, name, {
				configurable: true,
				enumerable: true,
				get: () => wrapped,
				set: next => {
					value = next
					wrapped = wrap(next)
				},
			})
		} catch {
			continue
		}
		undo.push(() => {
			Object.defineProperty(lifecycles, name, {
				configurable: true,
				enumerable: true,
				writable: true,
				value,
			})
		})
	}
	return () => {
		for (const fn of undo) fn()
	}
}

/** A check this late means the app was suspended in the background, not that the thread was busy. */
const SUSPENDED_MS = 5000

function watchThread(): () => void {
	if (shared.timer) clearInterval(shared.timer)
	let expected = Date.now() + TICK_MS
	const timer = setInterval(() => {
		const now = Date.now()
		const late = now - expected
		expected = now + TICK_MS
		if (!state.active || late < STALL_MS) return
		if (late >= SUSPENDED_MS) {
			state.pausedMs += late
			pauseRecording(late)
			return
		}
		thread.stallCount++
		thread.stalledMs += late
		thread.last = { at: now, ms: late }
		thread.stalls.push(thread.last)
		thread.stalls.sort((a, b) => b.ms - a.ms)
		thread.stalls.length = Math.min(thread.stalls.length, STALL_LIMIT)
		recordStall(late)
	}, TICK_MS)
	shared.timer = timer
	return () => {
		clearInterval(timer)
		if (shared.timer === timer) shared.timer = undefined
	}
}

/**
 * Wraps the shared Valenced APIs that plugins use to hook into Discord. Plugin scripts read
 * `valenced.patcher.after` and the like each time they call it, so hooks registered from now on
 * are timed. Returns how to undo it.
 */
export function install(unscoped: unknown): () => void {
	const api = unscoped as Api
	const undo: (() => void)[] = []
	const keep = (fn: (() => void) | undefined) => {
		if (fn) undo.push(fn)
	}

	const patcher = api.patcher as Api | undefined
	keep(
		swap(
			api,
			'patcher',
			replaced(patcher, {
				before: wrapRegister(patcher?.before, 'before', 2, patcherKeyParts),
				after: wrapRegister(patcher?.after, 'after', 2, patcherKeyParts),
				instead: wrapRegister(
					patcher?.instead,
					'instead',
					2,
					patcherKeyParts,
					true,
				),
			}),
		),
	)

	const react = api.react as Api | undefined
	const jsx = react?.jsxRuntime as Api | undefined
	const jsxParts = (args: unknown[]) => [args[0]]
	keep(
		swap(
			react,
			'jsxRuntime',
			replaced(jsx, {
				beforeJSX: wrapRegister(jsx?.beforeJSX, 'beforeJSX', 1, jsxParts),
				afterJSX: wrapRegister(jsx?.afterJSX, 'afterJSX', 1, jsxParts),
				insteadJSX: wrapRegister(
					jsx?.insteadJSX,
					'insteadJSX',
					1,
					jsxParts,
					true,
				),
			}),
		),
	)

	try {
		const discord = api.discord as Api | undefined
		const flux = discord?.flux as Api | undefined
		keep(
			swap(
				discord,
				'flux',
				replaced(flux, {
					onFluxEventDispatched: wrapRegister(
						flux?.onFluxEventDispatched,
						'flux',
						1,
						args => [args[0]],
					),
					onAnyFluxEventDispatched: wrapRegister(
						flux?.onAnyFluxEventDispatched,
						'flux',
						0,
						() => ['every event'],
					),
				}),
			),
		)
	} catch {
		// Flux is not loaded yet; patches and JSX hooks are still timed.
	}

	const modules = api.modules as Api | undefined
	const finders = modules?.finders as Api | undefined
	const filterParts = (args: unknown[]) => [
		String((args[0] as { key?: unknown } | undefined)?.key ?? '').slice(0, 50),
	]
	for (const key of ['getModules', 'waitForModules']) {
		const original = finders?.[key]
		if (typeof original !== 'function') continue
		keep(
			swap(
				finders,
				key,
				wrapRegister(original, 'module found', 1, filterParts),
			),
		)
	}

	const internal = ((api.hidden as Api | undefined)?.plugins as Api | undefined)
		?.internal as { pList?: Map<string, InternalPlugin> } | undefined
	if (internal?.pList instanceof Map) {
		state.developerMode = true
		for (const plugin of internal.pList.values()) {
			if (plugin.manifest?.name)
				names.set(plugin.manifest.id, plugin.manifest.name)
			keep(trackLifecycles(plugin))
		}
	}

	keep(watchThread())
	// A restart of this script keeps the numbers that hooks of the earlier run kept counting.
	if (!state.active) {
		state.since = Date.now()
		state.pausedMs = 0
	}
	state.active = true

	return () => {
		state.active = false
		stopRecording(false)
		for (const fn of undo.reverse()) fn()
	}
}

/**
 * Clears the counts but keeps startup times and active hooks. Sites are zeroed in place: running
 * hooks hold their own Site object, so removing it from the map would freeze its row.
 */
export function reset() {
	for (const entry of stats.values()) {
		entry.calls = 0
		entry.ms = 0
		entry.max = 0
		entry.slow = 0
		for (const site of entry.sites.values()) {
			site.calls = 0
			site.ms = 0
			site.max = 0
			site.slow = 0
		}
	}
	thread.stalls.length = 0
	thread.last = undefined
	thread.stalledMs = 0
	thread.stallCount = 0
	state.since = Date.now()
	state.pausedMs = 0
}

/** Measured time without the stretches the app was suspended. */
export const elapsedMs = () =>
	Math.max(1, Date.now() - state.since - state.pausedMs)

/** Sites that have run since the last reset, busiest first. */
export const activeSites = (entry: Stats) =>
	[...entry.sites.values()]
		.filter(site => site.calls > 0)
		.sort((a, b) => b.ms - a.ms)

export type SortKey = 'total' | 'longest' | 'startup'

export function sorted(by: SortKey): Stats[] {
	const value = (entry: Stats) =>
		by === 'longest' ? entry.max : by === 'startup' ? entry.startup : entry.ms
	return (
		[...stats.values()]
			.filter(entry => entry.calls > 0 || entry.startup > 0 || entry.hooks > 0)
			// Ties (all startups are 0 without Developer Mode) fall back to total time, then longest call.
			.sort((a, b) => value(b) - value(a) || b.ms - a.ms || b.max - a.max)
	)
}

export const displayName = (id: string) =>
	id === UNKNOWN ? 'Not identified' : (names.get(id) ?? id)

export function formatMs(ms: number) {
	if (ms >= 10_000) return `${(ms / 1000).toFixed(1)} s`
	if (ms >= 100) return `${Math.round(ms)} ms`
	if (ms >= 1) return `${ms.toFixed(1)} ms`
	return `${ms.toFixed(2)} ms`
}

/** Share of the measured time this plugin kept the JS thread busy. */
export function shareOf(entry: Stats) {
	return entry.ms / elapsedMs()
}

/** Slow when a call drops a frame or the plugin uses more than 1% of the time. */
export const isSlow = (entry: Stats) =>
	entry.max >= SLOW_MS || shareOf(entry) >= 0.01
