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
	ready?: boolean
	loadingMore?: boolean
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

const JUMP_STEP = 400
const JUMP_TRIES = 14

const findActions = () =>
	lookupModule(withProps<MessageActions>('jumpToMessage', 'fetchMessages'))[0]

/** Discord's own jump: loads the message window around the target, then scrolls and flashes. */
function discordJump(channelId: string, messageId: string) {
	findActions()?.jumpToMessage({
		channelId,
		messageId,
		flash: true,
		jumpType: 'ANIMATED',
	})
}

/** True once the message is loaded, is the jump target, and the channel is done loading. */
function landed(channelId: string, messageId: string) {
	const loaded = messageStore()?.getMessages?.(channelId)
	if (!loaded || loaded.ready === false || loaded.loadingMore) return false
	if (!loaded.has?.(messageId)) return false
	return 'jumpTargetId' in loaded ? loaded.jumpTargetId === messageId : true
}

/**
 * Jumps with Discord's own function once the channel is showing, because a jump requested while the
 * channel is still loading is overwritten by that load (latest messages or the unread marker).
 * The jump is repeated, at most every other step, until the target is loaded and is the jump target.
 */
function jumpWhenReady(channelId: string, messageId: string) {
	let tries = 0
	let lastJump = 0
	const next = () => {
		const timer = setTimeout(() => {
			timers.delete(timer)
			tries++
			if (selectedChannelStore()?.getChannelId() === channelId) {
				const settled = lastJump > 0 && Date.now() - lastJump >= JUMP_STEP * 2
				if (landed(channelId, messageId) && lastJump > 0) {
					if (settled) return
				} else if (lastJump === 0 || settled) {
					discordJump(channelId, messageId)
					lastJump = Date.now()
				}
			}
			if (tries < JUMP_TRIES) next()
		}, JUMP_STEP)
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

	const [router] = lookupModule(
		withProps<Router>('transitionToGuild', 'transitionTo'),
	)
	if (!router) throw new Error('Discord channel routing is unavailable')
	// The channel is always routed to (the chat can be hidden behind the channel list even when it is
	// the selected one). With Discord's jump available the route leaves the message id out and the
	// jump runs on the loaded channel; without it, the route carries the id as before.
	const canJump = !!findActions()
	router.transitionToGuild(
		channel.guild_id || '@me',
		channelId,
		canJump ? undefined : target,
		{ openChannel: true },
	)
	if (target && canJump) {
		if (selectedChannelStore()?.getChannelId() === channelId)
			discordJump(channelId, target)
		jumpWhenReady(channelId, target)
	}
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
