import type { Channel, RawMessage } from './discord'
import type { Entry, PingInfo, Settings, Snapshot } from './types'

export type FluxMessageEvent = {
	type: string
	message?: RawMessage
	id?: string
	ids?: string[]
	channelId?: string
	guildId?: string
}

export const MaxCacheSize = 50000
export const JournalLimit = 200
const TextLimit = 1600
const SnapshotAge = 24 * 60 * 60 * 1000
const KeptFields = [
	'id',
	'channel_id',
	'guild_id',
	'author',
	'content',
	'attachments',
	'embeds',
	'mentions',
	'mention_roles',
	'mention_everyone',
	'message_reference',
	'referenced_message',
	'timestamp',
	'edited_timestamp',
	'type',
	'flags',
	'sticker_items',
	'components',
]

export type Env = {
	settings(): Settings
	currentUserId(): string | undefined
	channel(channelId: string): Channel | undefined
	/** A message as Discord's store currently has it. */
	stored(channelId: string, id: string): RawMessage | undefined
	loaded(channelId: string): boolean
	record(entry: Entry): void
}

const ids = (text: string, pattern: RegExp) =>
	Array.from(text.matchAll(pattern), match => match[1]).slice(0, 100)
const fresh = (snapshot: Snapshot) =>
	Date.now() - snapshot.seenAt <= SnapshotAge

export function pingInfo(snapshot: Snapshot): PingInfo & { content: string } {
	const { content, mentioned, mentions, roles, everyone, replyTo } = snapshot
	return { content, mentioned, mentions, roles, everyone, replyTo }
}

export function createEngine(env: Env) {
	const recent = new Map<string, Snapshot>()
	const keyOf = (channelId: string, id: string) => `${channelId}:${id}`
	let ignoredSource = ''
	let ignored = new Set<string>()

	function isIgnored(id: string) {
		const source = env.settings().ignoredIds
		if (source !== ignoredSource) {
			ignoredSource = source
			ignored = new Set(source.split(/[\s,]+/).filter(Boolean))
		}
		return ignored.has(id)
	}

	/** Builds a snapshot from a gateway message, filling gaps from the previous one. */
	function toSnapshot(
		message: RawMessage,
		channelId: string,
		guildId = '',
		old?: Snapshot,
	): Snapshot | undefined {
		const author = message.author
		if (!message.id || !(author?.id || old?.authorId)) return
		const content =
			typeof message.content === 'string' ? message.content : undefined
		const changed = content !== undefined && content !== old?.content
		const reference = message.message_reference
		const referenceId =
			reference?.message_id ?? message.messageReference?.messageId
		const referenceChannel =
			reference?.channel_id ?? message.messageReference?.channelId ?? channelId
		const repliedTo =
			message.referenced_message?.author?.id ??
			message.referencedMessage?.author?.id ??
			(referenceId
				? env.stored(referenceChannel, referenceId)?.author?.id
				: undefined)
		const roles = message.mention_roles ?? message.mentionRoles
		const channel = env.channel(channelId)
		const original = { ...old?.original }
		const source = message as Record<string, unknown>
		for (const field of KeptFields) {
			if (source[field] === undefined) continue
			try {
				original[field] = JSON.parse(JSON.stringify(source[field]))
			} catch {
				// Transient fields that cannot be serialised are not needed.
			}
		}
		return {
			original,
			id: message.id,
			channelId,
			guildId:
				message.guild_id ??
				message.guildId ??
				(guildId ||
					old?.guildId ||
					channel?.guild_id ||
					channel?.guildId ||
					''),
			authorId: author?.id ?? old!.authorId,
			author: (author?.username ?? old?.author ?? 'Unknown user').slice(0, 80),
			bot: author?.bot ?? old?.bot ?? false,
			content: (content ?? old?.content ?? '').slice(0, TextLimit),
			mentions: Array.isArray(message.mentions)
				? message.mentions
						.flatMap(user =>
							typeof user === 'string' ? [user] : user?.id ? [user.id] : [],
						)
						.slice(0, 100)
				: changed
					? ids(content!, /<@!?(\d+)>/g)
					: (old?.mentions ?? []),
			mentioned:
				message.mentioned ??
				(!(changed || Array.isArray(message.mentions)) &&
					old?.mentioned === true),
			roles: Array.isArray(roles)
				? roles.slice(0, 100)
				: changed
					? ids(content!, /<@&(\d+)>/g)
					: (old?.roles ?? []),
			everyone:
				message.mention_everyone ??
				message.mentionEveryone ??
				(changed
					? old?.everyone === true && /@(everyone|here)\b/.test(content!)
					: (old?.everyone ?? false)),
			replyTo:
				reference === null || message.messageReference === null
					? ''
					: (repliedTo ?? old?.replyTo ?? ''),
			seenAt: Date.now(),
		}
	}

	function skipped(message: Snapshot) {
		const settings = env.settings()
		return (
			(settings.skipBots && message.bot) ||
			(settings.skipSelf && message.authorId === env.currentUserId()) ||
			isIgnored(message.authorId) ||
			isIgnored(message.channelId) ||
			(!!message.guildId && isIgnored(message.guildId))
		)
	}

	function trim() {
		const limit = Math.max(
			25,
			Math.min(MaxCacheSize, env.settings().cacheLimit),
		)
		while (recent.size > limit) recent.delete(recent.keys().next().value!)
	}

	function remember(message: Snapshot) {
		const key = keyOf(message.channelId, message.id)
		recent.delete(key)
		if (!skipped(message)) recent.set(key, message)
		trim()
	}

	/** The message as we last saw it, from the cache or from Discord's own store. */
	function known(channelId: string, id: string, guildId?: string) {
		const cached = recent.get(keyOf(channelId, id))
		if (cached && fresh(cached)) return cached
		return toSnapshot(env.stored(channelId, id) ?? {}, channelId, guildId)
	}

	function log(kind: Entry['kind'], before: Snapshot, after?: Snapshot) {
		const settings = env.settings()
		if (
			skipped(before) ||
			!(kind === 'edited' ? settings.logEdits : settings.logDeletes)
		)
			return
		env.record({
			kind,
			at: Date.now(),
			before,
			after: after && pingInfo(after),
		})
	}

	/** Reads one MESSAGE_* event. Must run before Discord's stores handle it. */
	function observe(event: FluxMessageEvent) {
		const { message } = event
		const channelId =
			event.channelId ?? message?.channel_id ?? message?.channelId
		if (
			!channelId ||
			(env.settings().captureMode === 'loaded' && !env.loaded(channelId))
		)
			return
		if (event.type === 'MESSAGE_CREATE' && message) {
			const created = toSnapshot(message, channelId, event.guildId)
			if (created) remember(created)
		} else if (event.type === 'MESSAGE_UPDATE' && message?.id) {
			const before = known(channelId, message.id, event.guildId)
			const after = toSnapshot(message, channelId, event.guildId, before)
			if (before && after) {
				const attachments = (snapshot: Snapshot) =>
					JSON.stringify(snapshot.original?.attachments ?? [])
				if (
					before.content !== after.content ||
					attachments(before) !== attachments(after)
				)
					log('edited', before, after)
			}
			if (after) remember(after)
		} else if (
			event.type === 'MESSAGE_DELETE' ||
			event.type === 'MESSAGE_DELETE_BULK'
		) {
			for (const id of new Set(
				event.type === 'MESSAGE_DELETE' ? [event.id] : (event.ids ?? []),
			)) {
				if (!id) continue
				const before = known(channelId, id, event.guildId)
				if (before) log('deleted', before)
				recent.delete(keyOf(channelId, id))
			}
		} else {
			return false
		}
		return true
	}

	return {
		observe,
		trim,
		clear: () => recent.clear(),
		size: () => recent.size,
		snapshot: () => [...recent.values()].filter(fresh),
		restore(messages: Snapshot[]) {
			for (const message of messages.slice(-MaxCacheSize)) {
				if (message?.id && message.channelId && fresh(message))
					remember(message)
			}
		},
	}
}
