import { Dispatcher } from '@valenced/discord/common/flux'
import { Tokens } from '@valenced/discord/common/tokens'
import { Stores } from '@valenced/discord/flux'
import { getModules, lookupModule } from '@valenced/modules/finders'
import {
	withDependencies,
	withName,
	withProps,
} from '@valenced/modules/finders/filters'
import { before, instead } from '@valenced/patcher'
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
		tagText?: string | null
		tagAccessibilityLabel?: string | null
		tagVerified?: boolean | null
		tagType?: string | null
		tagTextColor?: number
		tagBackgroundColor?: number
		attachmentsOpacity?: number
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
type LoadedMessage = {
	id: string
	channel_id?: string
	message_reference?: { message_id?: string; channel_id?: string } | null
	referenced_message?: unknown
}
type LoadedMessages = {
	channelId?: string
	messages: LoadedMessage[]
	hasMoreBefore?: boolean
	hasMoreAfter?: boolean
}
type DeleteEvent = {
	id?: string
	ids?: string[]
	channelId?: string
	guildId?: string
}
type SyncEvent = {
	changesByChannelId?: Record<
		string,
		{ deleted_message_ids?: string[] } | undefined
	>
}

type SendOptions = {
	messageReference?: { message_id?: string; channel_id?: string } | null
	allowedMentions?: {
		parse?: string[]
		replied_user?: boolean
		users?: string[]
	}
}
type MessageSender = {
	sendMessage(
		channelId: string,
		message: { content?: string },
		...rest: unknown[]
	): unknown
}

export type InlineHost = {
	settings(): Settings
	entries(): readonly Entry[]
	providers: ReadonlySet<InlineProvider>
	report(error: unknown): void
	remove(entries: readonly Entry[]): void
}

const Red = '#ed4245'
const Grey = '#939aa8'
const keyOf = (id: string, channelId: string) => `${channelId}:${id}`
const isSnowflake = (id: string | undefined): id is string =>
	typeof id === 'string' && /^\d+$/.test(id)
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

type AutomodKit = {
	embed(args: {
		errorMessage: string
		colors: unknown
	}): Record<string, unknown>
	colors(theme: string): unknown
}
let automod: AutomodKit | undefined
let automodTries = 0

type AutomodEmbeds = {
	createAutomodBlockedMessageEmbed(args: {
		errorMessage: string
		colors: unknown
	}): Record<string, unknown>
}
const { relative } = withDependencies
/** MessageFailedStates.AUTO_MODERATION_BLOCKED_MESSAGE in Discord's renderer. */
const AutomodFailureState = 2

const currentTheme = () =>
	(Stores.ThemeStore as unknown as { theme?: string } | undefined)?.theme ??
	'dark'

/** Discord's muted text color for the current theme, as a native color. */
function mutedText() {
	try {
		const { colors, internal } = Tokens.default as unknown as {
			colors: Record<string, unknown>
			internal: {
				resolveSemanticColor(theme: unknown, color: unknown): unknown
			}
		}
		const value = internal.resolveSemanticColor(
			currentTheme(),
			colors.TEXT_MUTED,
		)
		return typeof value === 'string' ? nativeColor(value) : undefined
	} catch {
		return undefined
	}
}

/**
 * Discord's helpers for the AutoMod "blocked message" footer, found once. Not cached: a miss
 * before the modules load would otherwise be remembered across restarts (it was on iOS).
 */
function findAutomod(): AutomodKit | undefined {
	if (automod || automodTries > 20) return automod
	automodTries++
	try {
		const byExports = withProps<AutomodEmbeds>(
			'createAutomodBlockedMessageEmbed',
		)
		const embeds =
			lookupModule(byExports, { cached: false })[0] ??
			// modules/messages/native/renderer/createMessageFailedEmbed.tsx, followed by its two icons.
			lookupModule(
				withDependencies([
					null,
					null,
					null,
					relative(1),
					null,
					relative(2),
					null,
					null,
				]).and(byExports),
				{ cached: false, initialize: true },
			)[0]
		const colors = lookupModule(
			withName<(theme: string) => unknown>('resolveMessageContentColors'),
			{ cached: false },
		)[0]
		if (
			typeof embeds?.createAutomodBlockedMessageEmbed === 'function' &&
			typeof colors === 'function'
		)
			automod = {
				embed: args => embeds.createAutomodBlockedMessageEmbed(args),
				colors,
			}
	} catch {
		// Falls back to Discord's ephemeral note.
	}
	return automod
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
	 * Discord's own ephemeral note for this message, built by Discord as if the message were
	 * ephemeral, so its "Dismiss message" link works. The label replaces "Only you can see this".
	 */
	function discordNote(
		args: GenerateArgs,
		generate: (args: GenerateArgs) => Row | undefined,
		label: string,
	) {
		try {
			const source = args.message as
				| (GenerateArgs['message'] & { flags?: number })
				| undefined
			const record = source?.merge?.({
				flags: Number(source.flags ?? 0) | (1 << 6),
			}) as GenerateArgs['message'] | undefined
			const marked = record
				? (generate({ ...args, message: record }) as
						| Record<string, unknown>
						| undefined)
				: undefined
			const note = (marked?.message as Record<string, unknown> | undefined)
				?.ephemeralIndication as { content?: unknown[] } | undefined
			if (!note || !Array.isArray(note.content)) return undefined
			const links = note.content.filter(
				part =>
					typeof part === 'object' &&
					part !== null &&
					(part as { type?: string }).type !== 'text',
			)
			// The link keeps Discord's action; its words become just "Dismiss".
			const relabel = (part: unknown): unknown => {
				if (Array.isArray(part)) return part.map(relabel)
				if (!part || typeof part !== 'object') return part
				const node = part as Record<string, unknown>
				if (node.type === 'text' && typeof node.content === 'string')
					return { ...node, content: 'Dismiss' }
				return 'content' in node
					? { ...node, content: relabel(node.content) }
					: node
			}
			return {
				...note,
				content: [
					{ type: 'text', content: `${label} · ` },
					...(links.length ? links.map(relabel) : note.content),
				],
			}
		} catch {
			return undefined
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
		const style = host.settings().messageStyle
		// "Text only": the colored text stays, without the box, the line and Discord's note.
		if (style === 'text') return
		// With the Dismiss button on, the note is Discord's own (with "Dismiss message" and "?").
		const note =
			style === 'highlight' && host.settings().dismissButton
				? discordNote(args, generate, label)
				: undefined
		if (note && Platform.OS !== 'ios')
			(row.message as Record<string, unknown>).ephemeralIndication = note
		// "Highlight" adds a note under the message: Discord's own AutoMod footer (shield and text,
		// no help button). "Box" is the colors alone.
		if (style === 'highlight' && !note) {
			const kit = findAutomod()
			const message = row.message as Record<string, unknown>
			if (kit) {
				const theme =
					(Stores.ThemeStore as unknown as { theme?: string } | undefined)
						?.theme ?? 'dark'
				const notice = kit.embed({
					errorMessage: label,
					colors: kit.colors(theme),
				})
				// Android reads iconURL, the iOS decoder reads iconUrl.
				message.embeds = [
					...(Array.isArray(message.embeds) ? message.embeds : []),
					{ ...notice, iconUrl: notice.iconURL },
				]
			} else {
				// Without the helpers: the same footer built by hand (a "message failed" embed in the
				// AutoMod state), so Discord's ephemeral note and its "?" button are never needed.
				message.embeds = [
					...(Array.isArray(message.embeds) ? message.embeds : []),
					{
						type: 'text',
						messageSendError: label,
						failureState: AutomodFailureState,
						disableBackgroundColor: true,
						bodyTextColor: mutedText(),
					},
				]
			}
		}
		if (Platform.OS === 'ios') {
			// iOS ignores backgroundHighlight (its chat cell, read from the decompiled app): it draws a
			// box and a line only in its own theme colors, for a mention (yellow), Discord's ephemeral
			// note (blurple), or that note with an AutoMod "blocked" footer (red). So iPhone offers
			// those three looks instead of any color.
			const message = row.message as Record<string, unknown>
			const settings = host.settings()
			const look = label.startsWith('Deleted')
				? settings.iosDeletedHighlight
				: settings.iosEditedHighlight
			const ours = (embed: unknown) =>
				(embed as { failureState?: number })?.failureState ===
				AutomodFailureState
			const others = (
				Array.isArray(message.embeds) ? message.embeds : []
			).filter(embed => !ours(embed))
			if (look === 'yellow') {
				message.mentioned = true
				if (note) message.ephemeralIndication = note
				return
			}
			// Blurple and red: Discord's ephemeral note carries the label (with its help button).
			message.ephemeralIndication = note ?? {
				content: [{ type: 'text', content: label }],
				// iOS requires a valid address here.
				helpArticleLink: 'https://support.discord.com',
				helpButtonAccessibilityLabel: label,
			}
			// Red needs an AutoMod footer next to the note: an empty one, without an icon, so only the
			// note shows.
			message.embeds =
				look === 'red'
					? [
							...others,
							{
								type: 'text',
								messageSendError: '',
								failureState: AutomodFailureState,
								disableBackgroundColor: true,
							},
						]
					: others
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
			if (settings.showEditTime && !deletion)
				row.message.edited = `edited ${clock(edits[edits.length - 1].at, settings)}`
			const box = colorOr(settings.editedHighlightColor, tint)
			const background = nativeColor(`${box}26`)
			const gutter = nativeColor(box)
			// A deleted message shows only that it was deleted.
			if (
				!deletion &&
				!row.backgroundHighlight &&
				background !== undefined &&
				gutter !== undefined
			) {
				highlight(row, args, generate, original, background, gutter, 'Edited')
			}
		}

		if (deletion) {
			const tint = nativeColor(colorOr(settings.deletedMessageColor, Red))
			if (tint !== undefined) {
				row.message.textColor = tint
				row.message.timestampColor = tint
				const box = colorOr(
					settings.deletedHighlightColor,
					colorOr(settings.deletedMessageColor, Red),
				)
				const background = nativeColor(`${box}26`)
				const gutter = nativeColor(box)
				if (background !== undefined && gutter !== undefined)
					highlight(
						row,
						args,
						generate,
						original,
						background,
						gutter,
						'Deleted',
					)
			}
			if (Array.isArray(row.message.content)) {
				// Next to the text: the deletion time, or nothing (no "edited" on a deleted message).
				if (settings.showDeletedTime) {
					row.message.edited = `deleted ${clock(deletion.at, settings)}`
					row.message.editedColor = tint
				} else if (edits.length || message.edited) {
					;(row.message as Record<string, unknown>).edited = null
				}
			}
		}
		if (deletion && settings.dimDeletedMedia)
			row.message.attachmentsOpacity = 0.5
		// Discord's tag next to the name (where "APP" goes), only when the author has none.
		if (settings.showTag && !message.tagText && (deletion || edits.length)) {
			const label = deletion ? 'DELETED' : 'EDITED'
			const background = nativeColor(
				deletion
					? colorOr(
							settings.deletedHighlightColor,
							colorOr(settings.deletedMessageColor, Red),
						)
					: colorOr(
							settings.editedHighlightColor,
							colorOr(settings.editedMessageColor, Grey),
						),
			)
			if (background !== undefined) {
				row.message.tagText = label
				row.message.tagAccessibilityLabel = label
				row.message.tagVerified = false
				// Discord's plain text tag type ("SERVER"), without the bot checkmark.
				row.message.tagType = 'b'
				row.message.tagBackgroundColor = background
				row.message.tagTextColor = nativeColor('#ffffff')
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
			// Role gradients and Nitro name styles are drawn from these instead of the plain color.
			const named = row.message as Record<string, unknown>
			named.roleColor = name
			named.roleColors = null
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

	/**
	 * A local MESSAGE_DELETE: "Dismiss message" in Discord's note. On a deleted message the log entry
	 * goes and the message leaves the chat; on an edited one only the edits go and the message stays.
	 */
	function onDismiss<T extends DeleteEvent>(payload: T): T | undefined {
		if (isSynthetic(payload) || !payload.id || !payload.channelId)
			return payload
		const key = keyOf(payload.id, payload.channelId)
		const entries = entriesOf(key)
		if (!entries.length) return payload
		if (entries.some(entry => entry.kind === 'deleted')) {
			retained.delete(key)
			rendered.delete(key)
			host.remove(entries)
			return payload
		}
		changed.add(key)
		host.remove(entries.filter(entry => entry.kind === 'edited'))
		return undefined
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

	/**
	 * Background sync removes the messages deleted while the app was away, without a MESSAGE_DELETE.
	 * Retained ones are taken out of the list and redrawn as deleted instead.
	 */
	function onBackgroundSync<T extends SyncEvent>(payload: T): T {
		const changes = payload.changesByChannelId
		if (isSynthetic(payload) || !changes || typeof changes !== 'object')
			return payload
		let next: SyncEvent['changesByChannelId'] | undefined
		for (const [channelId, change] of Object.entries(changes)) {
			const ids = change?.deleted_message_ids
			if (!Array.isArray(ids) || !ids.length) continue
			const kept = new Set<string>()
			for (const id of ids) {
				const location = { id, channelId }
				if (kept.has(id) || !keep(location)) continue
				kept.add(id)
				void Promise.resolve().then(() => {
					if (retained.has(keyOf(id, channelId)))
						dispatch(refreshEvent(location))
				})
			}
			if (!kept.size) continue
			next ??= { ...changes }
			next[channelId] = {
				...change,
				deleted_message_ids: ids.filter(id => !kept.has(id)),
			}
		}
		return next ? { ...payload, changesByChannelId: next } : payload
	}

	/** A message rebuilt from its log snapshot, in the gateway's shape. */
	function rawOf(before: Entry['before']) {
		const id = isSnowflake(before.id) ? BigInt(before.id) : 0n
		return {
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
		}
	}

	/**
	 * A reply whose message was deleted comes with referenced_message: null, which Discord shows as
	 * "Original message was deleted". When the log has that message, it goes back in.
	 */
	function fillReply<T extends LoadedMessage>(message: T): T {
		const reference = message?.message_reference
		if (
			!host.settings().fillDeletedReplies ||
			message.referenced_message !== null ||
			!reference?.message_id
		)
			return message
		const channelId = reference.channel_id ?? message.channel_id
		if (!channelId) return message
		const deleted = entriesOf(keyOf(reference.message_id, channelId)).find(
			entry => entry.kind === 'deleted',
		)
		return deleted
			? { ...message, referenced_message: rawOf(deleted.before) }
			: message
	}

	function onCreate<T extends { message?: unknown }>(payload: T): T {
		const message = payload.message as LoadedMessage | undefined
		if (!message || typeof message !== 'object') return payload
		const filled = fillReply(message)
		return filled === message ? payload : { ...payload, message: filled }
	}

	/** Adds retained deleted messages back when a channel's messages load. */
	function onLoaded<T extends LoadedMessages>(loaded: T): T {
		if (!Array.isArray(loaded.messages)) return loaded
		const messages = loaded.messages.map(message =>
			message && typeof message === 'object' ? fillReply(message) : message,
		)
		const payload = messages.some(
			(message, at) => message !== loaded.messages[at],
		)
			? { ...loaded, messages }
			: loaded
		if (!rendererFound || !payload.channelId) return payload
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
			restored.push(rawOf(before))
			retained.set(key, {
				id: before.id,
				channelId: before.channelId,
				guildId: before.guildId,
			})
			changed.add(key)
		}
		if (!restored.length) return payload
		// Keep the order the list came in: newest first from the server, possibly oldest first from the phone.
		const list = payload.messages
		const first = list[0]?.id
		const last = list[list.length - 1]?.id
		const oldestFirst =
			list.length > 1 &&
			isSnowflake(first) &&
			isSnowflake(last) &&
			BigInt(first) < BigInt(last)
		const order = (a: { id: string }, b: { id: string }) => {
			if (!isSnowflake(a.id) || !isSnowflake(b.id)) return 0
			const sign =
				BigInt(a.id) > BigInt(b.id) ? -1 : BigInt(a.id) < BigInt(b.id) ? 1 : 0
			return oldestFirst ? -sign : sign
		}
		return {
			...payload,
			messages: [...list, ...(restored as LoadedMessage[])].sort(order),
		} as T
	}

	/** Turns a reply to a retained deleted message into a message that quotes it. */
	function quoteDeleted<T extends unknown[]>(args: T): T {
		const [channelId, message, , options] = args as unknown as [
			string,
			{ content?: string } | undefined,
			unknown,
			SendOptions | undefined,
		]
		const reference = options?.messageReference
		if (
			!options ||
			!reference?.message_id ||
			!message ||
			typeof channelId !== 'string'
		)
			return args
		const key = keyOf(reference.message_id, reference.channel_id ?? channelId)
		const deletion = retained.has(key) ? retainedDeletion(key) : undefined
		if (!deletion) return args
		const snapshot = deletion.before
		const asName = host.settings().quoteAuthorAs === 'name'
		const mention = asName ? `@${snapshot.author}` : `<@${snapshot.authorId}>`
		// A mention with the reply's ping turned off: shown, but that user is not notified.
		const silent = !asName && options.allowedMentions?.replied_user === false
		const attachments = snapshot.original?.attachments
		const files = Array.isArray(attachments) ? attachments.length : 0
		const text = String(snapshot.original?.content ?? snapshot.content).trim()
		const parts = [
			text,
			files ? `(${files} attachment${files > 1 ? 's' : ''})` : '',
		].filter(Boolean)
		const own = message.content ?? ''
		const room = Math.max(0, 1990 - own.length - mention.length)
		let quoted = parts.join(' ') || '(No text)'
		if (quoted.length > room)
			quoted = `${quoted.slice(0, Math.max(0, room - 1))}…`
		const quote = `${mention}: ${quoted}`
			.split('\n')
			.map(line => `> ${line}`)
			.join('\n')
		const next = [...args]
		next[1] = { ...message, content: room ? `${quote}\n${own}` : own }
		const { replied_user: _, ...mentions } = options.allowedMentions ?? {}
		if (silent) {
			// Users mentioned in your own text still get pinged; only the quoted author does not.
			const users = [...own.matchAll(/<@!?(\d+)>/g)]
				.map(match => match[1])
				.filter(id => id !== snapshot.authorId)
			mentions.parse = (
				mentions.parse ?? ['users', 'roles', 'everyone']
			).filter(kind => kind !== 'users')
			mentions.users = [...new Set(users)]
		}
		next[3] = {
			...options,
			messageReference: undefined,
			...(options.allowedMentions ? { allowedMentions: mentions } : {}),
		}
		return next as T
	}

	function start() {
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
		// A deleted message kept on screen no longer exists on the server, so a reply to it fails.
		// The reply goes out as a normal message that quotes the deleted one instead.
		removers.push(
			getModules(
				// The MessageActions module.
				withProps<MessageSender & { jumpToMessage: unknown }>(
					'sendMessage',
					'jumpToMessage',
				),
				actions => {
					if (patched.has(actions)) return
					patched.add(actions)
					removers.push(
						before(actions, 'sendMessage', args => {
							try {
								return quoteDeleted(args)
							} catch (error) {
								host.report(error)
								return args
							}
						}),
					)
				},
			),
		)
		scheduleReconcile(true)
	}

	return {
		start,
		onCreate,
		onDelete,
		onDismiss,
		onDeleteBulk,
		onLoaded,
		onBackgroundSync,
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
