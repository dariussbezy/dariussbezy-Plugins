// Pure helpers: no Discord imports, so they can be unit tested in isolation.

export interface Ping {
	id: string
	author: string
	text: string
	/** A reply to you that does not mention you. */
	reply?: boolean
}

interface MessageLike {
	id?: unknown
	author?: { id?: unknown } | null
	mentions?: ({ id?: unknown } | string)[] | null
	mention_roles?: string[] | null
	mention_everyone?: boolean
	mentioned?: boolean
	referenced_message?: { author?: { id?: unknown } | null } | null
}

export interface PingContext {
	me: string
	dm: boolean
	roleIds: readonly string[]
	suppressEveryone: boolean
	suppressRoles: boolean
	/** Count replies to your messages even when they do not mention you. */
	includeReplies?: boolean
	excludeEveryone?: boolean
	/** All role pings count, all except the listed roles, or only the listed roles. */
	roleMode?: RoleMode
	roleList?: readonly string[]
}

export type RoleMode = 'all' | 'except' | 'only'

const DISCORD_EPOCH = 1420070400000n

export const isSnowflake = (value: unknown): value is string =>
	typeof value === 'string' && /^\d{15,21}$/.test(value)

/** Snowflakes exceed Number.MAX_SAFE_INTEGER, so they must be compared as BigInt. */
export function compareIds(a: string, b: string): number {
	const x = BigInt(a)
	const y = BigInt(b)
	return x < y ? -1 : x > y ? 1 : 0
}

export const previousId = (id: string) => (BigInt(id) - 1n).toString()

export const nextId = (id: string) => (BigInt(id) + 1n).toString()

export const snowflakeTime = (id: string) =>
	Number((BigInt(id) >> 22n) + DISCORD_EPOCH)

const pad = (n: number) => String(n).padStart(2, '0')

export function formatTime(ms: number, now = new Date()): string {
	const date = new Date(ms)
	const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
	return date.toDateString() === now.toDateString()
		? time
		: `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${time}`
}

/** Mirrors what Discord counts as an unread mention, so local data agrees with its counters. */
export function isPing(message: MessageLike, ctx: PingContext): boolean {
	if (!isSnowflake(message.id) || message.author?.id === ctx.me) return false
	if (ctx.dm) return true
	const mentioned = (message.mentions ?? []).some(
		user => (typeof user === 'string' ? user : user?.id) === ctx.me,
	)
	if (mentioned) return true
	// Discord's own flag also covers @everyone and roles, so it is not trusted while those are excluded.
	if (
		message.mentioned === true &&
		!ctx.excludeEveryone &&
		(ctx.roleMode ?? 'all') === 'all'
	)
		return true
	if (message.mention_everyone && !ctx.suppressEveryone && !ctx.excludeEveryone)
		return true
	return (
		!ctx.suppressRoles &&
		(message.mention_roles ?? []).some(
			role =>
				ctx.roleIds.includes(role) &&
				(ctx.roleMode === 'except'
					? !ctx.roleList?.includes(role)
					: ctx.roleMode === 'only'
						? !!ctx.roleList?.includes(role)
						: true),
		)
	)
}

/** A reply to one of your messages that was sent without pinging you. */
export const isQuietReply = (message: MessageLike, ctx: PingContext) =>
	ctx.includeReplies === true &&
	!ctx.dm &&
	isSnowflake(message.id) &&
	message.author?.id !== ctx.me &&
	message.referenced_message?.author?.id === ctx.me

/**
 * Pings that Discord still counts as unread: dedupe, drop everything older than
 * the first unread message, order oldest first and keep the newest `count`.
 */
export function selectPings(
	pings: readonly Ping[],
	oldestUnread: string | null,
	count: number,
): Ping[] {
	const unique = new Map<string, Ping>()
	for (const ping of pings) {
		if (!isSnowflake(ping.id)) continue
		if (oldestUnread && compareIds(ping.id, oldestUnread) < 0) continue
		unique.set(ping.id, ping)
	}
	const sorted = [...unique.values()].sort((a, b) => compareIds(a.id, b.id))
	return count > 0 ? sorted.slice(-count) : []
}

/** Whether `pings[0]` is really the first unread ping rather than just the first one we found. */
export const isExact = (
	pings: readonly Ping[],
	count: number,
	complete: boolean,
) => pings.length > 0 && (complete || pings.length >= count)
