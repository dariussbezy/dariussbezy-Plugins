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

interface LoadedMessages {
	jumpTargetId?: string | null
	has?(id: string): boolean
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

const messageStore = () =>
	Stores.MessageStore as unknown as
		| { getMessages?(id: string): LoadedMessages | undefined }
		| undefined

const REINFORCE_STEP = 450
const REINFORCE_TRIES = 8

/**
 * Discord can open a channel on its own marker (the oldest unread message) after the jump was
 * requested, and a jump inside the open channel can be dropped while its messages are still loading.
 * Once the channel is showing, the jump is asked for again until the target is the one it landed on.
 */
function reinforce(channelId: string, messageId: string) {
	let tries = 0
	const next = () => {
		const timer = setTimeout(() => {
			timers.delete(timer)
			tries++
			if (selectedChannelStore()?.getChannelId() === channelId) {
				const loaded = messageStore()?.getMessages?.(channelId)
				const landed =
					loaded && 'jumpTargetId' in loaded
						? loaded.jumpTargetId === messageId
						: !!loaded?.has?.(messageId)
				if (landed) return
				const [actions] = lookupModule(
					withProps<MessageActions>('jumpToMessage', 'fetchMessages'),
				)
				actions?.jumpToMessage({
					channelId,
					messageId,
					flash: true,
					jumpType: 'ANIMATED',
				})
			}
			if (tries < REINFORCE_TRIES) next()
		}, REINFORCE_STEP)
		timers.add(timer)
	}
	next()
}

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

	// The channel can still be the selected one while the chat is hidden behind the channel list,
	// so it is always routed to (which brings the chat on screen) before jumping.
	const sameChannel = selectedChannelStore()?.getChannelId() === channelId
	const [router] = lookupModule(
		withProps<Router>('transitionToGuild', 'transitionTo'),
	)
	if (!router) throw new Error('Discord channel routing is unavailable')
	router.transitionToGuild(channel.guild_id || '@me', channelId, target, {
		openChannel: true,
	})
	if (!target) return
	// Routing to the channel that is already selected does not reload around the message.
	if (sameChannel) {
		const [actions] = lookupModule(
			withProps<MessageActions>('jumpToMessage', 'fetchMessages'),
		)
		actions?.jumpToMessage({
			channelId,
			messageId: target,
			flash: true,
			jumpType: 'ANIMATED',
		})
	}
	reinforce(channelId, target)
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
