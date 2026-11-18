import {
	breakdown,
	displayName,
	elapsedMs,
	formatMs,
	frames,
	state,
	stats,
	thread,
	UNKNOWN,
} from './monitor'
import type { SavedRun } from './ai'

export const ACTIVITIES: [id: string, label: string][] = [
	['idle', 'Idle'],
	['scrolling', 'Scrolling a chat'],
	['swiping', 'Swiping between screens'],
	['typing', 'Typing'],
	['other', 'Other'],
]

export const activityName = (id: string) =>
	ACTIVITIES.find(([key]) => key === id)?.[1] ?? 'Other'

export const MAX_RUNS = 12
const TOP_PLUGINS = 6

const round = (value: number, digits = 1) => {
	const factor = 10 ** digits
	return Math.round(value * factor) / factor
}

/** A snapshot of the numbers counted since the last reset, to be compared with another run later. */
export function createRun(activity: string): SavedRun {
	const elapsed = elapsedMs()
	const list = [...stats.values()]
		.filter(entry => entry.calls > 0)
		.sort((a, b) => b.ms - a.ms)
	const hookMs = list.reduce((sum, entry) => sum + entry.ms, 0)
	const total = Math.max(1, breakdown.ms)
	return {
		id: String(Date.now()),
		at: Date.now(),
		activity,
		seconds: Math.round(elapsed / 1000),
		otherPlugins: list.filter(entry => entry.id !== UNKNOWN && entry.hooks > 0)
			.length,
		lightMode: state.sampleEvery > 1,
		stalls: {
			count: breakdown.count,
			ms: Math.round(breakdown.ms),
			max: Math.round(thread.stalls[0]?.ms ?? 0),
		},
		hookPercent: round((hookMs / elapsed) * 100, 2),
		split: breakdown.ms
			? {
					hooks: round((breakdown.hookMs / total) * 100),
					flux: round((breakdown.fluxMs / total) * 100),
					other: round((breakdown.otherMs / total) * 100),
				}
			: { hooks: 0, flux: 0, other: 0 },
		framesLate: frames.total
			? { dropped: frames.dropped, total: frames.total }
			: undefined,
		top: list.slice(0, TOP_PLUGINS).map(entry => ({
			id: entry.id,
			name: displayName(entry.id),
			percent: round((entry.ms / elapsed) * 100, 2),
		})),
	}
}

const perMinute = (value: number, run: SavedRun) =>
	value / Math.max(1 / 60, run.seconds / 60)

const arrow = (from: number, to: number, unit = '', digits = 1) => {
	const delta = to - from
	const sign = delta > 0 ? '+' : ''
	return `${round(from, digits)}${unit} → ${round(to, digits)}${unit} (${sign}${round(delta, digits)}${unit})`
}

const clock = (at: number) => {
	const date = new Date(at)
	const pad = (value: number) => String(value).padStart(2, '0')
	return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** One line to name a run: when, what was being done and which plugins were on. */
export function describeRun(run: SavedRun) {
	const parts = [
		clock(run.at),
		activityName(run.activity),
		run.otherPlugins === 0
			? 'baseline, no other plugins'
			: `${run.otherPlugins} plugins`,
		`${run.seconds} s`,
	]
	if (run.lightMode) parts.push('light mode')
	return parts.join(' · ')
}

/** What changed from run `a` to run `b`, as lines of text. */
export function compareRuns(a: SavedRun, b: SavedRun) {
	const lines = [`A: ${describeRun(a)}`, `B: ${describeRun(b)}`, '']
	lines.push(
		`Stalls per minute: ${arrow(perMinute(a.stalls.count, a), perMinute(b.stalls.count, b))}`,
		`Time stalled per minute: ${formatMs(perMinute(a.stalls.ms, a))} → ${formatMs(perMinute(b.stalls.ms, b))}`,
		`Plugin hook time: ${arrow(a.hookPercent, b.hookPercent, '%', 2)}`,
	)
	if (a.stalls.count || b.stalls.count)
		lines.push(
			`Share of stalled time in plugin hooks: ${arrow(a.split.hooks, b.split.hooks, '%')}`,
			`Share in Discord's Flux handling: ${arrow(a.split.flux, b.split.flux, '%')}`,
			`Share not measured (React, timers, GC): ${arrow(a.split.other, b.split.other, '%')}`,
		)
	if (a.framesLate && b.framesLate)
		lines.push(
			`JS frames late: ${arrow((a.framesLate.dropped / a.framesLate.total) * 100, (b.framesLate.dropped / b.framesLate.total) * 100, '%')}`,
		)
	const ids = new Map<string, string>()
	const share = (run: SavedRun, id: string) =>
		run.top.find(item => item.id === id)?.percent ?? 0
	for (const item of [...a.top, ...b.top]) ids.set(item.id, item.name)
	const changes = [...ids.entries()]
		.map(([id, name]) => ({
			name,
			from: share(a, id),
			to: share(b, id),
		}))
		.filter(change => Math.abs(change.to - change.from) >= 0.05)
		.sort((x, y) => Math.abs(y.to - y.from) - Math.abs(x.to - x.from))
		.slice(0, 5)
	if (changes.length) {
		lines.push('', 'Biggest changes in hook time per plugin:')
		for (const change of changes)
			lines.push(`  ${change.name}: ${arrow(change.from, change.to, '%', 2)}`)
	}
	const notes: string[] = []
	if (a.activity !== b.activity)
		notes.push('The activities differ, so the runs may not be comparable.')
	if (a.seconds < 60 || b.seconds < 60)
		notes.push('A run under a minute is too short to trust.')
	if (a.lightMode !== b.lightMode)
		notes.push('One run used light mode, so its totals are estimates.')
	if (a.otherPlugins === 0 && b.otherPlugins > 0)
		notes.push('A is a baseline: the difference is what the other plugins add.')
	if (notes.length) lines.push('', ...notes)
	return lines
}
