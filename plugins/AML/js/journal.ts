import { JournalLimit, MaxCacheSize } from './engine'
import { DefaultSettings } from './types'
import type { Data, Entry, Settings, Snapshot } from './types'

const Day = 24 * 60 * 60 * 1000
const SaveDelay = 2000

export type JournalState = { settings: Settings; entries: Entry[] }

type Storage = { set(data: Data, replace: true): Promise<unknown> }

/** Turns whatever was saved by an older version into valid settings. */
export function normalizeSettings(
	saved: Partial<Settings> | undefined,
): Settings {
	const settings = { ...DefaultSettings, ...saved }
	if (typeof settings.ignoredIds !== 'string') settings.ignoredIds = ''
	if (![0, 1, 7, 30].includes(settings.retentionDays))
		settings.retentionDays = 7
	if (settings.captureMode !== 'loaded') settings.captureMode = 'all'
	if (
		!Number.isInteger(settings.cacheLimit) ||
		settings.cacheLimit < 25 ||
		settings.cacheLimit > MaxCacheSize
	) {
		settings.cacheLimit = DefaultSettings.cacheLimit
	}
	if (!Array.isArray(settings.savedFilters)) settings.savedFilters = []
	if (!settings.ignoredTargets || typeof settings.ignoredTargets !== 'object')
		settings.ignoredTargets = {}
	return settings
}

/** Older entries stored the text after an edit as a plain string. */
function normalizeEntry(entry: Entry): Entry {
	const after = entry.after as Entry['after'] | string | undefined
	if (typeof after !== 'string') return entry
	return {
		...entry,
		after: {
			content: after,
			mentioned: false,
			mentions: [],
			roles: [],
			everyone: false,
			replyTo: '',
		},
	}
}

/** Settings and the journal of edits and deletions, saved to disk a moment after each change. */
export function createJournal(options: {
	storage: Storage
	snapshot(): Snapshot[]
	report(error: unknown): void
}) {
	const listeners = new Set<() => void>()
	let state: JournalState = { settings: DefaultSettings, entries: [] }
	let timer: ReturnType<typeof setTimeout> | undefined
	let writes: Promise<unknown> = Promise.resolve()

	const prune = (entries: Entry[], settings = state.settings) => {
		const cutoff = settings.retentionDays
			? Date.now() - settings.retentionDays * Day
			: 0
		return entries
			.filter(entry => entry?.before?.id && entry.at >= cutoff)
			.slice(0, JournalLimit)
	}
	const emit = () => {
		for (const listener of listeners) listener()
	}

	function flush() {
		if (timer !== undefined) {
			clearTimeout(timer)
			timer = undefined
		}
		const { settings, entries } = state
		const data: Data = {
			settings,
			entries: settings.persist ? prune(entries) : [],
			recent: settings.rememberReceived ? options.snapshot() : [],
		}
		writes = writes
			.then(() => options.storage.set(data, true))
			.catch(options.report)
		return writes
	}

	function schedule() {
		timer ??= setTimeout(() => void flush(), SaveDelay)
	}

	return {
		state: () => state,
		subscribe(listener: () => void) {
			listeners.add(listener)
			return () => void listeners.delete(listener)
		},
		load(data: Partial<Data> | undefined) {
			const settings = normalizeSettings(data?.settings)
			// Caches saved before "remember new messages" existed implied it.
			if (data?.settings?.rememberReceived === undefined && settings.persist)
				settings.rememberReceived = true
			const saved = Array.isArray(data?.entries)
				? data.entries.map(normalizeEntry)
				: []
			state = {
				settings,
				entries: settings.persist ? prune(saved, settings) : [],
			}
			emit()
			return Array.isArray(data?.recent) ? data.recent : []
		},
		update(patch: Partial<Settings>) {
			const before = state.settings
			const settings = { ...before, ...patch }
			state = { settings, entries: prune(state.entries, settings) }
			emit()
			if (
				(before.persist && !settings.persist) ||
				(before.rememberReceived && !settings.rememberReceived)
			)
				void flush()
			else schedule()
		},
		record(entry: Entry) {
			state = { ...state, entries: prune([entry, ...state.entries]) }
			emit()
			schedule()
		},
		remove(entries: readonly Entry[]) {
			if (!entries.length) return
			const selected = new Set(entries)
			state = {
				...state,
				entries: state.entries.filter(entry => !selected.has(entry)),
			}
			emit()
			void flush()
		},
		/** The cache changed; save it if it is being remembered. */
		touched() {
			if (state.settings.persist || state.settings.rememberReceived) schedule()
		},
		flush,
		reset() {
			state = { settings: state.settings, entries: [] }
			emit()
		},
	}
}

export type Journal = ReturnType<typeof createJournal>
