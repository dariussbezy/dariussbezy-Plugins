const VoiceMessageFlag = 8192
const AudioFile = /\.(ogg|opus|mp3|m4a|wav)$/i

export interface Attachment {
	url?: string
	proxy_url?: string
	proxyURL?: string
	content_type?: string
	contentType?: string
	filename?: string
	waveform?: string
	duration_secs?: number
	durationSecs?: number
}

export interface VoiceMessage {
	id: string
	channel_id?: string
	channelId?: string
	flags?: number
	attachments?: Attachment[]
	author?: { id: string }
}

const isAudio = (a: Attachment) =>
	(a.content_type ?? a.contentType ?? '').toLowerCase().startsWith('audio/') ||
	AudioFile.test(a.filename ?? '')

export const durationOf = (a: Attachment) =>
	a.duration_secs ?? a.durationSecs ?? 0

export const urlOf = (a: Attachment) => a.url ?? a.proxy_url ?? a.proxyURL

export const channelOf = (m: VoiceMessage) => m.channel_id ?? m.channelId ?? ''

/** The voice attachment of a message, or undefined when it is not a voice message. */
export function voiceAttachment(message?: VoiceMessage) {
	const attachments = Array.isArray(message?.attachments)
		? message.attachments
		: []
	const voice = attachments.find(
		a => a.waveform || (isAudio(a) && durationOf(a) > 0),
	)
	if (voice) return voice
	if (((message?.flags ?? 0) & VoiceMessageFlag) === VoiceMessageFlag)
		return attachments.find(isAudio) ?? attachments[0]
}
