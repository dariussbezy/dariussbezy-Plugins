import {
	ActionSheetActionCreators,
	ToastActionCreators,
} from '@valenced/discord/actions'
import { Dispatcher } from '@valenced/discord/common/flux'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { createQueue } from './queue'
import { detectLanguage } from './quick-translate'
import { checkConnection, errorText, providerName, transcribe } from './service'
import { DefaultSettings, MaxTranscripts } from './shared'
import { ResultKey, ResultSheet } from './sheets'
import { stores } from './stores'
import { channelOf, durationOf, urlOf, voiceAttachment } from './voice'
import type { JsonStorage } from '@valenced/json-storage'
import type { Settings, Transcript } from './shared'
import type { VoiceMessage } from './voice'

export interface History {
	items: Transcript[]
}

interface Deps {
	settings: JsonStorage<Settings>
	history: JsonStorage<History>
	report(error: unknown): void
}

interface MessageCreate {
	message?: VoiceMessage
	optimistic?: boolean
	channelId?: string
}

const isDirectChannel = (type?: number) => type === 1 || type === 3

export function createRuntime({ settings: storage, history, report }: Deps) {
	const transcripts = new Map<string, Transcript>()
	const busy = new Set<string>()
	/** Messages whose row must be rebuilt on the next render, even without a transcript. */
	const dirty = new Set<string>()
	const controllers = new Set<AbortController>()
	const timers = new Set<ReturnType<typeof setTimeout>>()
	const listeners = new Set<() => void>()
	const queue = createQueue()
	let epoch = 0
	let disposed = false
	let toastCount = 0
	let version = 0

	const settings = () => ({ ...DefaultSettings, ...storage.cache }) as Settings
	const emit = () => {
		version++
		for (const listener of listeners) listener()
	}

	function toast(text: string) {
		ToastActionCreators.open(`dariuss.voice-messages-to-text.${++toastCount}`, {
			text,
		})
	}

	function refresh({ id, channelId }: Transcript) {
		dirty.add(id)
		while (dirty.size > MaxTranscripts)
			dirty.delete(dirty.values().next().value as string)
		// Same shape as Discord's own update, guild included.
		const guildId =
			(
				stores.ChannelStore?.getChannel(channelId) as
					| { guild_id?: string | null }
					| undefined
			)?.guild_id ?? undefined
		Dispatcher.dispatch({
			type: 'MESSAGE_UPDATE',
			guildId,
			message: { id, channel_id: channelId, guild_id: guildId },
		}).catch(report)
	}

	function persist() {
		while (transcripts.size > MaxTranscripts) {
			const [id, evicted] = transcripts.entries().next().value as [
				string,
				Transcript,
			]
			transcripts.delete(id)
			refresh(evicted)
		}
		emit()
		if (settings().saveTranscripts)
			history.set({ items: [...transcripts.values()] }, true).catch(report)
	}

	/** Runs `work` with a controller that `cancel()` can abort. */
	async function tracked<T>(work: (signal: AbortSignal) => Promise<T>) {
		const controller = new AbortController()
		controllers.add(controller)
		try {
			return await work(controller.signal)
		} finally {
			controllers.delete(controller)
		}
	}

	function cancel() {
		epoch++
		for (const controller of controllers) controller.abort()
		controllers.clear()
		queue.clear()
		busy.clear()
	}

	function show(id: string) {
		ActionSheetActionCreators.openLazy(
			Promise.resolve({ default: ResultSheet }),
			ResultKey,
			{ runtime, id },
		)
	}

	function remove(id: string) {
		const transcript = transcripts.get(id)
		if (!transcript) return
		transcripts.delete(id)
		persist()
		refresh(transcript)
	}

	async function transcribeMessage(message: VoiceMessage, automatic = false) {
		const { id } = message
		const attachment = voiceAttachment(message)
		const audioUrl = attachment && urlOf(attachment)
		if (!attachment || !audioUrl) {
			if (!automatic) toast('This is not a voice message')
			return
		}
		if (transcripts.has(id)) {
			if (!automatic) show(id)
			return
		}
		if (busy.has(id)) {
			if (!automatic) toast('Already transcribing this message')
			return
		}

		busy.add(id)
		const mine = epoch
		const stale = () => disposed || epoch !== mine
		const config = settings()
		try {
			const result = await queue.run(
				async () =>
					stale()
						? undefined
						: tracked(signal => transcribe(audioUrl, config, signal)),
				automatic,
			)
			if (stale() || !result) return

			const entry: Transcript = {
				id,
				channelId: channelOf(message),
				text: result.text,
				language: result.language,
				at: Date.now(),
				dur: durationOf(attachment),
				by: providerName(config),
			}
			transcripts.set(id, entry)
			persist()
			refresh(entry)

			if (entry.language === 'Unknown language') {
				const name = await tracked(signal =>
					detectLanguage(entry.text, automatic, signal),
				)
				if (stale() || transcripts.get(id) !== entry) return
				if (name) {
					entry.language = name
					persist()
				}
			}
			if (automatic) return
			toast(`Transcribed with ${entry.by} · from ${entry.language}`)
			const { card, inline } = settings()
			if (card || !inline || !runtime.inlineReady) show(id)
		} catch (error) {
			if (!stale() && !automatic)
				toast(`Transcription failed: ${errorText(error)}`)
		} finally {
			if (!stale()) busy.delete(id)
		}
	}

	const runtime = {
		transcripts,
		dirty,
		settings,
		toast,
		show,
		remove,
		persist,
		/** Set by the row patch once transcripts can be shown under the voice message. */
		inlineReady: false,
		transcribe: transcribeMessage,

		subscribe(listener: () => void) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		snapshot: () => version,

		load() {
			const saved = history.cache?.items
			if (!settings().saveTranscripts || !Array.isArray(saved)) return
			for (const item of saved.slice(-MaxTranscripts))
				if (item?.id && typeof item.text === 'string')
					transcripts.set(item.id, item)
		},

		refreshAll() {
			for (const transcript of transcripts.values()) refresh(transcript)
		},

		/** Drops the saved history when the user turns persistence off. */
		forgetSaved() {
			history.set({ items: [] }, true).catch(report)
		},

		copy(text: string) {
			try {
				Clipboard.setString(text)
				toast('Copied')
			} catch {
				toast('Could not copy')
			}
		},

		again(id: string) {
			const transcript = transcripts.get(id)
			if (!transcript) return
			const message = stores.MessageStore.getMessage(transcript.channelId, id)
			if (!message) return toast('Open the chat with this message first')
			remove(id)
			const timer = setTimeout(() => {
				timers.delete(timer)
				void transcribeMessage(message)
			}, 250)
			timers.add(timer)
		},

		clear() {
			const all = [...transcripts.values()]
			cancel()
			transcripts.clear()
			history.set({ items: [] }, true).catch(report)
			for (const transcript of all) refresh(transcript)
			emit()
			toast('Transcripts cleared')
		},

		async testConnection() {
			const mine = epoch
			let message: string
			try {
				message = await tracked(signal => checkConnection(settings(), signal))
			} catch (error) {
				message = errorText(error)
			}
			if (!disposed && epoch === mine) toast(message)
		},

		/** Flux MESSAGE_CREATE handler for the automatic mode. */
		onMessageCreate({ message, optimistic, channelId }: MessageCreate) {
			const { auto } = settings()
			if (!message || optimistic || auto === 'off' || !voiceAttachment(message))
				return
			if (message.author?.id === stores.UserStore.getCurrentUser()?.id) return
			const channel = stores.ChannelStore.getChannel(
				channelOf(message) || channelId || '',
			)
			if (auto === 'dms' && !isDirectChannel(channel?.type)) return
			void transcribeMessage(message, true)
		},

		/** Must run while the row patch is still installed, so rows drop their transcript. */
		dispose() {
			disposed = true
			cancel()
			for (const timer of timers) clearTimeout(timer)
			timers.clear()
			const all = [...transcripts.values()]
			transcripts.clear()
			for (const transcript of all) refresh(transcript)
			listeners.clear()
			ActionSheetActionCreators.hideActionSheet(ResultKey)
		},
	}
	return runtime
}

export type Runtime = ReturnType<typeof createRuntime>

let current: Runtime | undefined
export const getRuntime = () => current
export function setRuntime(runtime?: Runtime) {
	current = runtime
}
