import manifest from '../manifest.json'
import {
	isRecording,
	pauseRecording,
	record,
	recordStall,
	stopRecording,
	tally,
} from './recording'
import type { Breakdown } from './recording'

type Fn = (...args: any[]) => any
type Api = Record<string, unknown>

/** One place a plugin hooks into, such as `after render` or `flux MESSAGE_CREATE`. */
export interface Site {
	label: string
	calls: number
	ms: number
	max: number
	slow: number
	/** Calls per duration class (see bucketOf), for percentiles. */
	hist: Float64Array
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

/** What a stall (the JS thread busy for over 100 ms) was made of, as far as it can be told. */
export interface Stall {
	at: number
	ms: number
	/** Time in plugin hooks during the stall. */
	hookMs: number
	/** Time Discord itself spent dispatching Flux events, without plugin hooks. */
	fluxMs: number
	/** Time not accounted for: React rendering, timers, native events, garbage collection. */
	otherMs: number
	/** The plugins that spent the most time in hooks, busiest first. */
	top: { id: string; ms: number }[]
	/** The single slowest hook call. */
	slowest?: { id: string; label: string; ms: number }
	/** The hook that used the most time in total. */
	topHook?: { id: string; label: string; ms: number }
}

const SELF = manifest.id
export const UNKNOWN = 'unknown'
/** A call longer than one frame at 60 Hz makes the app stutter. */
export const SLOW_MS = 16
/** The JS thread is checked this often; a check that comes late means it was busy. */
const TICK_MS = 250
const STALL_MS = 100
const STALL_LIMIT = 5
const HIST_BUCKETS = 22
const HIST_BASE_MS = 0.02

/** Duration classes: the first holds calls up to 0.02 ms, each next one doubles the limit. */
const bucketOf = (ms: number) =>
	ms <= HIST_BASE_MS
		? 0
		: Math.min(HIST_BUCKETS - 1, 1 + Math.floor(Math.log2(ms / HIST_BASE_MS)))

/** The duration below which a share `q` of the calls fall, rounded up to a class limit and never above `max`. */
export function percentile(hists: Float64Array[], q: number, max: number) {
	let total = 0
	for (const hist of hists) for (const count of hist) total += count
	if (!total) return 0
	const target = q * total
	let seen = 0
	for (let bucket = 0; bucket < HIST_BUCKETS; bucket++) {
		for (const hist of hists) seen += hist[bucket]
		if (seen >= target) return Math.min(max, HIST_BASE_MS * 2 ** bucket)
	}
	return max
}
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
	/** What stalls were made of, and which plugins led how many of them. */
	breakdown: Breakdown
	culprits: Map<string, { stalls: number; ms: number }>
	/** Flux dispatch time of Discord, with the hook time of plugins inside it. */
	flux: {
		totalMs: number
		hookMs: number
		calls: number
		depth: number
		start: number
	}
	/** JS frame pacing, only counted while something asks for it. */
	frames: {
		total: number
		dropped: number
		worstMs: number
		users: number
		/** Which frame loop is the current one; an older loop stops when it sees a newer number. */
		loop: number
		running: boolean
	}
	/** The monitor's own cost, measured once. */
	overhead: { perCallMs: number; tickMs: number }
	state: {
		since: number
		/** Time the app spent suspended in the background, left out of the measured time. */
		pausedMs: number
		active: boolean
		developerMode: boolean
		startedLate: boolean
		/** Only one call in this many is timed (light mode); the totals are scaled up. */
		sampleEvery: number
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
	breakdown: { count: 0, ms: 0, hookMs: 0, fluxMs: 0, otherMs: 0 },
	culprits: new Map(),
	flux: { totalMs: 0, hookMs: 0, calls: 0, depth: 0, start: 0 },
	frames: {
		total: 0,
		dropped: 0,
		worstMs: 0,
		users: 0,
		loop: 0,
		running: false,
	},
	overhead: { perCallMs: 0, tickMs: 0 },
	state: {
		since: Date.now(),
		pausedMs: 0,
		active: false,
		developerMode: false,
		startedLate: false,
		sampleEvery: 1,
	},
	timer: undefined,
})
// A restart from an older version of this script finds the object without the newer parts.
shared.breakdown ??= { count: 0, ms: 0, hookMs: 0, fluxMs: 0, otherMs: 0 }
shared.culprits ??= new Map()
shared.flux ??= { totalMs: 0, hookMs: 0, calls: 0, depth: 0, start: 0 }
shared.frames ??= {
	total: 0,
	dropped: 0,
	worstMs: 0,
	users: 0,
	loop: 0,
	running: false,
}
shared.frames.loop ??= 0
shared.frames.running ??= false
shared.overhead ??= { perCallMs: 0, tickMs: 0 }
shared.overhead.tickMs ??= 0
shared.state.sampleEvery ??= 1

export const {
	stats,
	names,
	attribution,
	thread,
	state,
	breakdown,
	culprits,
	flux,
	frames,
	overhead,
} = shared

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
		site = {
			label,
			calls: 0,
			ms: 0,
			max: 0,
			slow: 0,
			hist: new Float64Array(HIST_BUCKETS),
		}
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

/** The slowest hook call since the last check of the thread, to name it when a stall is found. */
let slowestMs = 0
let slowestId = ''
let slowestLabel = ''

function timed(entry: Stats, site: Site, fn: Fn): Fn {
	return function (this: unknown, ...args: unknown[]) {
		if (!state.active) return fn.apply(this, args)
		const every = state.sampleEvery
		// Light mode: most calls run untimed, and the timed ones stand in for the others.
		if (every > 1 && Math.random() * every >= 1) return fn.apply(this, args)
		return run(entry.id, fn, this, args, ms => {
			entry.calls += every
			entry.ms += ms * every
			site.calls += every
			site.ms += ms * every
			if (ms > entry.max) entry.max = ms
			if (ms > site.max) site.max = ms
			site.hist[bucketOf(ms)] += every
			const slow = ms >= SLOW_MS
			if (slow) {
				entry.slow += every
				site.slow += every
			}
			if (ms > slowestMs) {
				slowestMs = ms
				slowestId = entry.id
				slowestLabel = site.label
			}
			if (flux.depth > 0) flux.hookMs += ms * every
			if (isRecording()) record(entry.id, site.label, ms, slow, every)
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

/** Counters as they were at the previous check, so a stall can be split by what ran since. */
const previous = {
	plugins: new Map<string, number>(),
	sites: new Map<Site, number>(),
	fluxMs: 0,
	fluxHookMs: 0,
}

function snapshot() {
	previous.plugins.clear()
	previous.sites.clear()
	for (const entry of stats.values()) {
		previous.plugins.set(entry.id, entry.ms)
		for (const site of entry.sites.values())
			if (site.ms > 0) previous.sites.set(site, site.ms)
	}
	previous.fluxMs = flux.totalMs
	previous.fluxHookMs = flux.hookMs
	slowestMs = 0
}

/**
 * Splits a stall by what ran since the previous check: plugin hooks (and which), Discord's own Flux
 * handling, and the rest. The span also holds up to one check interval before the stall began, so
 * the split is an estimate; each part is capped so they never add up to more than the stall.
 */
function explainStall(late: number, at: number) {
	const top: { id: string; ms: number }[] = []
	let hookTotal = 0
	let topHook: Stall['topHook']
	for (const entry of stats.values()) {
		const spent = entry.ms - (previous.plugins.get(entry.id) ?? 0)
		if (spent > 0.05) {
			top.push({ id: entry.id, ms: spent })
			hookTotal += spent
		}
		for (const site of entry.sites.values()) {
			const used = site.ms - (previous.sites.get(site) ?? 0)
			if (used > 0.05 && (!topHook || used > topHook.ms))
				topHook = { id: entry.id, label: site.label, ms: used }
		}
	}
	top.sort((x, y) => y.ms - x.ms)
	const hookMs = Math.min(hookTotal, late)
	const fluxAll = Math.max(
		0,
		flux.totalMs - previous.fluxMs - (flux.hookMs - previous.fluxHookMs),
	)
	const fluxMs = Math.min(fluxAll, late - hookMs)
	const stall: Stall = {
		at,
		ms: late,
		hookMs,
		fluxMs,
		otherMs: Math.max(0, late - hookMs - fluxMs),
		top: top.slice(0, 3),
		slowest: slowestMs
			? { id: slowestId, label: slowestLabel, ms: slowestMs }
			: undefined,
		topHook,
	}
	thread.stallCount++
	thread.stalledMs += late
	thread.last = stall
	thread.stalls.push(stall)
	thread.stalls.sort((x, y) => y.ms - x.ms)
	thread.stalls.length = Math.min(thread.stalls.length, STALL_LIMIT)
	// The totals of the run keep every plugin that ran in the stall, not only the top three.
	const detail = { ...stall, top }
	tally(breakdown, culprits, detail)
	recordStall(detail)
}

/** One check of the JS thread; `late` is how long after its due time it ran. */
export function onTick(late: number, now: number) {
	const began = clock()
	if (state.active && late >= STALL_MS) {
		// A check this late means the app was suspended in the background, not that the thread was busy.
		if (late >= SUSPENDED_MS) {
			state.pausedMs += late
			pauseRecording(late)
		} else explainStall(late, now)
	}
	snapshot()
	overhead.tickMs += clock() - began
}

function watchThread(): () => void {
	if (shared.timer) clearInterval(shared.timer)
	let expected = Date.now() + TICK_MS
	snapshot()
	const timer = setInterval(() => {
		const now = Date.now()
		const late = now - expected
		expected = now + TICK_MS
		onTick(late, now)
	}, TICK_MS)
	shared.timer = timer
	return () => {
		clearInterval(timer)
		if (shared.timer === timer) shared.timer = undefined
	}
}

/** Times Discord's Flux dispatches, so their share of a stall can be told apart from plugin hooks. */
function wrapFlux(api: Api): (() => void) | undefined {
	try {
		const common = (api.discord as Api | undefined)?.common as Api | undefined
		const dispatcher = (common?.flux as Api | undefined)?.Dispatcher as
			| Api
			| undefined
		const original = dispatcher?.dispatch
		if (typeof original !== 'function') return undefined
		const fn = ((original as Fn & { [ORIGINAL]?: Fn })[ORIGINAL] ??
			original) as Fn
		const wrapper = function (this: unknown, ...args: unknown[]) {
			if (!state.active) return fn.apply(this, args)
			if (flux.depth++ === 0) flux.start = clock()
			try {
				return fn.apply(this, args)
			} finally {
				if (--flux.depth === 0) {
					flux.totalMs += clock() - flux.start
					flux.calls++
				}
			}
		}
		;(wrapper as Fn & { [ORIGINAL]?: Fn })[ORIGINAL] = fn
		return swap(dispatcher, 'dispatch', wrapper)
	} catch {
		return undefined
	}
}

/** What one timed call costs, measured on a call that does nothing; used to estimate the monitor's own cost. */
export function calibrate(rounds = 4000) {
	// A running recording would collect the calls of the test as if a plugin made them.
	if (isRecording()) return
	const entry: Stats = {
		id: SELF,
		calls: 0,
		ms: 0,
		max: 0,
		slow: 0,
		startup: 0,
		hooks: 0,
		sites: new Map(),
	}
	const site: Site = {
		label: 'calibration',
		calls: 0,
		ms: 0,
		max: 0,
		slow: 0,
		hist: new Float64Array(HIST_BUCKETS),
	}
	const empty = () => undefined
	const wrapped = timed(entry, site, empty)
	const every = state.sampleEvery
	state.sampleEvery = 1
	const start = clock()
	for (let i = 0; i < rounds; i++) wrapped()
	const bare = clock()
	for (let i = 0; i < rounds; i++) empty()
	const end = clock()
	state.sampleEvery = every
	overhead.perCallMs = Math.max(0, (bare - start - (end - bare)) / rounds)
	slowestMs = 0
}

/**
 * Estimated time the monitor itself used: every timed call costs about the measured amount, and an
 * "instead" hook costs it twice (it also wraps the original function), plus the checks of the thread
 * and the Flux dispatches it times. It does not include rendering the monitor's own page.
 */
export function monitorCostMs() {
	let wraps = 0
	for (const entry of stats.values())
		for (const site of entry.sites.values()) {
			const timedCalls = site.calls / Math.max(1, state.sampleEvery)
			wraps += site.label.startsWith('instead') ? timedCalls * 2 : timedCalls
		}
	return (wraps + flux.calls) * overhead.perCallMs + overhead.tickMs
}

/* ------------------------------- JS frame pacing ------------------------------- */

/**
 * One frame loop at a time, shared through the global object: when the plugin restarts, a loop of the
 * earlier run would otherwise keep counting beside the new one and multiply the numbers.
 */
function startFrameLoop() {
	const id = ++frames.loop
	frames.running = true
	let last = 0
	const step = (time: number) => {
		if (id !== frames.loop) return
		if (frames.users <= 0 || !state.active) {
			frames.running = false
			return
		}
		const now = time || clock()
		const gap = now - last
		// A long pause means the app was in the background, not slow.
		if (last && gap < 1000) {
			frames.total++
			if (gap > 25) frames.dropped += Math.max(1, Math.round(gap / 16.7) - 1)
			if (gap > frames.worstMs) frames.worstMs = gap
		}
		last = now
		requestAnimationFrame(step)
	}
	requestAnimationFrame(step)
}

/** Counts JS frames that came late, while at least one user (the settings page, a recording) wants it. */
export function countFrames() {
	frames.users++
	if (!frames.running && typeof requestAnimationFrame === 'function')
		startFrameLoop()
	let done = false
	return () => {
		if (done) return
		done = true
		frames.users = Math.max(0, frames.users - 1)
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

	const fluxUndo = wrapFlux(api)
	keep(fluxUndo)
	if (!fluxUndo) {
		// Discord's modules may not be loaded yet at the very start; try again a few times.
		let tries = 0
		let retry: ReturnType<typeof setTimeout> | undefined
		const again = () => {
			retry = undefined
			const undoFlux = wrapFlux(api)
			if (undoFlux) keep(undoFlux)
			else if (++tries < 10) retry = setTimeout(again, 2000)
		}
		retry = setTimeout(again, 2000)
		keep(() => retry && clearTimeout(retry))
	}
	calibrate()
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
			site.hist.fill(0)
		}
	}
	thread.stalls.length = 0
	thread.last = undefined
	thread.stalledMs = 0
	thread.stallCount = 0
	breakdown.count = 0
	breakdown.ms = 0
	breakdown.hookMs = 0
	breakdown.fluxMs = 0
	breakdown.otherMs = 0
	culprits.clear()
	flux.totalMs = 0
	flux.hookMs = 0
	flux.calls = 0
	overhead.tickMs = 0
	frames.total = 0
	frames.dropped = 0
	frames.worstMs = 0
	snapshot()
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

/* --------------------------- hooks seen from the function side --------------------------- */

const KINDS: [prefix: string, name: string][] = [
	['beforeJSX', 'JSX hooks'],
	['afterJSX', 'JSX hooks'],
	['insteadJSX', 'JSX hooks'],
	['before', 'Patches'],
	['after', 'Patches'],
	['instead', 'Patches'],
	['flux', 'Flux handlers'],
	['module found', 'Module callbacks'],
]

/** The kind of hook a site label starts with, for example "afterJSX Text" is a JSX hook. */
export function kindOf(label: string) {
	for (const [prefix, name] of KINDS)
		if (label === prefix || label.startsWith(`${prefix} `)) return name
	return 'Other'
}

export interface HookTotal {
	label: string
	ms: number
	calls: number
	max: number
	plugins: number
}

/** Time per hooked function or kind, all plugins together: shows where hooks pile up. */
function groupSites(key: (label: string) => string): HookTotal[] {
	const groups = new Map<string, HookTotal & { ids: Set<string> }>()
	for (const entry of stats.values())
		for (const site of entry.sites.values()) {
			if (site.calls <= 0) continue
			const name = key(site.label)
			let group = groups.get(name)
			if (!group) {
				group = {
					label: name,
					ms: 0,
					calls: 0,
					max: 0,
					plugins: 0,
					ids: new Set(),
				}
				groups.set(name, group)
			}
			group.ms += site.ms
			group.calls += site.calls
			if (site.max > group.max) group.max = site.max
			group.ids.add(entry.id)
		}
	return [...groups.values()]
		.map(({ ids, ...group }) => ({ ...group, plugins: ids.size }))
		.sort((a, b) => b.ms - a.ms)
}

export const hookedFunctions = () => groupSites(label => label)
export const hookKinds = () => groupSites(kindOf)

/** p95 and p99 of a plugin's call times, from the duration classes of all its hooks. */
export function callPercentiles(entry: Stats) {
	const hists = [...entry.sites.values()].map(site => site.hist)
	return {
		p95: percentile(hists, 0.95, entry.max),
		p99: percentile(hists, 0.99, entry.max),
	}
}

/** Heavy: single calls are slow. Frequent: cheap calls, but very many per second. */
export function siteNature(site: Site) {
	const seconds = elapsedMs() / 1000
	const heavy =
		site.max >= SLOW_MS || percentile([site.hist], 0.95, site.max) >= 4
	const perSecond = site.calls / Math.max(1, seconds)
	const frequent = perSecond >= 100
	if (heavy && frequent)
		return `heavy per call and called ${Math.round(perSecond)}/s`
	if (heavy) return 'heavy per call'
	if (frequent) return `cheap per call but called ${Math.round(perSecond)}/s`
	return undefined
}
