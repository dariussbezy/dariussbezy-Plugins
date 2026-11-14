import { Dispatcher } from '@valenced/discord/common/flux'
import { onFluxEventDispatched } from '@valenced/discord/flux'
import { getModules } from '@valenced/modules/finders'
import { withName } from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { Platform, processColor } from 'react-native'
import { getMessage } from './discord'
import { isFormatted, parseMarkdown, plainText } from './markdown'
import type { Entry, InlineProvider, Settings } from './types'

/** Marks the events AML dispatches itself, so capture ignores them. */
const SyntheticFlag = '__amlSynthetic'
export const isSynthetic = (event: object) =>
	(event as Record<string, unknown>)[SyntheticFlag] === true

type Location = { channelId: string; id: string; guildId?: string }
type Content = { type?: string; content?: unknown }
type Row = {
	type?: number
	rowType?: number
	changeType?: number
	message?: {
		id?: string
		content?: Content[]
		textColor?: number
		timestampColor?: number
		colorString?: number
		usernameColor?: number
		editedColor?: number
		edited?: string
	}
	backgroundHighlight?: { backgroundColor: number; gutterColor: number }
}
type GenerateArgs = {
	rowType?: number
	message?: {
		id?: string
		channel_id?: string
		merge?: (value: unknown) => unknown
	}
}
type RowGenerator = { generate(args: GenerateArgs): Row | undefined }
type LoadedMessages = {
	channelId?: string
	messages: { id: string }[]
	hasMoreBefore?: boolean
	hasMoreAfter?: boolean
}
type DeleteEvent = {
	id?: string
	ids?: string[]
	channelId?: string
	guildId?: string
}

export type InlineHost = {
	settings(): Settings
	entries(): readonly Entry[]
	providers: ReadonlySet<InlineProvider>
	report(error: unknown): void
}

const Red = '#ed4245'
const Grey = '#939aa8'
const keyOf = (id: string, channelId: string) => `${channelId}:${id}`
const isSnowflake = (id: string) => /^\d+$/.test(id)
const colorOr = (value: string | undefined, fallback: string) =>
	value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
// 12-hour times contain a narrow no-break space before AM/PM that renders as a wide gap.
const clock = (at: number, settings: Settings) =>
	new Date(at)
		.toLocaleTimeString(undefined, {
			hour: settings.use12HourClock ? 'numeric' : '2-digit',
			minute: '2-digit',
			...(settings.showSeconds ? { second: '2-digit' as const } : {}),
			hour12: settings.use12HourClock,
		})
		.replace(/[  ]/g, ' ')

function nativeColor(value: string) {
	const color = processColor(value)
	return typeof color === 'number' ? color : undefined
}

/**
 * Draws journal data into Discord's chat rows: previous versions above an
 * edited message, and deleted messages that stay on screen.
 */
export function createInline(host: InlineHost) {
	const retained = new Map<string, Location>()
	const rendered = new Map<string, Location>()
	const changed = new Set<string>()
	const removers: (() => void)[] = []
	let active = true
	let rendererFound = false
	let scheduled = false
	let refreshAll = false
	let grouped: { source?: readonly Entry[]; byMessage: Map<string, Entry[]> } =
		{ byMessage: new Map() }

	const entriesOf = (key: string) => {
		const source = host.entries()
		if (source !== grouped.source) {
			const byMessage = new Map<string, Entry[]>()
			for (const entry of source) {
				const id = keyOf(entry.before.id, entry.before.channelId)
				byMessage.set(id, [...(byMessage.get(id) ?? []), entry])
			}
			grouped = { source, byMessage }
		}
		return grouped.byMessage.get(key) ?? []
	}

	const retains = (entry: Entry) =>
		active &&
		entry.kind === 'deleted' &&
		(host.settings().retainDeleted ||
			[...host.providers].some(provider => provider.retains?.(entry)))
	const retainedDeletion = (key: string) => entriesOf(key).find(retains)

	function providerNameColor(entries: readonly Entry[]) {
		for (const provider of host.providers) {
			const color = provider.nameColor?.(entries)
			if (color) return color
		}
	}

	/**
	 * Colors for the line and box behind a message. The shape comes from a row Discord draws for a
	 * mention, so the native cell receives exactly what it expects.
	 */
	function highlight(
		row: Row & { message: NonNullable<Row['message']> },
		args: GenerateArgs,
		generate: (args: GenerateArgs) => Row | undefined,
		original: Row,
		backgroundColor: number,
		gutterColor: number,
		label: string,
	) {
		// The "ephemeral" style takes its gutter from the colors, and comes with a one-line note.
		// iOS draws a mention's gutter in yellow whatever the colors say, so it uses only this.
		;(row.message as Record<string, unknown>).ephemeralIndication = {
			content: [{ type: 'text', content: label }],
			// Both are required strings: null crashes the Android decoder. A blank link leaves the
			// "?" button without a target, so it is blank on Android.
			helpArticleLink:
				Platform.OS === 'ios' ? 'https://support.discord.com' : '',
			helpButtonAccessibilityLabel: Platform.OS === 'ios' ? label : '',
		}
		if (Platform.OS === 'ios') {
			row.backgroundHighlight = { backgroundColor, gutterColor }
			return
		}
		let template: Row['backgroundHighlight']
		try {
			const record = args.message?.merge?.({ mentioned: true }) as
				| GenerateArgs['message']
				| undefined
			const mentioned = record
				? (generate({ ...args, message: record }) as
						| Record<string, unknown>
						| undefined)
				: undefined
			template = mentioned?.backgroundHighlight as Row['backgroundHighlight']
			// iOS also reads flags next to the colors, so take everything Discord changes for a mention.
			const base = original as Record<string, unknown>
			for (const [key, value] of Object.entries(mentioned ?? {})) {
				if (key === 'message' || key === 'backgroundHighlight') continue
				if (JSON.stringify(value) !== JSON.stringify(base[key]))
					(row as Record<string, unknown>)[key] = value
			}
			const marked = (mentioned?.message ?? {}) as Record<string, unknown>
			const plain = (original.message ?? {}) as Record<string, unknown>
			for (const [key, value] of Object.entries(marked)) {
				if (!/highlight|mention/i.test(key)) continue
				if (JSON.stringify(value) !== JSON.stringify(plain[key]))
					(row.message as Record<string, unknown>)[key] = value
			}
		} catch {
			// Without a template only the two colors are set.
		}
		row.backgroundHighlight = { ...template, backgroundColor, gutterColor }
	}

	function styleRow(
		original: Row | undefined,
		args: GenerateArgs,
		generate: (args: GenerateArgs) => Row | undefined,
	) {
		const message = original?.message
		const channelId = args?.message?.channel_id
		const id = message?.id ?? args?.message?.id
		const rowType = original?.type ?? original?.rowType ?? args?.rowType
		if (!original || rowType !== 1 || !message || !id || !channelId)
			return original

		const key = keyOf(id, channelId)
		const redraw = changed.delete(key)
		const entries = entriesOf(key)
		const settings = host.settings()
		const deletion = retained.has(key) ? retainedDeletion(key) : undefined
		const edits = settings.showInlineEdits
			? entries
					.filter(entry => entry.kind === 'edited')
					.sort((a, b) => a.at - b.at)
			: []
		const providerColor = providerNameColor(entries)
		if (!deletion && !edits.length && !providerColor) {
			rendered.delete(key)
			return redraw ? { ...original, changeType: 2 } : original
		}
		rendered.set(key, { id, channelId, guildId: deletion?.before.guildId })
		while (rendered.size > 400) rendered.delete(rendered.keys().next().value!)

		const row: Row & { message: NonNullable<Row['message']> } = {
			...original,
			message: { ...message },
		}
		if (redraw) row.changeType = 2

		if (edits.length && Array.isArray(message.content)) {
			const previous = edits.flatMap((entry, index) => {
				const source =
					String(entry.before.original?.content ?? entry.before.content) ||
					'(No text)'
				// One small, muted subtext block per old version.
				// In parentheses, when this version was current: the first one since the message was sent,
				// the others since the edit before them. Only when the clock option is on.
				const since =
					index === 0
						? isSnowflake(entry.before.id)
							? Number((BigInt(entry.before.id) >> 22n) + 1420070400000n)
							: entry.at
						: edits[index - 1].at
				const stamp = settings.showEditTime
					? [{ type: 'text', content: ` (${clock(since, settings)})` }]
					: []
				const wrap = (nodes: Content[]): Content[] => [
					{
						type: 'subtext',
						content: nodes
							.flatMap(node =>
								node.type === 'subtext' && Array.isArray(node.content)
									? (node.content as Content[])
									: [node],
							)
							.concat(stamp),
					},
				]
				const own = parseMarkdown(source)
				// Rendering through the native record keeps mentions and emoji intact.
				try {
					const record = args.message?.merge?.({ content: source })
					const output =
						record &&
						generate({ ...args, message: record as GenerateArgs['message'] })
							?.message?.content
					// When Discord left the markdown raw, use the built-in parser instead.
					if (Array.isArray(output))
						return wrap(
							isFormatted(own) && plainText(output) === source ? own : output,
						)
				} catch {
					// Older records fall back to the built-in parser.
				}
				return wrap(own)
			})
			row.message.content = [...previous, ...message.content]
			const tint = colorOr(settings.editedMessageColor, Grey)
			row.message.editedColor = nativeColor(tint)
			// iOS draws its own fixed colors for the highlight, so the chosen color goes on the text there.
			if (Platform.OS === 'ios') row.message.textColor = nativeColor(tint)
			if (settings.showEditTime)
				row.message.edited = `edited ${clock(edits[edits.length - 1].at, settings)}`
			const background = nativeColor(`${tint}26`)
			const gutter = nativeColor(`${tint}`)
			if (
				!row.backgroundHighlight &&
				background !== undefined &&
				gutter !== undefined
			) {
				highlight(
					row,
					args,
					generate,
					original,
					background,
					gutter,
					'Edited message',
				)
			}
		}

		if (deletion) {
			const tint = nativeColor(colorOr(settings.deletedMessageColor, Red))
			if (tint !== undefined) {
				row.message.textColor = tint
				row.message.timestampColor = tint
				const background = nativeColor(
					`${colorOr(settings.deletedMessageColor, Red)}26`,
				)
				if (background !== undefined)
					highlight(
						row,
						args,
						generate,
						original,
						background,
						tint,
						// An edited message keeps its edit time next to the name, so the deletion time goes here.
						settings.showDeletedTime && edits.length
							? `Deleted message · ${clock(deletion.at, settings)}`
							: 'Deleted message',
					)
			}
			if (
				settings.showDeletedTime &&
				!edits.length &&
				Array.isArray(row.message.content)
			) {
				row.message.edited = `deleted ${clock(deletion.at, settings)}`
				row.message.editedColor = tint
			}
		}
		const nameColor =
			providerColor ??
			(deletion && settings.colorDeletedUsername
				? settings.deletedNameColor
				: undefined)
		const name = nameColor ? nativeColor(colorOr(nameColor, Red)) : undefined
		if (name !== undefined) {
			row.message.usernameColor = name
			row.message.colorString = name
		}
		return row
	}

	const refreshEvent = ({ channelId, id, guildId }: Location) => ({
		type: 'MESSAGE_UPDATE',
		guildId,
		message: { id, channel_id: channelId },
		[SyntheticFlag]: true as const,
	})

	function dispatch(payload: object) {
		try {
			void Promise.resolve(Dispatcher.dispatch(payload as never)).catch(
				host.report,
			)
		} catch (error) {
			host.report(error)
		}
	}

	/** Drops retained rows that no longer qualify, then redraws what is still shown. */
	function reconcile(redrawAll: boolean) {
		const dropped = new Set<string>()
		for (const [key, location] of retained) {
			if (retainedDeletion(key)) continue
			retained.delete(key)
			rendered.delete(key)
			changed.delete(key)
			dropped.add(key)
			dispatch({ type: 'MESSAGE_DELETE', ...location, [SyntheticFlag]: true })
		}
		if (!redrawAll) return
		for (const [key, location] of rendered) {
			if (dropped.has(key)) continue
			changed.add(key)
			dispatch(refreshEvent(location))
		}
	}

	function scheduleReconcile(redrawAll: boolean) {
		refreshAll ||= redrawAll
		if (scheduled) return
		scheduled = true
		void Promise.resolve()
			.then(() => {
				scheduled = false
				const redraw = refreshAll
				refreshAll = false
				reconcile(redraw)
			})
			.catch(host.report)
	}

	/** Keeps a message Discord is about to delete, if the journal says it should stay. */
	function keep(location: Location) {
		const key = keyOf(location.id, location.channelId)
		if (!rendererFound || !retainedDeletion(key)) return false
		const record = getMessage(location.channelId, location.id)
		// Unsent and ephemeral messages are dismissed instead of retained.
		if (record?.state !== 'SENT' || (record.flags ?? 0) & (1 << 6)) return false
		retained.set(key, location)
		changed.add(key)
		scheduleReconcile(false)
		return true
	}

	/** MESSAGE_DELETE: turn the deletion into a redraw when the message is retained. */
	function onDelete<T extends DeleteEvent>(payload: T): T | undefined {
		if (isSynthetic(payload) || !payload.id || !payload.channelId)
			return payload
		const location = {
			id: payload.id,
			channelId: payload.channelId,
			guildId: payload.guildId,
		}
		return keep(location) ? (refreshEvent(location) as unknown as T) : payload
	}

	function onDeleteBulk<T extends DeleteEvent>(payload: T): T | undefined {
		if (
			isSynthetic(payload) ||
			!Array.isArray(payload.ids) ||
			!payload.channelId
		)
			return payload
		const kept = new Set<string>()
		for (const id of payload.ids) {
			const location = {
				id,
				channelId: payload.channelId,
				guildId: payload.guildId,
			}
			if (kept.has(id) || !keep(location)) continue
			kept.add(id)
			void Promise.resolve().then(() => {
				if (retained.has(keyOf(id, location.channelId)))
					dispatch(refreshEvent(location))
			})
		}
		if (!kept.size) return payload
		const remaining = payload.ids.filter(id => !kept.has(id))
		return remaining.length ? { ...payload, ids: remaining } : undefined
	}

	/** Adds retained deleted messages back when a channel's messages load. */
	function onLoaded<T extends LoadedMessages>(payload: T): T {
		if (
			!rendererFound ||
			!payload.channelId ||
			!Array.isArray(payload.messages)
		)
			return payload
		const present = new Set(payload.messages.map(message => message.id))
		const sorted = payload.messages
			.map(message => message.id)
			.filter(isSnowflake)
			.map(BigInt)
			.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
		const restored: Record<string, unknown>[] = []
		for (const entry of host.entries()) {
			const { before } = entry
			if (
				before.channelId !== payload.channelId ||
				present.has(before.id) ||
				!isSnowflake(before.id)
			)
				continue
			const key = keyOf(before.id, before.channelId)
			if (!retains(entry) || !retainedDeletion(key)) continue
			const id = BigInt(before.id)
			const inside =
				sorted.length > 0 && id >= sorted[0] && id <= sorted[sorted.length - 1]
			const older =
				sorted.length > 0 && id < sorted[0] && payload.hasMoreBefore === false
			const newer =
				sorted.length > 0 &&
				id > sorted[sorted.length - 1] &&
				payload.hasMoreAfter === false
			const empty =
				!sorted.length &&
				payload.hasMoreBefore === false &&
				payload.hasMoreAfter === false
			if (!(inside || older || newer || empty)) continue
			present.add(before.id)
			restored.push({
				...before.original,
				id: before.id,
				channel_id: before.channelId,
				guild_id: before.guildId || undefined,
				author: before.original?.author ?? {
					id: before.authorId,
					username: before.author,
					bot: before.bot,
				},
				content:
					typeof before.original?.content === 'string'
						? before.original.content
						: before.content,
				timestamp:
					before.original?.timestamp ??
					new Date(Number((id >> 22n) + 1420070400000n)).toISOString(),
				state: 'SENT',
				flags: 0,
				type: 0,
				attachments: before.original?.attachments ?? [],
				embeds: before.original?.embeds ?? [],
				reactions: [],
				mentions: before.mentions.map(userId => ({ id: userId })),
				mention_roles: before.roles,
				mention_everyone: before.everyone,
			})
			retained.set(key, {
				id: before.id,
				channelId: before.channelId,
				guildId: before.guildId,
			})
			changed.add(key)
		}
		if (!restored.length) return payload
		const newestFirst = (a: { id: string }, b: { id: string }) =>
			isSnowflake(a.id) && isSnowflake(b.id)
				? BigInt(a.id) > BigInt(b.id)
					? -1
					: BigInt(a.id) < BigInt(b.id)
						? 1
						: 0
				: 0
		return {
			...payload,
			messages: [...payload.messages, ...(restored as { id: string }[])].sort(
				newestFirst,
			),
		} as T
	}

	function start() {
		for (const type of [
			'LOAD_MESSAGES_SUCCESS',
			'LOAD_MESSAGES_SUCCESS_CACHED',
		]) {
			removers.push(
				onFluxEventDispatched<LoadedMessages & { type: string }>(
					type,
					onLoaded,
				),
			)
		}
		const patched = new WeakSet<object>()
		removers.push(
			getModules(
				withName<{ prototype: RowGenerator }>('RowManager'),
				target => {
					const { prototype } = target
					if (
						typeof prototype?.generate !== 'function' ||
						patched.has(prototype)
					)
						return
					patched.add(prototype)
					removers.push(
						instead(prototype, 'generate', function (args, original) {
							const row = original.apply(this, args)
							try {
								return styleRow(row, args[0], value =>
									original.call(this, value),
								)
							} catch (error) {
								host.report(error)
								return row
							}
						}),
					)
					rendererFound = true
				},
			),
		)
		scheduleReconcile(true)
	}

	return {
		start,
		onDelete,
		onDeleteBulk,
		refresh: () => scheduleReconcile(true),
		stop() {
			// Clear retained rows while the row hook can still redraw them.
			active = false
			try {
				reconcile(true)
			} catch (error) {
				host.report(error)
			}
			for (const remove of removers.splice(0).reverse()) {
				try {
					remove()
				} catch (error) {
					host.report(error)
				}
			}
			changed.clear()
			rendered.clear()
			rendererFound = false
		},
	}
}
