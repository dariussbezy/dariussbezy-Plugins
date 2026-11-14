import type { Transcript } from './shared'

export interface MenuAction {
	key: string
	label: string
	press(): void
}

interface Translation {
	text?: string
	color?: number | string
	sourceLabel?: string
	immersive?: boolean
}

/** Optional integration exposed by the Quick Translate plugin. */
interface Bridge {
	isActive(): boolean
	getMessageActions(message: {
		id: string
		channel_id: string
		content: string
	}): MenuAction[]
	getMessageTranslation?(id: string): Translation | undefined
	detectLanguage?(
		text: string,
		options: { automatic: boolean; signal: AbortSignal },
	): Promise<{ name?: string } | undefined>
}

function bridge() {
	const scope = globalThis as {
		__valencedQuickTranslateTextBridge?: Bridge
		__rainQuickTranslateTextBridge?: Bridge
	}
	try {
		const found =
			scope.__valencedQuickTranslateTextBridge ??
			scope.__rainQuickTranslateTextBridge
		return found?.isActive() ? found : undefined
	} catch {}
}

export function translationActions(transcript: Transcript): MenuAction[] {
	try {
		const actions = bridge()?.getMessageActions({
			id: transcript.id,
			channel_id: transcript.channelId,
			content: transcript.text,
		})
		return Array.isArray(actions) ? actions : []
	} catch {
		return []
	}
}

export function translationOf(id: string): Translation | undefined {
	try {
		const translation = bridge()?.getMessageTranslation?.(id)
		return translation?.text?.trim() ? translation : undefined
	} catch {}
}

/** Asks Quick Translate to name the language; resolves undefined when unavailable. */
export async function detectLanguage(
	text: string,
	automatic: boolean,
	signal: AbortSignal,
) {
	try {
		const quickTranslate = bridge()
		return (await quickTranslate?.detectLanguage?.(text, { automatic, signal }))
			?.name
	} catch {}
}
