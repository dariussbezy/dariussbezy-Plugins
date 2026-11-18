import { Platform } from 'react-native'
import manifest from '../manifest.json'
import {
	displayName,
	formatMs,
	frames,
	monitorCostMs,
	names,
	SLOW_MS,
	state,
	stats,
	UNKNOWN,
} from './monitor'
import { BUCKET_MS, recordedMs, recording } from './recording'

/** A measured run saved to compare with another one. */
export interface SavedRun {
	id: string
	at: number
	activity: string
	seconds: number
	/** Plugins other than this one that had hooks: 0 makes it a baseline. */
	otherPlugins: number
	lightMode: boolean
	stalls: { count: number; ms: number; max: number }
	/** Hook time as a share of the measured time, in percent. */
	hookPercent: number
	/** How stalled time splits, in percent: plugin hooks, Discord's Flux, the rest. */
	split: { hooks: number; flux: number; other: number }
	framesLate?: { dropped: number; total: number }
	top: { id: string; name: string; percent: number }[]
}

export interface AiSettings {
	groqKey: string
	model: string
	/** Time only one call in ten, which lowers the monitor's own cost; totals become estimates. */
	lightMode: boolean
	activity: string
	runs: SavedRun[]
}

export const DefaultAiSettings: AiSettings = {
	groqKey: '',
	model: 'openai/gpt-oss-120b',
	lightMode: false,
	activity: 'other',
	runs: [],
}

/** Models offered before the list is loaded from the user's account; any model id can be typed. */
export const SuggestedModels: [id: string, note: string][] = [
	['openai/gpt-oss-120b', 'Strongest reasoning, recommended'],
	['openai/gpt-oss-20b', 'Faster and lighter'],
	['qwen/qwen3.8-27b', 'Strong multilingual model'],
]

/** Models Groq has retired or is retiring: a saved one is replaced by the default. */
const RETIRED_MODELS = [
	'llama-3.3-70b-versatile',
	'llama-3.1-8b-instant',
	'qwen/qwen3.6-27b',
	'moonshotai/kimi-k2-instruct',
]

/** The model to use for a saved choice. */
export const currentModel = (saved: string | undefined) => {
	const model = saved?.trim() ?? ''
	return !model || RETIRED_MODELS.includes(model)
		? DefaultAiSettings.model
		: model
}

const ENDPOINT = 'https://api.groq.com/openai/v1'
const TIMEOUT_MS = 90_000
/** Plugins sent in detail; the rest are summed up, which keeps the request small. */
const PLUGIN_LIMIT = 25
const SITE_LIMIT = 8

export const KEY_URL = 'console.groq.com'

export class AiError extends Error {}

export interface Advice {
	id: string
	name: string
	/** Why it is listed. */
	reason: string
	/** For plugins to report: the text to send to the developer. */
	report?: string
}

export interface Review {
	summary: string
	verdict: 'good' | 'fair' | 'poor'
	disable: Advice[]
	report: Advice[]
	fine: Advice[]
	notes: string[]
	model: string
	at: number
}

const round = (value: number, digits = 2) => {
	const factor = 10 ** digits
	return Math.round(value * factor) / factor
}

/** Only numbers, plugin ids and names, and hook labels such as "flux MESSAGE_CREATE": nothing the user wrote. */
export function buildPayload() {
	const minutes = Math.max(recordedMs(), 1000) / 60_000
	const totalMs = recordedMs()
	const plugins = [...recording.plugins.values()]
		.filter(plugin => plugin.id !== UNKNOWN || plugin.ms > 0)
		.sort((a, b) => b.ms - a.ms)
	const detailed = plugins.slice(0, PLUGIN_LIMIT)
	const rest = plugins.slice(PLUGIN_LIMIT)
	// The same hooked function (for example "afterJSX Text") summed over all plugins that hook it.
	const byFunction = new Map<
		string,
		{ ms: number; calls: number; ids: Set<string> }
	>()
	for (const plugin of plugins)
		for (const site of plugin.sites.values()) {
			const group = byFunction.get(site.label) ?? {
				ms: 0,
				calls: 0,
				ids: new Set<string>(),
			}
			group.ms += site.ms
			group.calls += site.calls
			group.ids.add(plugin.id)
			byFunction.set(site.label, group)
		}
	const split = recording.breakdown
	const percentOf = (value: number) =>
		split.ms > 0 ? round((value / split.ms) * 100, 1) : 0
	return {
		tool: `${manifest.name} ${manifest.version}`,
		platform: Platform.OS,
		recordedSeconds: Math.round(totalMs / 1000),
		slowCallThresholdMs: SLOW_MS,
		jsThreadStalls: {
			over100ms: recording.stalls.count,
			totalMs: Math.round(recording.stalls.ms),
			longestMs: Math.round(recording.stalls.max),
		},
		stallAnalysis: split.count
			? {
					stalls: split.count,
					splitPercentOfStalledTime: {
						pluginHooks: percentOf(split.hookMs),
						discordFluxHandling: percentOf(split.fluxMs),
						notMeasured: percentOf(split.otherMs),
					},
					pluginsThatLedStalls: [...recording.culprits.entries()]
						.sort((a, b) => b[1].stalls - a[1].stalls || b[1].ms - a[1].ms)
						.slice(0, 8)
						.map(([id, item]) => ({
							id,
							name: names.get(id) ?? displayName(id),
							stallsLed: item.stalls,
							hookMsInsideStalls: Math.round(item.ms),
						})),
				}
			: undefined,
		hookedFunctionsAllPlugins: [...byFunction.entries()]
			.sort((a, b) => b[1].ms - a[1].ms)
			.slice(0, 8)
			.map(([hook, item]) => ({
				hook,
				ms: round(item.ms),
				calls: item.calls,
				plugins: item.ids.size,
			})),
		monitor: {
			estimatedOwnCostMs: Math.round(monitorCostMs()),
			timedCallsShare: state.sampleEvery > 1 ? 1 / state.sampleEvery : 1,
		},
		jsFramesLate: frames.total
			? { late: frames.dropped, of: frames.total }
			: undefined,
		plugins: detailed.map(plugin => {
			const buckets = Array.from(
				{ length: Math.max(1, Math.ceil(totalMs / BUCKET_MS)) },
				(_, index) => plugin.buckets[index] ?? 0,
			)
			const info = stats.get(plugin.id)
			return {
				id: plugin.id,
				name: names.get(plugin.id) ?? displayName(plugin.id),
				hookMs: round(plugin.ms),
				shareOfRecordedTimePercent: round(
					(plugin.ms / Math.max(1, totalMs)) * 100,
					3,
				),
				calls: plugin.calls,
				callsPerMinute: Math.round(plugin.calls / minutes),
				avgCallMs: round(plugin.ms / Math.max(1, plugin.calls), 3),
				longestCallMs: round(plugin.max),
				slowCalls: plugin.slow,
				activeHooks: info?.hooks ?? 0,
				startupMs: info?.startup ? round(info.startup) : undefined,
				busiestTenSecondsMs: round(Math.max(...buckets)),
				topHooks: [...plugin.sites.values()]
					.sort((a, b) => b.ms - a.ms)
					.slice(0, SITE_LIMIT)
					.map(site => ({
						hook: site.label,
						ms: round(site.ms),
						calls: site.calls,
						longestMs: round(site.max),
						slowCalls: site.slow,
					})),
			}
		}),
		otherPlugins: rest.length
			? {
					count: rest.length,
					hookMs: round(rest.reduce((sum, plugin) => sum + plugin.ms, 0)),
				}
			: undefined,
	}
}

const SYSTEM = `You analyse performance measurements of plugins in a mobile Discord client mod (Valenced, React Native). Each plugin runs hooks (patches, JSX hooks, Flux handlers, module callbacks) on the single JavaScript thread. "hookMs" is the plugin's own time in those hooks; a call over slowCallThresholdMs drops a frame. The numbers come from one recording and only cover JS thread time, not rendering or network.

"stallAnalysis" splits the time the JS thread was stalled (over 100 ms) into plugin hooks, Discord's own Flux handling and "notMeasured" (React rendering, timers, native events, garbage collection: not visible here); "pluginsThatLedStalls" names plugins whose hooks took at least a quarter of a stall. If most of the stalled time is "notMeasured", plugins are probably not the main cause. "hookedFunctionsAllPlugins" shows functions hooked by several plugins at once, where their costs pile up. "monitor.estimatedOwnCostMs" is the measuring tool's own cost; subtract it from any suspicion. Totals may be estimates when timedCallsShare is below 1.

Judge only from the data given. Rules:
- A plugin using under 0.3% of the recorded time with no slow calls is fine; do not invent problems.
- Recommend "disable" only for plugins whose cost is high (roughly over 2% of the time, or many slow calls) and mention that disabling is a trade-off against its features.
- Put a plugin in "report" when a developer could realistically optimise it: slow calls, a hook with a very high call count or time, or work that runs on every render or Flux event. Write "reportText" as a complete message in English addressed to the plugin developer: what was measured, for how long, the exact numbers and hook names, why it matters, and a concrete suggestion (debounce, cache, move work out of the hook, narrow the filter). It must be ready to paste into an issue.
- A plugin may be in both "disable" and "report".
- Everything else worth a mention goes in "fine" with a short note; keep it to the most relevant plugins.
- Use the exact plugin ids and names from the data. Never invent plugins.
- Be concrete and brief. No filler.

Answer with ONLY one JSON object, no markdown, in this shape:
{"summary": string, "verdict": "good"|"fair"|"poor", "disable": [{"id": string, "name": string, "reason": string}], "report": [{"id": string, "name": string, "reason": string, "reportText": string}], "fine": [{"id": string, "name": string, "reason": string}], "notes": [string]}`

function readError(status: number, body: string): string {
	let detail = ''
	try {
		const parsed = JSON.parse(body) as { error?: { message?: string } }
		detail = parsed.error?.message ?? ''
	} catch {
		// Not JSON; the status says enough.
	}
	const extra = detail ? ` (${detail.slice(0, 200)})` : ''
	if (status === 401)
		return `Groq rejected the API key${extra}. Check that you pasted the whole key and that it was not deleted.`
	if (status === 403)
		return `Groq blocked this connection${extra}. The key is probably fine: this usually means your network or region is blocked. Turn off any VPN or private DNS, try mobile data instead of Wi-Fi (or the other way round), and try again.`
	if (status === 429)
		return `Groq rate limit reached${extra}. The free plan allows only a few requests and tokens per minute; wait a minute and try again, or pick a smaller model.`
	if (status === 404 || status === 400)
		return `Groq did not accept the request${extra}. The model may no longer exist: load the model list in the setup and pick another one.`
	if (status === 413)
		return `The recording is too large for this model${extra}. Record a shorter period or pick another model.`
	if (status >= 500)
		return `Groq had a problem on its side (${status}). Try again in a moment.`
	return `Groq returned error ${status}${extra}.`
}

async function request(
	key: string,
	path: string,
	init: { method?: string; body?: string },
): Promise<string> {
	if (!key.trim())
		throw new AiError('Add your Groq API key first (see "Groq setup").')
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
	try {
		const response = await fetch(`${ENDPOINT}${path}`, {
			method: init.method ?? 'GET',
			headers: {
				Authorization: `Bearer ${key.trim()}`,
				'Content-Type': 'application/json',
			},
			body: init.body,
			signal: controller.signal,
		})
		const text = await response.text()
		if (!response.ok) throw new AiError(readError(response.status, text))
		return text
	} catch (error) {
		if (error instanceof AiError) throw error
		if (controller.signal.aborted)
			throw new AiError('Groq took too long to answer. Try again.')
		throw new AiError(
			'Could not reach Groq. Check your internet connection and try again.',
		)
	} finally {
		clearTimeout(timer)
	}
}

const NOT_CHAT = /whisper|tts|guard|playai|orpheus|embed|safeguard|distil/i

/** Chat models the key can use; also proves the key works. */
export async function listModels(key: string): Promise<string[]> {
	const text = await request(key, '/models', {})
	try {
		const data = (JSON.parse(text) as { data?: { id?: unknown }[] }).data ?? []
		return data
			.map(model => model.id)
			.filter(
				(id): id is string => typeof id === 'string' && !NOT_CHAT.test(id),
			)
			.sort()
	} catch {
		throw new AiError('Groq sent an answer that could not be read.')
	}
}

const str = (value: unknown, max = 4000) =>
	typeof value === 'string' ? value.trim().slice(0, max) : ''

function readAdvice(value: unknown, known: Set<string>, withReport: boolean) {
	if (!Array.isArray(value)) return []
	const list: Advice[] = []
	for (const item of value) {
		if (!item || typeof item !== 'object') continue
		const record = item as Record<string, unknown>
		const id = str(record.id, 200)
		// Only plugins that were really measured count; the model must not invent any.
		if (!known.has(id)) continue
		const advice: Advice = {
			id,
			name: names.get(id) ?? (str(record.name, 100) || displayName(id)),
			reason: str(record.reason, 1200),
		}
		if (withReport) advice.report = str(record.reportText, 4000) || undefined
		list.push(advice)
	}
	return list
}

function parseReview(text: string, model: string): Review {
	// Models sometimes wrap the object in prose or a code fence.
	const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '')
	const start = cleaned.indexOf('{')
	const end = cleaned.lastIndexOf('}')
	if (start < 0 || end <= start)
		throw new AiError(
			'The model did not answer in the expected format. Try again or pick another model.',
		)
	let data: Record<string, unknown>
	try {
		data = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
	} catch {
		throw new AiError(
			'The answer was cut off or malformed. Try again or pick another model.',
		)
	}
	const known = new Set(recording.plugins.keys())
	const verdict = data.verdict
	return {
		summary: str(data.summary, 1500),
		verdict: verdict === 'good' || verdict === 'poor' ? verdict : 'fair',
		disable: readAdvice(data.disable, known, false),
		report: readAdvice(data.report, known, true),
		fine: readAdvice(data.fine, known, false),
		notes: Array.isArray(data.notes)
			? data.notes
					.map(note => str(note, 400))
					.filter(Boolean)
					.slice(0, 6)
			: [],
		model,
		at: Date.now(),
	}
}

export async function analyse(settings: AiSettings): Promise<Review> {
	if (recording.plugins.size === 0)
		throw new AiError(
			'Nothing was recorded. Use Discord during the recording so plugins have something to measure.',
		)
	const model = currentModel(settings.model)
	const text = await request(settings.groqKey, '/chat/completions', {
		method: 'POST',
		body: JSON.stringify({
			model,
			temperature: 0.2,
			max_tokens: 8000,
			messages: [
				{ role: 'system', content: SYSTEM },
				{ role: 'user', content: JSON.stringify(buildPayload()) },
			],
		}),
	})
	let content: unknown
	try {
		content = (
			JSON.parse(text) as { choices?: { message?: { content?: unknown } }[] }
		).choices?.[0]?.message?.content
	} catch {
		// Handled below.
	}
	if (typeof content !== 'string' || !content.trim())
		throw new AiError('Groq sent an empty answer. Try again.')
	return parseReview(content, model)
}

/** The whole review as plain text, for copying. */
export function reviewText(review: Review): string {
	const lines = [
		`${manifest.name} ${manifest.version} · AI review (${review.model})`,
		`Recorded for ${formatMs(recordedMs())}`,
		'',
		`Verdict: ${review.verdict}`,
		review.summary,
	]
	const section = (title: string, list: Advice[], withReport = false) => {
		if (!list.length) return
		lines.push('', title)
		for (const item of list) {
			lines.push(`- ${item.name} (${item.id}): ${item.reason}`)
			if (withReport && item.report) lines.push('', item.report, '')
		}
	}
	section('Consider disabling', review.disable)
	section('Report to the developer', review.report, true)
	section('Looks fine', review.fine)
	if (review.notes.length)
		lines.push('', 'Notes', ...review.notes.map(n => `- ${n}`))
	return lines.join('\n')
}
