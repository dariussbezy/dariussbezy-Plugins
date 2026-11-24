import type { ComponentType } from 'react'

/** Everything needed to tell whether a message pinged someone. */
export type PingInfo = {
	mentioned: boolean
	mentions: string[]
	roles: string[]
	everyone: boolean
	replyTo: string
}

export type Snapshot = PingInfo & {
	id: string
	channelId: string
	guildId: string
	authorId: string
	author: string
	bot: boolean
	content: string
	seenAt: number
	/** Raw message fields, kept so a deleted message can be drawn again. */
	original?: Record<string, unknown>
}

export type EntryKind = 'edited' | 'deleted'

export type Entry = {
	kind: EntryKind
	at: number
	before: Snapshot
	/** State after an edit. Dependents compare its ping info with `before`. */
	after?: PingInfo & { content: string }
}

export type IosHighlight = 'red' | 'yellow' | 'blurple'

export const DefaultSettings = {
	logEdits: true,
	logDeletes: true,
	skipBots: true,
	skipSelf: true,
	ignoredIds: '',
	ignoredTargets: {} as Record<string, { scope: IgnoreScope; name: string }>,
	captureMode: 'all' as 'all' | 'loaded',
	cacheLimit: 20000,
	onlySelectedServers: false,
	serverIds: [] as string[],
	keepDMs: true,
	persist: true,
	rememberReceived: true,
	retentionDays: 7,
	retainDeleted: true,
	/** A "Deleted" / "Edited" tag next to the name, like Discord's app tag. */
	showTag: false,
	/**
	 * Discord's own note under logged messages, with its "Dismiss message" link (and the "?" help
	 * button that comes with it). Dismiss removes the edits of an edited message, or a deleted message.
	 */
	dismissButton: false,
	/** Dims the photos and files of deleted messages. */
	dimDeletedMedia: true,
	/** Replies to a deleted message show it from the log instead of "Original message was deleted". */
	fillDeletedReplies: true,
	/** Who a reply to a deleted message quotes: a mention (<@id>) or the plain @name. */
	quoteAuthorAs: 'mention' as 'mention' | 'name',
	showInlineEdits: true,
	colorDeletedUsername: true,
	deletedMessageColor: '#ED4245',
	editedMessageColor: '#A0A3AA',
	deletedNameColor: '#ED4245',
	/** Box and line behind a deleted message. */
	deletedHighlightColor: '#ED4245',
	/**
	 * iPhone draws highlights only in Discord's own colors: yellow (mention), blurple (ephemeral)
	 * or red (AutoMod).
	 */
	iosDeletedHighlight: 'red' as IosHighlight,
	iosEditedHighlight: 'blurple' as IosHighlight,
	/** Box and line behind an edited message. */
	editedHighlightColor: '#A0A3AA',
	/**
	 * Highlight: box, line and Discord's note. Box: box and line without the note (custom colors on
	 * iPhone too). Text: only the colored text.
	 */
	messageStyle: 'highlight' as 'highlight' | 'box' | 'text',
	showDeletedTime: false,
	showEditTime: false,
	showSeconds: false,
	use12HourClock: false,
	savedFilters: [] as SavedFilter[],
}

export type Settings = typeof DefaultSettings
export type IgnoreScope = 'user' | 'server' | 'channel' | 'DM'

export type Data = { settings: Settings; entries: Entry[]; recent: Snapshot[] }

export type HistoryFilter = {
	query: string
	kind: 'all' | EntryKind
	author: string
	channel: string
	server: string
	from: string
	to: string
}
export type SavedFilter = { name: string; filter: HistoryFilter }

/** Lets a dependent plugin change how AML draws rows in chat. */
export interface InlineProvider {
	/** Keep this deleted entry visible in chat even if AML's own setting is off. */
	retains?(entry: Entry): boolean
	/** A username color for a message that has these journal entries. */
	nameColor?(entries: readonly Entry[]): string | undefined
}

export interface HistoryViewProps {
	entries: readonly Entry[]
	/** Hide the Edited/Deleted selector when only one kind can appear. */
	kinds?: boolean
	defaultKind?: 'all' | EntryKind
	saved: SavedFilter[]
	onSavedChange(saved: SavedFilter[]): void
}

export interface ColorRowsProps {
	title: string
	value: string
	/** The preset marked "Default". */
	fallback: string
	onSelect(color: string): void
}

/** What AML hands to every plugin that depends on it, as `api.aml`. */
export interface AmlApi {
	getEntries(): readonly Entry[]
	/** Called whenever the journal changes. */
	subscribe(listener: () => void): () => void
	/**
	 * Called for each new journal entry.
	 */
	onEntry(listener: (entry: Entry) => void): () => void
	remove(entries: readonly Entry[]): void
	jump(entry: Entry): void
	showDetails(entry: Entry, related?: readonly Entry[]): void
	notify(title: string, entry?: Entry, content?: string): void
	addInlineProvider(provider: InlineProvider): () => void
	refreshInline(): void
	components: {
		HistoryView: ComponentType<HistoryViewProps>
		ColorRows: ComponentType<ColorRowsProps>
		/** A round color dot, for rows that show a color. */
		Swatch: ComponentType<{ color: string }>
	}
}

declare module '@valenced/plugins/types' {
	interface PluginApi {
		aml?: AmlApi
	}
}
