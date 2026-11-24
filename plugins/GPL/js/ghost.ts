import { Stores } from '@valenced/discord/flux'
import type { Entry, PingInfo } from '../../AML/js/types'
import type { Settings } from './shared'

type MemberStore = {
	getMember(guildId: string, userId: string): { roles?: string[] } | undefined
}
type UserStore = { getCurrentUser(): { id: string } | undefined }
type GuildSettings = {
	isSuppressEveryoneEnabled?(guildId: string): boolean
	isSuppressRolesEnabled?(guildId: string): boolean
}

const currentUserId = () =>
	(Stores as unknown as { UserStore?: UserStore }).UserStore?.getCurrentUser()
		?.id

function myRoles(guildId: string, userId: string) {
	if (!guildId) return []
	return (
		(
			Stores as unknown as { GuildMemberStore?: MemberStore }
		).GuildMemberStore?.getMember(guildId, userId)?.roles ?? []
	)
}

/** Whether a message pings the current user, for the ping types the user enabled. */
function pings(info: PingInfo, guildId: string, settings: Settings) {
	const me = currentUserId()
	if (!me) return false
	// Like Discord's own check: your "Suppress @everyone" and "Suppress roles" server settings
	// mean those never pinged you.
	const guild = (
		Stores as unknown as { UserGuildSettingsStore?: GuildSettings }
	).UserGuildSettingsStore
	const suppressEveryone =
		!!guildId && !!guild?.isSuppressEveryoneEnabled?.(guildId)
	const suppressRoles = !!guildId && !!guild?.isSuppressRolesEnabled?.(guildId)
	const mentionsMe = info.mentions.includes(me)
	return (
		(settings.direct && (info.mentioned || mentionsMe)) ||
		// A reply pings only when its mention was left on, which puts you in its mentions.
		(settings.replies && info.replyTo === me && mentionsMe) ||
		(settings.everyone && info.everyone && !suppressEveryone) ||
		(settings.roles &&
			!suppressRoles &&
			info.roles.some(role => myRoles(guildId, me).includes(role)))
	)
}

/**
 * A ghost ping is a message that pinged you and was then deleted, or edited so
 * it no longer does. The journal itself comes from Adv. Message Logger.
 */
export function isGhostPing(entry: Entry, settings: Settings) {
	const { before, after } = entry
	if (
		before.authorId === currentUserId() ||
		!pings(before, before.guildId, settings)
	)
		return false
	return !(after && pings(after, before.guildId, settings))
}
