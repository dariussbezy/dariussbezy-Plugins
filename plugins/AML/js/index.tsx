import { onAnyFluxEventDispatched } from '@valenced/discord/flux'
import {
	configureAlerts,
	confirm,
	dismissAll,
	jump,
	notify,
	showDetails,
	showDiff,
} from './alerts'
import {
	describeTarget,
	getChannel,
	getCurrentUserId,
	getMessage,
	isLoaded,
} from './discord'
import { createEngine } from './engine'
import { ColorRows, HistoryView, Swatch } from './history'
import { createInline, isSynthetic } from './inline'
import { createJournal } from './journal'
import { installMenus } from './menus'
import SettingsComponent, { setController } from './settings'
import { DefaultSettings } from './types'
import type { FluxMessageEvent } from './engine'
import type {
	AmlApi,
	Data,
	Entry,
	IgnoreScope,
	InlineProvider,
	Settings,
} from './types'

/** Settings that change how rows are drawn in chat. */
const InlineKeys: (keyof Settings)[] = [
	'retainDeleted',
	'showInlineEdits',
	'colorDeletedUsername',
	'deletedMessageColor',
	'editedMessageColor',
	'deletedNameColor',
	'showDeletedTime',
	'showEditTime',
	'showSeconds',
	'use12HourClock',
	'retentionDays',
]

/** What dependents receive. It forwards to the running instance, so it can be handed out in init. */
let live: AmlApi | undefined
const bridge: AmlApi = {
	getEntries: () => live?.getEntries() ?? [],
	subscribe: listener => live?.subscribe(listener) ?? (() => {}),
	onEntry: listener => live?.onEntry(listener) ?? (() => {}),
	remove: entries => live?.remove(entries),
	jump: entry => live?.jump(entry),
	showDetails: (entry, related) => live?.showDetails(entry, related),
	notify: (title, entry, content) => live?.notify(title, entry, content),
	addInlineProvider: provider =>
		live?.addInlineProvider(provider) ?? (() => {}),
	refreshInline: () => live?.refreshInline(),
	components: { HistoryView, ColorRows, Swatch },
}

export default plugin<{ jsonStorage: Data }>({
	// Plugins that depend on this one receive the API as `api.aml`. Decorators must be
	// registered before those plugins initialize, so this cannot wait for start.
	init({ decorate }) {
		decorate(dependent => {
			const target = dependent.api as { aml?: AmlApi }
			target.aml = bridge
			return () => {
				target.aml = undefined
			}
		})
	},
	jsonStorage: {
		load: true,
		default: { settings: DefaultSettings, entries: [], recent: [] },
	},
	async start({ jsonStorage, cleanup, plugin: instance }) {
		const report = (error: unknown) => instance.reportError(error)
		const providers = new Set<InlineProvider>()
		const entryListeners = new Set<(entry: Entry) => void>()
		let received = 0

		const journal = createJournal({
			storage: jsonStorage,
			snapshot: () => engine.snapshot(),
			report,
		})
		const settings = () => journal.state().settings
		configureAlerts(entries => journal.remove(entries))

		const engine = createEngine({
			settings,
			currentUserId: getCurrentUserId,
			channel: getChannel,
			stored: getMessage,
			loaded: isLoaded,
			record(entry) {
				journal.record(entry)
				for (const listener of entryListeners) {
					try {
						listener(entry)
					} catch (error) {
						report(error)
					}
				}
			},
		})

		const inline = createInline({
			settings,
			entries: () => journal.state().entries,
			providers,
			report,
		})

		// Ignoring: an id list in the settings, plus a name for each so the list stays readable.
		const ignoredIds = () => [
			...new Set(
				settings()
					.ignoredIds.split(/[\s,]+/)
					.filter(Boolean),
			),
		]
		function toggleIgnored(id: string, scope?: IgnoreScope) {
			const ids = ignoredIds()
			const ignoredTargets = { ...settings().ignoredTargets }
			if (ids.includes(id)) {
				delete ignoredTargets[id]
			} else {
				const target = describeTarget(id, scope)
				if (target.scope)
					ignoredTargets[id] = { scope: target.scope, name: target.name ?? id }
			}
			journal.update({
				ignoredIds: (ids.includes(id)
					? ids.filter(other => other !== id)
					: [...ids, id]
				).join(', '),
				ignoredTargets,
			})
		}
		const nameFor = (id: string) =>
			describeTarget(id).name ?? settings().ignoredTargets[id]?.name

		const api: AmlApi = {
			getEntries: () => journal.state().entries,
			subscribe: journal.subscribe,
			onEntry(listener) {
				entryListeners.add(listener)
				return () => void entryListeners.delete(listener)
			},
			remove: entries => journal.remove(entries),
			jump,
			showDetails,
			notify,
			addInlineProvider(provider) {
				providers.add(provider)
				inline.refresh()
				return () => {
					providers.delete(provider)
					inline.refresh()
				}
			},
			refreshInline: inline.refresh,
			components: {
				HistoryView,
				ColorRows,
				Swatch,
			},
		}

		const restored = journal.load(await jsonStorage.get())
		if (settings().rememberReceived) engine.restore(restored)

		// Registered first, so it runs last: save, then drop everything held in memory.
		cleanup(async () => {
			try {
				await journal.flush()
			} finally {
				engine.clear()
				journal.reset()
				dismissAll()
				setController(undefined)
			}
		})

		// One listener sees every dispatch, so capture always runs before the inline handler
		// can turn a MESSAGE_DELETE into a redraw.
		const handlers: Record<
			string,
			(payload: FluxMessageEvent) => FluxMessageEvent | undefined
		> = {
			MESSAGE_CREATE: payload => payload,
			MESSAGE_UPDATE: payload => payload,
			MESSAGE_DELETE: inline.onDelete,
			MESSAGE_DELETE_BULK: inline.onDeleteBulk,
		}
		cleanup(
			onAnyFluxEventDispatched(payload => {
				const handle = handlers[payload.type]
				if (!handle || isSynthetic(payload)) return payload
				const event = payload as unknown as FluxMessageEvent
				if (event.type === 'MESSAGE_CREATE') received++
				try {
					if (engine.observe(event)) journal.touched()
				} catch (error) {
					report(error)
				}
				return handle(event) as typeof payload | undefined
			}),
		)

		inline.start()
		cleanup(inline.stop)

		let previous = journal.state()
		cleanup(
			journal.subscribe(() => {
				const current = journal.state()
				const restyled = InlineKeys.some(
					key => current.settings[key] !== previous.settings[key],
				)
				if (restyled || current.entries.length < previous.entries.length)
					inline.refresh()
				previous = current
			}),
		)

		cleanup(
			installMenus({
				subscribe: journal.subscribe,
				version: journal.state,
				nameFor,
				isIgnored: id => ignoredIds().includes(id),
				toggleIgnored,
				entriesFor: (channelId, messageId) =>
					journal
						.state()
						.entries.filter(
							entry =>
								entry.before.channelId === channelId &&
								entry.before.id === messageId,
						),
				inspect: entries => showDetails(entries[0], entries),
				compare: entries => showDiff(entries),
				remove: entries => journal.remove(entries),
				report,
			}),
		)

		setController({
			journal,
			HistoryView: api.components.HistoryView,
			ignored: () =>
				ignoredIds().map(id => {
					const target = describeTarget(
						id,
						settings().ignoredTargets[id]?.scope,
					)
					return {
						id,
						scope: target.scope,
						name: target.name ?? settings().ignoredTargets[id]?.name ?? id,
					}
				}),
			toggleIgnored: id => toggleIgnored(id),
			capture: () =>
				`${received} new messages received this session · ${engine.size()} cached messages.`,
			clearHistory: () => journal.remove(journal.state().entries),
			clearCache() {
				engine.clear()
				void journal.flush()
			},
			confirm: confirm,
			notify: (title, content) => notify(title, undefined, content),
		})
		live = api
		cleanup(() => {
			live = undefined
		})
	},
	SettingsComponent,
})
