/** A timed recording of plugin activity, kept apart from the running totals so Reset does not touch it. */

export interface RecSite {
	label: string
	calls: number
	ms: number
	max: number
	slow: number
}

export interface RecPlugin {
	id: string
	calls: number
	ms: number
	max: number
	slow: number
	sites: Map<string, RecSite>
	/** Hook time per BUCKET_MS of the recording, to tell steady load from bursts. */
	buckets: number[]
}

export type RecordingStatus = 'idle' | 'recording' | 'finished'

export const BUCKET_MS = 10_000
/** Longest recording; keeps the buckets and the request small. */
export const MAX_RECORDING_MS = 30 * 60_000

const KEY = Symbol.for('dariuss.performance-monitor.recording')

interface Shared {
	status: RecordingStatus
	startedAt: number
	endedAt: number
	targetMs: number
	pausedMs: number
	plugins: Map<string, RecPlugin>
	stalls: { count: number; ms: number; max: number }
	/** Active hook counts when the recording began and ended. */
	hooks: Record<string, number>
	timer: ReturnType<typeof setTimeout> | undefined
}

const holder = globalThis as { [KEY]?: Shared }
const shared: Shared = (holder[KEY] ??= {
	status: 'idle',
	startedAt: 0,
	endedAt: 0,
	targetMs: 0,
	pausedMs: 0,
	plugins: new Map(),
	stalls: { count: 0, ms: 0, max: 0 },
	hooks: {},
	timer: undefined,
})

export const recording = shared

export const isRecording = () => shared.status === 'recording'

/** Recorded time without the stretches the app spent suspended in the background. */
export function recordedMs() {
	const end = shared.status === 'recording' ? Date.now() : shared.endedAt
	return Math.max(0, end - shared.startedAt - shared.pausedMs)
}

export function startRecording(targetMs: number) {
	stopRecording(false)
	shared.status = 'recording'
	shared.startedAt = Date.now()
	shared.endedAt = 0
	shared.pausedMs = 0
	shared.targetMs = Math.min(targetMs, MAX_RECORDING_MS)
	shared.plugins = new Map()
	shared.stalls = { count: 0, ms: 0, max: 0 }
	shared.hooks = {}
	shared.timer = setTimeout(() => stopRecording(), shared.targetMs + 2000)
}

/** Ends the recording. `keep` false drops it, used when a new one starts or the plugin stops. */
export function stopRecording(keep = true) {
	if (shared.timer) clearTimeout(shared.timer)
	shared.timer = undefined
	if (shared.status !== 'recording') return
	shared.endedAt = Date.now()
	shared.status = keep ? 'finished' : 'idle'
}

/** Called when the timer is late or the app was suspended; the gap does not count as recorded time. */
export function pauseRecording(ms: number) {
	if (shared.status === 'recording') shared.pausedMs += ms
}

/** Stops by itself once the chosen period has passed; the page also checks this on every refresh. */
export function checkRecording() {
	if (shared.status === 'recording' && recordedMs() >= shared.targetMs)
		stopRecording()
}

export function record(id: string, label: string, ms: number, slow: boolean) {
	let plugin = shared.plugins.get(id)
	if (!plugin) {
		plugin = {
			id,
			calls: 0,
			ms: 0,
			max: 0,
			slow: 0,
			sites: new Map(),
			buckets: [],
		}
		shared.plugins.set(id, plugin)
	}
	plugin.calls++
	plugin.ms += ms
	if (ms > plugin.max) plugin.max = ms
	if (slow) plugin.slow++
	const bucket = Math.floor(recordedMs() / BUCKET_MS)
	plugin.buckets[bucket] = (plugin.buckets[bucket] ?? 0) + ms
	let site = plugin.sites.get(label)
	if (!site) {
		site = { label, calls: 0, ms: 0, max: 0, slow: 0 }
		plugin.sites.set(label, site)
	}
	site.calls++
	site.ms += ms
	if (ms > site.max) site.max = ms
	if (slow) site.slow++
}

export function recordStall(ms: number) {
	if (shared.status !== 'recording') return
	shared.stalls.count++
	shared.stalls.ms += ms
	if (ms > shared.stalls.max) shared.stalls.max = ms
}
