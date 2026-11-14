import { Stores } from '@valenced/discord/flux'
import type { VoiceMessage } from './voice'

interface TypedStores {
	MessageStore: {
		getMessage(channelId: string, id: string): VoiceMessage | undefined
	}
	ChannelStore: { getChannel(id: string): { type?: number } | undefined }
	UserStore: { getCurrentUser(): { id: string } | undefined }
	ThemeStore: { theme: string }
}

/** The Discord stores this plugin reads, with the members it uses. */
export const stores = Stores as unknown as TypedStores
