import { ActionSheetActionCreators } from '@valenced/discord/actions'
import { Stores } from '@valenced/discord/flux'
import { lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { isSnowflake } from './logic'

interface Router {
	transitionTo(path: string): void
	transitionToGuild(
		guildId: string,
		channelId?: string,
		messageId?: string,
		options?: { openChannel?: boolean },
	): void
}

interface MessageActions {
	fetchMessages(options: unknown): unknown
	jumpToMessage(options: {
		channelId: string
		messageId: string
		flash?: boolean
		jumpType?: string
	}): void
}

interface Channel {
	id: string
	guild_id?: string | null
}

export const SHEET_KEY = 'dariuss.jump-to-ping'
const SHEET_CLOSE_DELAY = 220

const timers = new Set<ReturnType<typeof setTimeout>>()

const channelStore = () =>
	Stores.ChannelStore as unknown as
		| { getChannel(id: string): Channel | undefined }
		| undefined
const selectedChannelStore = () =>
	Stores.SelectedChannelStore as unknown as
		| { getChannelId(): string | null | undefined }
		| undefined

/**
 * Navigates to a channel, optionally to a specific message.
 *
 * The guild always comes from the channel itself (never from a cached row), DMs
 * use `@me`, and the message id is only used when it is a valid snowflake.
 */
export function navigate(channelId: string, messageId?: string) {
	const channel = channelStore()?.getChannel(channelId)
	if (!channel) throw new Error('The target channel is no longer available')
	const target = isSnowflake(messageId) ? messageId : undefined

	// Routing to the channel that is already open does not reload around the message.
	if (target && selectedChannelStore()?.getChannelId() === channelId) {
		const [actions] = lookupModule(
			withProps<MessageActions>('jumpToMessage', 'fetchMessages'),
		)
		if (actions) {
			actions.jumpToMessage({
				channelId,
				messageId: target,
				flash: true,
				jumpType: 'ANIMATED',
			})
			return
		}
	}

	const [router] = lookupModule(
		withProps<Router>('transitionToGuild', 'transitionTo'),
	)
	if (!router) throw new Error('Discord channel routing is unavailable')
	router.transitionToGuild(channel.guild_id || '@me', channelId, target, {
		openChannel: true,
	})
}

/** Closes the ping sheet first so its dismissal cannot swallow the navigation. */
export function closeSheetAndNavigate(
	channelId: string,
	messageId: string | undefined,
	onError: (error: unknown) => void,
) {
	ActionSheetActionCreators.hideActionSheet(SHEET_KEY)
	const timer = setTimeout(() => {
		timers.delete(timer)
		try {
			navigate(channelId, messageId)
		} catch (error) {
			onError(error)
		}
	}, SHEET_CLOSE_DELAY)
	timers.add(timer)
}

export function cancelNavigation() {
	for (const timer of timers) clearTimeout(timer)
	timers.clear()
}
