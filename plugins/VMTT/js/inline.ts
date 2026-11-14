import { Tokens } from '@valenced/discord/common/tokens'
import { getModules } from '@valenced/modules/finders'
import { withName } from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { Platform, processColor } from 'react-native'
import { translationOf } from './quick-translate'
import { stores } from './stores'
import type { Runtime } from './runtime'

/** Marks the embeds this plugin adds to message rows, so they are never added twice. */
const EmbedPrefix = 'dariuss-voice-transcript:'
/** Row change type that makes the message list re-render the row. */
const RowChanged = 2

interface Node {
	type: string
	content: string | Node[]
	__tr?: boolean
	[key: string]: unknown
}

interface Embed {
	id?: string
	[key: string]: unknown
}

interface Message {
	id: string
	embeds?: Embed[]
	content?: unknown
	[key: string]: unknown
}

interface Row {
	message?: Message
	changeType?: number
	[key: string]: unknown
}

interface RowGenerator {
	generate(this: unknown, row: Row): Row
}

const text = (content: string): Node => ({ type: 'text', content })

const withoutTranslation = (nodes: Node[]): Node[] =>
	nodes
		.filter(node => !node?.__tr)
		.map(node =>
			Array.isArray(node?.content)
				? { ...node, content: withoutTranslation(node.content) }
				: node,
		)

function accentColor() {
	const { colors, internal } = Tokens.default
	return processColor(
		internal.resolveSemanticColor(stores.ThemeStore.theme, colors.TEXT_BRAND),
	) as number
}

/** The transcript, followed by its Quick Translate translation when there is one. */
function descriptionOf(message: Message, transcript: string) {
	const nodes = [text(transcript)]
	const translation = translationOf(message.id)
	if (!translation) return { nodes, color: accentColor() }

	if (Array.isArray(message.content))
		message.content = withoutTranslation(message.content as Node[])
	const color = translation.color
		? (processColor(translation.color) as number)
		: accentColor()
	const label = translation.sourceLabel ? `${translation.sourceLabel}\n` : ''
	const translated: Node = {
		type: 'link',
		target: { linkColor: color, medium: false },
		linkColor: color,
		content: [text(label + translation.text)],
	}
	return {
		nodes:
			translation.immersive === false
				? [translated]
				: [...nodes, text('\n\n'), translated],
		color: accentColor(),
	}
}

const plain = (nodes: Node[]): string =>
	nodes
		.map(node =>
			Array.isArray(node.content) ? plain(node.content) : node.content,
		)
		.join('')

function decorate(runtime: Runtime, row: Row): Row {
	const original = row.message
	if (!original) return row

	const { id } = original
	const transcript = runtime.settings().inline
		? runtime.transcripts.get(id)
		: undefined
	const wasDirty = runtime.dirty.delete(id)
	const embeds = Array.isArray(original.embeds) ? original.embeds : []
	const clean = embeds.filter(embed => !embed?.id?.startsWith(EmbedPrefix))
	if (!transcript && !wasDirty && clean.length === embeds.length) return row

	const message: Message = { ...original, embeds: clean }
	if (transcript) {
		const { nodes, color } = descriptionOf(message, transcript.text)
		message.embeds = [
			...clean,
			{
				id: EmbedPrefix + id,
				type: 'rich',
				spoiler: '',
				obscure: '',
				obscureAwaitingScan: '',
				verifyAge: false,
				obscureHideControls: false,
				obscureIsOpaque: false,
				rawDescription: transcript.text,
				// iOS decodes embeds natively: it needs `fields` and a plain-text description.
				fields: [],
				description: Platform.OS === 'ios' ? plain(nodes) : nodes,
				bodyTextColor: color,
			},
		]
	}
	return { ...row, message, changeType: RowChanged }
}

/** Shows transcripts as a rich embed below the voice message. Returns the unsubscribe function. */
export function patchRows(
	runtime: Runtime,
	cleanup: (undo: () => void) => void,
	report: (error: unknown) => void,
) {
	return getModules(
		withName<{ prototype: RowGenerator }>('RowManager'),
		({ prototype }) => {
			if (runtime.inlineReady || typeof prototype?.generate !== 'function')
				return
			runtime.inlineReady = true
			cleanup(
				instead(prototype, 'generate', function (args, original) {
					const row = Reflect.apply(original, this, args) as Row
					try {
						return decorate(runtime, row)
					} catch (error) {
						report(error)
						return row
					}
				}),
			)
			cleanup(() => {
				runtime.inlineReady = false
			})
			runtime.refreshAll()
		},
	)
}
