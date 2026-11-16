import { Stores } from '@valenced/discord/flux'
import { instead } from '@valenced/patcher'
import SettingsComponent from './settings'
import { DefaultSettings } from './shared'
import type { Settings } from './shared'

// Discord channel types: 1 = 1:1 DM, 3 = group DM
const DM = 1
const GROUP_DM = 3

interface MessageLike {
	author?: { id?: string }
	authorId?: string
	author_id?: string
	mentions?: (string | { id?: string })[]
	mention_everyone?: boolean
	mentionEveryone?: boolean
	channel_id?: string
	channelId?: string
}

interface RelationshipStoreLike {
	isBlockedForMessage: (message: MessageLike) => boolean
	isIgnoredForMessage: (message: MessageLike) => boolean
}

interface UserStoreLike {
	getCurrentUser(): { id: string } | undefined
}

interface ChannelStoreLike {
	getChannel(id: string): { type?: number } | undefined
}

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: { load: true, default: DefaultSettings },
	start({ cleanup, jsonStorage, logger }) {
		const relationships = Stores.RelationshipStore as unknown as
			| RelationshipStoreLike
			| undefined
		const channels = Stores.ChannelStore as unknown as
			| ChannelStoreLike
			| undefined

		const users = Stores.UserStore as unknown as UserStoreLike | undefined

		if (!relationships || !channels) {
			logger.warn('RelationshipStore or ChannelStore not found')
			return
		}

		const pingsMe = (message: MessageLike) => {
			if (message.mention_everyone ?? message.mentionEveryone) return true
			const me = users?.getCurrentUser()?.id
			return (
				!!me &&
				!!message.mentions?.some(
					mention =>
						(typeof mention === 'string' ? mention : mention.id) === me,
				)
			)
		}

		// Server channels and threads always; group chats and 1:1 DMs by setting.
		const shouldShow = (
			message: MessageLike | undefined,
			key: 'blocked' | 'ignored',
		) => {
			try {
				const settings = { ...DefaultSettings, ...jsonStorage.cache }
				if (!settings[key] || !message) return false
				const authorId =
					message.author?.id ?? message.authorId ?? message.author_id
				if (authorId && settings.excluded?.includes(authorId)) return false
				// Pings off: messages that mention you keep Discord's behaviour
				if (!settings.pings && pingsMe(message)) return false
				const channelId = message.channel_id ?? message.channelId
				if (!channelId) return false
				const type = channels.getChannel(channelId)?.type
				// Unknown channel: keep Discord's behaviour
				if (type === undefined) return false
				if (type === DM) return settings.directMessages
				if (type === GROUP_DM) return settings.groupChats
				return true
			} catch (error) {
				logger.error('shouldShow failed', error)
				return false
			}
		}

		const patch = (
			method: 'isBlockedForMessage' | 'isIgnoredForMessage',
			key: 'blocked' | 'ignored',
		) => {
			if (typeof relationships[method] !== 'function') {
				logger.warn(`RelationshipStore.${method} not found`)
				return () => {}
			}
			return instead(relationships, method, function (args, orig) {
				if (shouldShow(args[0], key)) return false
				return Reflect.apply(orig, this, args)
			})
		}

		cleanup(
			patch('isBlockedForMessage', 'blocked'),
			patch('isIgnoredForMessage', 'ignored'),
		)
	},
	SettingsComponent,
})
