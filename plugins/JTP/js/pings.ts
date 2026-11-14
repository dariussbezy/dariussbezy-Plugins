import { Dispatcher } from '@valenced/discord/common/flux'
import { Stores } from '@valenced/discord/flux'
import { lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import {
	compareIds,
	isExact,
	isPing,
	isSnowflake,
	nextId,
	previousId,
	selectPings,
} from './logic'
import { closeSheetAndNavigate } from './navigation'
import { getSettings, notify } from './shared'
import type { Ping, PingContext } from './logic'

export interface Row {
	channelId: string
	dm: boolean
	/** Pings (or unread DM messages) Discord counts, or the unvisited queue size. */
	count: number
	/** First unread message, when it can be determined. */
	oldest: string | null
	/** True when the pings come from the "keep unvisited pings" queue. */
	queued: boolean
	lastMessageId: string | null
}

export interface RowPings {
	pings: Ping[]
	/** Whether `pings[0]` is guaranteed to be the first unread ping. */
	exact: boolean
	/** Message to open when no exact ping is known. */
	fallback?: string
}

interface RawMessage {
	id?: unknown
	channel_id?: string
	content?: string
	author?: { id?: string; username?: string; global_name?: string | null }
	attachments?: unknown[]
	embeds?: unknown[]
	mentions?: { id?: string }[]
	mention_roles?: string[]
	mention_everyone?: boolean
	mentioned?: boolean
}

interface Channel {
	id: string
	type: number
	guild_id?: string | null
	name?: string
	lastMessageId?: string | null
}

interface Http {
	get(request: {
		url: string
		query?: Record<string, string | number>
	}): Promise<{ body?: RawMessage[] }>
}

const PAGE_SIZE = 50
const MAX_PAGES = 8
const MAX_CHANNELS = 300
const PER_CHANNEL = 25
const PREVIEW_LENGTH = 160

const store = <T>(name: string) =>
	(Stores as unknown as Record<string, T | undefined>)[name]
const readStates = () =>
	store<{
		getMentionChannelIds?(): Iterable<string>
		getMentionCount(id: string): number
		getOldestUnreadMessageId?(id: string): string | null | undefined
		getLastAckedMessageId?(id: string): string | null | undefined
		lastMessageId?(id: string): string | null | undefined
	}>('ReadStateStore')
const channels = () =>
	store<{ getChannel(id: string): Channel | undefined }>('ChannelStore')
const users = () =>
	store<{
		getCurrentUser(): { id: string } | undefined
		getUser(
			id: string,
		): { username?: string; globalName?: string | null } | undefined
	}>('UserStore')

class Cancelled extends Error {}

/** Pings seen through MESSAGE_CREATE since the plugin started. */
const captured = new Map<string, Ping[]>()
/** "Keep unvisited pings": pings that were listed but not opened yet. */
const queue = new Map<string, Map<string, Ping>>()
const visited = new Map<string, Set<string>>()
const resolved = new Map<string, { key: string; value: RowPings }>()
const inflight = new Map<string, Promise<RowPings>>()
let generation = 0

const isDM = (channel: Channel | undefined) =>
	channel?.type === 1 || channel?.type === 3

function trim<K, V>(map: Map<K, V>) {
	while (map.size > MAX_CHANNELS) map.delete(map.keys().next().value as K)
}

export function resetPings() {
	generation++
	for (const map of [captured, queue, visited, resolved, inflight]) map.clear()
}

/* ---- message to ping ---- */

function pingContext(channel: Channel | undefined): PingContext | null {
	const me = users()?.getCurrentUser()?.id
	if (!me) return null
	const guildId = channel?.guild_id ?? undefined
	const settings = store<{
		isSuppressEveryoneEnabled?(guildId: string): boolean
		isSuppressRolesEnabled?(guildId: string): boolean
	}>('UserGuildSettingsStore')
	const member = guildId
		? store<{ getSelfMember?(guildId: string): { roles?: string[] } | null }>(
				'GuildMemberStore',
			)?.getSelfMember?.(guildId)
		: undefined
	return {
		me,
		dm: isDM(channel),
		roleIds: member?.roles ?? [],
		suppressEveryone:
			!!guildId && !!settings?.isSuppressEveryoneEnabled?.(guildId),
		suppressRoles: !!guildId && !!settings?.isSuppressRolesEnabled?.(guildId),
	}
}

function preview(message: RawMessage): string {
	const text = (message.content ?? '')
		.replace(/<@!?(\d+)>/g, (_, id: string) => {
			const user = users()?.getUser(id)
			return `@${user?.globalName || user?.username || 'user'}`
		})
		.replace(/<@&\d+>/g, '@role')
		.replace(
			/<#(\d+)>/g,
			(_, id: string) => `#${channels()?.getChannel(id)?.name ?? 'channel'}`,
		)
		.replace(/<a?:(\w+):\d+>/g, ':$1:')
		.replace(/\s+/g, ' ')
		.trim()
	if (text) return text.slice(0, PREVIEW_LENGTH)
	if (message.attachments?.length) return '(attachment)'
	return message.embeds?.length ? '(embed)' : ''
}

const toPing = (message: RawMessage): Ping => ({
	id: String(message.id),
	author: message.author?.global_name || message.author?.username || 'Unknown',
	text: preview(message),
})

export function capture(
	channelId: string | undefined,
	message: RawMessage | undefined,
) {
	const id = channelId ?? message?.channel_id
	if (!id || !message || !isSnowflake(message.id)) return
	const ctx = pingContext(channels()?.getChannel(id))
	if (!ctx || !isPing(message, ctx)) return
	const list = (captured.get(id) ?? []).filter(ping => ping.id !== message.id)
	list.push(toPing(message))
	captured.delete(id)
	captured.set(id, list.slice(-PER_CHANNEL))
	trim(captured)
	notify()
}

export function drop(channelId: string | undefined, messageId: string) {
	if (!channelId) return
	const list = captured.get(channelId)
	if (list)
		captured.set(
			channelId,
			list.filter(ping => ping.id !== messageId),
		)
	queue.get(channelId)?.delete(messageId)
	resolved.delete(channelId)
	notify()
}

/* ---- rows ---- */

const unvisited = (channelId: string): Ping[] =>
	[...(queue.get(channelId)?.values() ?? [])].sort((a, b) =>
		compareIds(a.id, b.id),
	)

/** Lower bound of the unread region: first unread message, else the one after the last ack. */
function unreadBound(channelId: string): string | null {
	const state = readStates()
	const oldest = state?.getOldestUnreadMessageId?.(channelId)
	if (isSnowflake(oldest)) return oldest
	const acked = state?.getLastAckedMessageId?.(channelId)
	return isSnowflake(acked) ? nextId(acked) : null
}

export function getRows(): Row[] {
	const state = readStates()
	if (!state) return []
	const { includeDMs, keepUnvisitedPings } = getSettings()
	if (!keepUnvisitedPings) queue.clear()
	const ids = new Set([
		...(state.getMentionChannelIds?.() ?? captured.keys()),
		...queue.keys(),
	])
	const rows: Row[] = []
	for (const channelId of ids) {
		const channel = channels()?.getChannel(channelId)
		if (!channel) continue
		const dm = isDM(channel)
		if (dm && !includeDMs) continue
		const pending = dm ? [] : unvisited(channelId)
		const count = pending.length || state.getMentionCount(channelId) || 0
		if (count <= 0) continue
		const last = channel.lastMessageId
		rows.push({
			channelId,
			dm,
			count,
			oldest: unreadBound(channelId),
			queued: pending.length > 0,
			lastMessageId: isSnowflake(last) ? last : null,
		})
	}
	// Most recently active chat first. Independent of resolution state, so the list never reorders itself.
	return rows.sort((a, b) =>
		compareIds(b.lastMessageId ?? '0', a.lastMessageId ?? '0'),
	)
}

export const totalOf = (rows: readonly Row[]) =>
	rows.reduce((sum, row) => sum + row.count, 0)

/* ---- finding the real ping messages ---- */

async function fetchMessages(
	channelId: string,
	query: Record<string, string | number>,
): Promise<RawMessage[]> {
	const [module] = lookupModule(withProps<{ HTTP: Http }>('HTTP'))
	if (!module?.HTTP) throw new Error('Discord REST client unavailable')
	const response = await module.HTTP.get({
		url: `/channels/${channelId}/messages`,
		query: { limit: PAGE_SIZE, ...query },
	})
	return (response.body ?? [])
		.filter(message => isSnowflake(message.id))
		.sort((a, b) => compareIds(String(a.id), String(b.id)))
}

async function scan(row: Row, epoch: number): Promise<RowPings> {
	const local = captured.get(row.channelId) ?? []
	const known = selectPings(local, row.oldest, row.count)
	if (known.length >= row.count) return { pings: known, exact: true }
	const ctx = pingContext(channels()?.getChannel(row.channelId))
	const fallback = row.oldest ?? undefined
	if (!ctx) return { pings: known, exact: false, fallback }

	const found: Ping[] = [...local]
	let complete = false
	// Walk forward from the first unread message; without one, walk back from the newest message.
	let cursor = row.oldest ? previousId(row.oldest) : null
	for (let page = 0; page < MAX_PAGES; page++) {
		const batch = await fetchMessages(
			row.channelId,
			row.oldest
				? { after: cursor as string }
				: cursor
					? { before: cursor }
					: {},
		)
		if (epoch !== generation) throw new Cancelled()
		for (const message of batch)
			if (isPing(message, ctx)) found.push(toPing(message))
		if (batch.length < PAGE_SIZE) {
			complete = true
			break
		}
		cursor = String((row.oldest ? batch[batch.length - 1] : batch[0]).id)
		if (!row.oldest && selectPings(found, null, row.count).length >= row.count)
			break
	}
	// Walking forward from the first unread message is contiguous, so the first ping found is the real first one.
	const pings = selectPings(
		found,
		row.oldest,
		row.oldest ? found.length : row.count,
	)
	return {
		pings,
		exact: isExact(pings, row.count, complete || row.oldest != null),
		fallback,
	}
}

/** First unread DM message: Discord's own marker, else the oldest message we can fetch. */
async function firstDmMessage(row: Row, epoch: number): Promise<RowPings> {
	if (row.oldest) return { pings: [], exact: false, fallback: row.oldest }
	const [oldest] = await fetchMessages(row.channelId, { limit: 1 })
	if (epoch !== generation) throw new Cancelled()
	return {
		pings: [],
		exact: false,
		fallback: oldest ? String(oldest.id) : undefined,
	}
}

function resolve(row: Row): Promise<RowPings> {
	const key = `${row.oldest}:${row.count}`
	const hit = resolved.get(row.channelId)
	if (hit?.key === key) return Promise.resolve(hit.value)
	const requestKey = `${row.channelId}:${key}`
	const pending = inflight.get(requestKey)
	if (pending) return pending
	const epoch = generation
	const request = (row.dm ? firstDmMessage(row, epoch) : scan(row, epoch))
		.then(value => {
			if (epoch === generation) {
				resolved.set(row.channelId, { key, value })
				trim(resolved)
			}
			return value
		})
		.finally(() => inflight.delete(requestKey))
	inflight.set(requestKey, request)
	return request
}

/** Everything needed to list or open a row's pings, always computed from current Discord state. */
export async function loadRow(row: Row): Promise<RowPings> {
	if (row.queued) {
		const pings = unvisited(row.channelId)
		return { pings, exact: pings.length > 0 }
	}
	let result: RowPings
	try {
		result = await resolve(row)
	} catch (error) {
		if (error instanceof Cancelled) return { pings: [], exact: false }
		result = { pings: [], exact: false, fallback: row.oldest ?? undefined }
	}
	if (!row.dm && getSettings().keepUnvisitedPings && result.pings.length) {
		const seen = visited.get(row.channelId)
		const pending = queue.get(row.channelId) ?? new Map<string, Ping>()
		for (const ping of result.pings)
			if (!seen?.has(ping.id)) pending.set(ping.id, ping)
		queue.set(row.channelId, pending)
		trim(queue)
	}
	return result
}

/* ---- opening ---- */

export function openMessage(
	row: Row,
	messageId: string | undefined,
	onError: (error: unknown) => void,
) {
	if (!row.dm && getSettings().keepUnvisitedPings && messageId) {
		const seen = visited.get(row.channelId) ?? new Set<string>()
		seen.add(messageId)
		visited.set(row.channelId, seen)
		queue.get(row.channelId)?.delete(messageId)
		trim(visited)
		notify()
	}
	closeSheetAndNavigate(row.channelId, messageId, onError)
}

/** Opens the first unread ping of a row. */
export async function openRow(row: Row, onError: (error: unknown) => void) {
	const { pings, exact, fallback } = await loadRow(row)
	openMessage(row, exact ? pings[0]?.id : fallback, onError)
}

/** Acknowledges the newest message, like Discord's own "mark as read". */
export function markRead(channelId: string) {
	const last =
		readStates()?.lastMessageId?.(channelId) ??
		channels()?.getChannel(channelId)?.lastMessageId
	if (!isSnowflake(last)) throw new Error('The latest message is unavailable')
	for (const map of [captured, queue, visited, resolved]) map.delete(channelId)
	Dispatcher.dispatch({
		type: 'BULK_ACK',
		context: 'APP',
		channels: [{ channelId, messageId: last, readStateType: 0 }],
	})
	notify()
}
