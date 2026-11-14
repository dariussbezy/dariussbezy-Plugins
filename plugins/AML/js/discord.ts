import { Stores } from '@valenced/discord/flux'
import { lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import type { IgnoreScope } from './types'

type Named = { username?: string; globalName?: string; global_name?: string }

export type Channel = {
	id?: string
	guild_id?: string
	guildId?: string
	name?: string
	type?: number
	recipients?: string[]
}

export type RawMessage = {
	id?: string
	channel_id?: string
	channelId?: string
	guild_id?: string
	guildId?: string
	author?: { id?: string; username?: string; bot?: boolean }
	content?: string
	mentions?: (
		| string
		| { id?: string; username?: string; global_name?: string }
	)[]
	mentioned?: boolean
	mention_roles?: string[]
	mentionRoles?: string[]
	mention_everyone?: boolean
	mentionEveryone?: boolean
	message_reference?: { message_id?: string; channel_id?: string } | null
	messageReference?: { messageId?: string; channelId?: string } | null
	referenced_message?: { author?: { id?: string } } | null
	referencedMessage?: { author?: { id?: string } } | null
}

type AppStores = {
	ChannelStore: { getChannel(id: string): Channel | undefined }
	UserStore: {
		getCurrentUser(): { id: string } | undefined
		getUser(id: string): Named | undefined
	}
	GuildStore: { getGuild(id: string): { name?: string } | undefined }
	MessageStore: {
		getMessage(
			channelId: string,
			id: string,
		): (RawMessage & { state?: string; flags?: number }) | undefined
		getMessages(channelId: string): { length?: number } | undefined
	}
	SelectedChannelStore: { getChannelId(): string | undefined }
}

const stores = () => Stores as unknown as Partial<AppStores>

export const getChannel = (id: string) => stores().ChannelStore?.getChannel(id)
export const getMessage = (channelId: string, id: string) =>
	stores().MessageStore?.getMessage(channelId, id)
export const getGuildName = (id: string) =>
	stores().GuildStore?.getGuild(id)?.name
export const getCurrentUserId = () => stores().UserStore?.getCurrentUser()?.id

export const isDirect = (channel: Channel | undefined) =>
	channel?.type === 1 || channel?.type === 3
export const guildOf = (channelId: string) => {
	const channel = getChannel(channelId)
	return channel?.guild_id ?? channel?.guildId ?? ''
}

export function userName(id: string) {
	const user = stores().UserStore?.getUser(id)
	return user?.globalName ?? user?.global_name ?? user?.username
}

/** Whether Discord currently holds messages for this channel. */
export function isLoaded(channelId: string) {
	if (stores().SelectedChannelStore?.getChannelId() === channelId) return true
	const bucket = stores().MessageStore?.getMessages(channelId)
	return typeof bucket?.length === 'number' && bucket.length > 0
}

/** A display name for something that can be ignored: user, DM, channel or server. */
export function describeTarget(id: string, requested?: IgnoreScope) {
	const channel = getChannel(id)
	const guildName = getGuildName(id)
	const user = userName(id)
	const scope =
		requested ??
		(channel
			? isDirect(channel)
				? 'DM'
				: 'channel'
			: guildName
				? 'server'
				: user
					? 'user'
					: undefined)
	const recipients = channel?.recipients
		?.map(userName)
		.filter(Boolean)
		.join(', ')
	const name =
		scope === 'DM'
			? (channel?.name ?? recipients)
			: scope === 'channel'
				? channel?.name
				: scope === 'server'
					? guildName
					: user
	return { scope, name }
}

type Router = {
	transitionTo(...args: unknown[]): void
	transitionToGuild(
		guildId: string,
		channelId: string,
		messageId?: string,
		options?: { openChannel?: boolean },
	): void
}

/**
 * Opens a message in its chat. The guild always comes from the channel itself:
 * a guild id saved with the message can be empty or stale and would otherwise
 * open the right message id inside the wrong place.
 * @returns false when the channel or Discord's router is unavailable.
 */
export function jumpToMessage(channelId: string, messageId: string) {
	const channel = getChannel(channelId)
	const [router] = lookupModule(
		withProps<Router>('transitionToGuild', 'transitionTo'),
	)
	if (!channel || typeof router?.transitionToGuild !== 'function') return false
	const guildId = isDirect(channel)
		? '@me'
		: (channel.guild_id ?? channel.guildId ?? '@me')
	router.transitionToGuild(guildId, channelId, messageId, { openChannel: true })
	return true
}
