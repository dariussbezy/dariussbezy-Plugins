import { getModuleWithImportedPath } from '@valenced/discord/utils/modules/finders'
import { before, instead } from '@valenced/patcher'
import { TextInput } from 'react-native'
import { getArmed, setArmed } from './draft'
import {
	currentChannelId,
	findByProps,
	getChannel,
	getUser,
	isDM,
	toast,
	userName,
} from './env'
import { assertCurrent, currentGeneration, isRunning } from './runtime'
import { languageName } from './shared'
import { getSettings, updateSettings } from './store'
import { notifyTranslated, translate } from './translate'
import type { ChatLanguages } from './shared'

type Change = (text: string) => void
interface InputInstance {
	setNativeProps?(props: { text: string }): void
}
/** Discord's chat input ref; the exposed methods differ between builds. */
interface ComposerRef {
	getText?(): string
	getValue?(): string
	text?: string
	value?: string
	props?: { value?: string }
	setText?(text: string): void
	setValue?(text: string): void
	setNativeProps?(props: { text: string }): void
	clear?(): void
	insertText?(text: string): void
}

/** The chat TextInput as last rendered: its current text, change handler and native instance. */
const input: {
	text: string
	change: Change | null
	instance: InputInstance | null
	seen: number
	/** The part of the draft the user has selected, if any. */
	selection: { start: number; end: number } | null
	/** Clears the selection a moment after it collapses, unless the box was left in between. */
	dropTimer: ReturnType<typeof setTimeout> | null
	/** When the box was last left; a collapse right after it is the platform's, not the user's. */
	blurredAt: number
	captured: boolean
} = {
	text: '',
	change: null,
	instance: null,
	seen: 0,
	selection: null,
	dropTimer: null,
	blurredAt: 0,
	captured: false,
}
let lastOriginal: { text: string; channelId: string | null } | null = null
let lastChannelId: string | null = null
const refWrappers = new WeakMap<
	object,
	(instance: InputInstance | null) => void
>()

const DROP_DELAY_MS = 700
const AFTER_BLUR_MS = 2000

/** Picks a selection range out of whatever shape a selection event has. */
function rangeOf(event: unknown) {
	const top = event as Record<string, unknown> | null | undefined
	const native = (top?.nativeEvent ?? top) as
		| Record<string, unknown>
		| undefined
	const box = (native?.selection ?? native) as
		| Record<string, unknown>
		| undefined
	const start = box?.start ?? box?.selectionStart ?? box?.from
	const end = box?.end ?? box?.selectionEnd ?? box?.to
	return typeof start === 'number' && typeof end === 'number'
		? { start, end }
		: null
}

function noteSelection(start: number, end: number) {
	if (end > start) {
		keepSelection(start, end)
	} else if (Date.now() - input.blurredAt >= AFTER_BLUR_MS) {
		// Leaving the box collapses the selection; the one made before leaving still counts.
		dropSelectionSoon()
	}
}

function cancelDrop() {
	if (input.dropTimer) clearTimeout(input.dropTimer)
	input.dropTimer = null
}

function keepSelection(start: number, end: number) {
	cancelDrop()
	input.selection = { start, end }
}

function dropSelection() {
	cancelDrop()
	input.selection = null
}

/** An empty selection also happens right before the box is left, so it only counts if nothing else follows. */
function dropSelectionSoon() {
	cancelDrop()
	input.dropTimer = setTimeout(dropSelection, DROP_DELAY_MS)
}

export const hasRestorableDraft = () => lastOriginal !== null

/** A selection read from Discord's composer ref, in case the chat box never reported one. */
function refSelection() {
	try {
		const ref = composerRef() as Record<string, unknown> | undefined
		const found =
			(typeof ref?.getSelection === 'function'
				? ref.getSelection()
				: undefined) ??
			(typeof ref?.getSelectedRange === 'function'
				? ref.getSelectedRange()
				: undefined) ??
			ref?.selection
		const range = rangeOf({ selection: found })
		return range && range.end > range.start ? range : null
	} catch {
		return null
	}
}

/** The selected part of the draft, when the setting is on and the selection still fits the text. */
function selectedRange(text: string) {
	const range = input.selection ?? refSelection()
	if (!getSettings().translateSelection || !range) return null
	if (range.end <= range.start || range.end > text.length) return null
	if (!text.slice(range.start, range.end).trim()) return null
	return range
}

export const getDraftText = () => readInput()
export const getDraftSelection = () => selectedRange(readInput())
export const hasSelection = () => selectedRange(readInput()) !== null

/* ----------------------------- per-chat languages ---------------------------- */

export function getChatLanguages(
	channelId = currentChannelId(),
): ChatLanguages {
	const settings = getSettings()
	const stored =
		channelId && settings.rememberLanguagesPerChat
			? settings.chatLanguages[channelId]
			: undefined
	return {
		sourceOut: stored?.sourceOut || settings.sourceOut || 'auto',
		targetOut: stored?.targetOut || settings.targetOut || 'en',
	}
}

export function saveChatLanguages(
	channelId: string | null,
	patch: Partial<ChatLanguages>,
) {
	const settings = getSettings()
	if (!channelId || !settings.rememberLanguagesPerChat)
		return updateSettings(patch)
	updateSettings({
		chatLanguages: {
			...settings.chatLanguages,
			[channelId]: { ...getChatLanguages(channelId), ...patch },
		},
	})
}

/* -------------------------------- input bridge -------------------------------- */

function isChatInput(props: Record<string, unknown>) {
	const placeholder =
		typeof props.placeholder === 'string' ? props.placeholder : ''
	if (
		/^(message|mesaj|mensaje|nachricht|messag|написать|сообщение)/i.test(
			placeholder,
		)
	)
		return true
	const channel = getChannel(currentChannelId())
	if (!channel) return false
	const name = isDM(channel)
		? channel.name || userName(getUser(channel.recipients?.[0] ?? ''))
		: channel.name
	if (
		name &&
		name !== 'Unknown' &&
		placeholder.toLowerCase().includes(name.toLowerCase())
	)
		return true
	// Discord's composer is a multiline, send-enabled input, including in DMs where the placeholder may be omitted.
	return (
		!!props.multiline &&
		typeof props.onChangeText === 'function' &&
		(typeof props.onSubmitEditing === 'function' ||
			props.returnKeyType === 'send' ||
			props.maxLength === 2000)
	)
}

/** Captures the chat TextInput's value, change handler and instance. */
export function patchTextInput() {
	const target = TextInput as unknown as {
		render?: (...args: unknown[]) => unknown
	}
	if (typeof target.render !== 'function') return () => {}
	const render = target as Record<string, (...args: unknown[]) => unknown>
	return before(render, 'render', args => {
		const [props, ref] = args as [Record<string, unknown> | undefined, unknown]
		if (!props || !isChatInput(props)) return args
		input.seen = Date.now()
		if (!input.captured) {
			input.captured = true
		}
		const original =
			typeof props.onChangeText === 'function'
				? (props.onChangeText as Change)
				: null
		input.change = original
		if (typeof props.value === 'string') input.text = props.value
		const holder =
			ref && typeof ref === 'object' ? (ref as { current: unknown }) : null
		let wrapped = holder ? refWrappers.get(holder) : undefined
		if (!wrapped) {
			wrapped = instance => {
				input.instance = instance
				if (typeof ref === 'function') ref(instance)
				else if (holder) holder.current = instance
			}
			if (holder) refWrappers.set(holder, wrapped)
		}
		const originalSelection =
			typeof props.onSelectionChange === 'function'
				? (props.onSelectionChange as (event: unknown) => void)
				: null
		const originalBlur =
			typeof props.onBlur === 'function'
				? (props.onBlur as (event: unknown) => void)
				: null
		const originalFocus =
			typeof props.onFocus === 'function'
				? (props.onFocus as (event: unknown) => void)
				: null
		return [
			{
				...props,
				onChangeText: (text: string) => {
					input.text = text
					// Offsets of an earlier selection no longer match the new text.
					dropSelection()
					original?.(text)
				},
				onSelectionChange: (event: {
					nativeEvent?: { selection?: { start?: number; end?: number } }
				}) => {
					const range = rangeOf(event)
					if (range) noteSelection(range.start, range.end)

					originalSelection?.(event)
				},
				onFocus: (event: unknown) => {
					originalFocus?.(event)
				},
				onBlur: (event: unknown) => {
					cancelDrop()
					input.blurredAt = Date.now()
					originalBlur?.(event)
				},
			},
			wrapped,
		]
	})
}

const composerRef = () => {
	const channelId = currentChannelId()
	const api = findByProps<{
		getChatInputRef?(channelId: string, index: number): ComposerRef | undefined
	}>('getChatInputRef')
	return channelId ? api?.getChatInputRef?.(channelId, 0) : undefined
}

/**
 * The draft as it is now. Discord's composer is asked first: the text remembered from our own writes
 * goes stale as soon as the user types, so it is only a fallback.
 */
function readInput() {
	const ref = composerRef()
	const live =
		ref?.getText?.() ??
		ref?.getValue?.() ??
		ref?.text ??
		ref?.value ??
		ref?.props?.value
	if (typeof live === 'string') return live
	return Date.now() - input.seen < 600000 ? input.text : ''
}

function writeInput(text: string) {
	let ok = false
	try {
		if (input.change) {
			input.change(text)
			ok = true
		}
		if (input.instance?.setNativeProps) {
			input.instance.setNativeProps({ text })
			ok = true
		}
	} catch {
		// fall through to Discord's own composer ref
	}
	if (!ok) {
		const ref = composerRef()
		try {
			if (ref?.setText) ref.setText(text)
			else if (ref?.setValue) ref.setValue(text)
			else if (ref?.setNativeProps) ref.setNativeProps({ text })
			else if (ref?.clear && ref.insertText) {
				ref.clear()
				ref.insertText(text)
			} else return false
			ok = true
		} catch {
			return false
		}
	}
	input.text = text
	dropSelection()
	return true
}

function resetInput() {
	input.text = ''
	dropSelection()
	input.change = null
	input.instance = null
	input.seen = 0
}

/** Forgets the draft state; used when the plugin stops. */
export function resetComposer() {
	resetInput()
	lastOriginal = null
	lastChannelId = null
}

/** Remembers the open chat, so only real chat switches count as changes. */
export function trackChannel() {
	lastChannelId = currentChannelId()
}

/** Called when the user opens another chat. */
export function onChannelChanged(channelId: string | null) {
	if (channelId === lastChannelId) return
	lastChannelId = channelId
	resetInput()
	if (lastOriginal && lastOriginal.channelId !== channelId) lastOriginal = null
	setArmed(null)
}

/* ---------------------------- translating the draft --------------------------- */

export async function translateDraft(tl: string, sl: string) {
	const text = readInput()
	if (!text.trim()) {
		toast('Type a message in the chat box first')
		return false
	}
	if (!(input.change || input.instance || composerRef())) {
		toast(
			'Discord could not access the message box; reopen the chat and try again',
		)
		return false
	}
	const channelId = currentChannelId()
	// With part of the draft selected, only that part is translated and the rest stays as typed.
	const range = selectedRange(text)
	const part = range ? text.slice(range.start, range.end) : text
	const lead = range ? (/^\s*/.exec(part)?.[0] ?? '') : ''
	const trail = range ? (/\s*$/.exec(part)?.[0] ?? '') : ''
	try {
		const result = await translate(part.trim(), tl, sl, { channelId })
		if (
			!isRunning() ||
			currentChannelId() !== channelId ||
			readInput() !== text
		) {
			toast(
				'The draft or conversation changed; the original text was left untouched',
			)
			return false
		}
		if (result.same) {
			setArmed(null)
			toast(`Already in ${languageName(tl)}`)
			return false
		}
		const next = range
			? text.slice(0, range.start) +
				lead +
				result.text +
				trail +
				text.slice(range.end)
			: result.text
		if (!writeInput(next)) {
			toast('Could not update the chat box; the original text is unchanged')
			return false
		}
		lastOriginal = { text, channelId }
		notifyTranslated(result, !!range)
		return true
	} catch (error) {
		toast(`Translation failed: ${(error as Error)?.message ?? error}`)
		return false
	}
}

export function restoreOriginal() {
	if (!lastOriginal) return toast('Nothing to restore')
	if (lastOriginal.channelId && currentChannelId() !== lastOriginal.channelId)
		return toast('Open the original conversation before restoring this draft')
	if (writeInput(lastOriginal.text)) lastOriginal = null
	else toast('Could not write to the chat box')
}

/* ------------------------------- sending messages ------------------------------ */

interface OutgoingMessage {
	content?: unknown
}

/** With "Translate before sending" off, the active languages are applied to the message on send. */
export function patchSend(
	messages: Record<string, (...args: unknown[]) => unknown>,
) {
	return instead(messages, 'sendMessage', (args, original) => {
		const since = currentGeneration()
		const [channelId, message] = args as [string, OutgoingMessage | undefined]
		const job = getSettings().draftBeforeSend ? null : getArmed()
		let translated = false
		let pending: Promise<void> | undefined

		if (job && typeof message?.content === 'string' && message.content.trim()) {
			if (!job.oneShot && !getSettings().keepArmed) setArmed(null)
			pending = translate(message.content, job.tl, job.sl, {
				channelId: currentChannelId(),
			}).then(result => {
				if (result.same) return
				args[1] = { ...message, content: result.text }
				notifyTranslated(result)
				translated = true
			})
		}

		const send = () => {
			assertCurrent(since)
			const afterSend = () => {
				if (
					lastOriginal &&
					(channelId === lastOriginal.channelId ||
						currentChannelId() === lastOriginal.channelId)
				)
					lastOriginal = null
				input.text = ''
				if (job?.oneShot && translated) setArmed(job.resume ?? null)
			}
			const result = original(...args)
			if (result instanceof Promise)
				return result.then(value => {
					afterSend()
					return value
				})
			afterSend()
			return result
		}

		return pending
			? pending
					.catch(() => toast('Translation failed, sent the original message'))
					.then(send)
			: send()
	})
}

/* --------------------- Discord's own native chat box --------------------- */

const NATIVE_INPUT_PATH =
	'modules/chat_input/native/ChatInputNativeComponent.tsx'

/**
 * Discord's chat box is a native component, not React Native's TextInput, so the TextInput patch never
 * sees it. This one wraps the native component's selection, focus and blur handlers.
 */
export function patchNativeInput() {
	return getModuleWithImportedPath(NATIVE_INPUT_PATH, (mod: unknown) => {
		try {
			const exported = (mod as { default?: unknown }).default as
				| Record<string, unknown>
				| undefined
			let holder: Record<string, unknown> | undefined
			let key = ''
			if (typeof exported === 'function') {
				holder = mod as Record<string, unknown>
				key = 'default'
			} else if (typeof exported?.render === 'function') {
				holder = exported
				key = 'render'
			} else if (typeof exported?.type === 'function') {
				holder = exported
				key = 'type'
			}
			if (!holder) return
			const undo = before(
				holder as Record<string, (...args: unknown[]) => unknown>,
				key,
				args => {
					const props = args[0] as Record<string, unknown> | undefined
					if (!props || typeof props !== 'object') return args
					input.captured = true
					input.seen = Date.now()
					const next: Record<string, unknown> = { ...props }
					for (const name of Object.keys(props)) {
						const fn = props[name]
						if (typeof fn !== 'function') continue
						if (/select/i.test(name)) {
							next[name] = (...rest: unknown[]) => {
								const range = rangeOf(rest[0])
								if (range) noteSelection(range.start, range.end)
								return (fn as (...a: unknown[]) => unknown)(...rest)
							}
						} else if (name === 'onBlur' || name === 'onEndBlur') {
							next[name] = (...rest: unknown[]) => {
								cancelDrop()
								input.blurredAt = Date.now()
								return (fn as (...a: unknown[]) => unknown)(...rest)
							}
						}
					}
					return [next, ...args.slice(1)]
				},
			)
			return undo
		} catch {
			// the native chat box could not be hooked: the composer ref is still used
		}
	})
}
