import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { ActionSheetActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { instead } from '@valenced/patcher'
import { cloneElement, isValidElement } from 'react'
import { placeGroup } from './menu-order'
import { translationActions } from './quick-translate'
import { voiceAttachment } from './voice'
import type { ReactElement, ReactNode } from 'react'
import type { Runtime } from './runtime'
import type { VoiceMessage } from './voice'

const LongPressKey = 'MessageLongPressActionSheet'

interface Entry {
	key: string
	label: string
	icon: string
	danger?: boolean
	press(): void
}

type Sheet = (props: object) => ReactNode
type Element = ReactElement<{ children?: ReactNode }>

interface SheetOpener {
	openLazy(
		sheet: Promise<{ default: Sheet }>,
		key: string,
		props: { message?: VoiceMessage },
		...rest: unknown[]
	): void
}

function entriesFor(runtime: Runtime, message: VoiceMessage): Entry[] {
	const { id } = message
	const transcript = runtime.transcripts.get(id)
	if (!transcript)
		return [
			{
				key: 'vt-transcribe',
				label: 'Transcribe voice message',
				icon: 'MicrophoneIcon',
				press: () => void runtime.transcribe(message),
			},
		]
	return [
		{
			key: 'vt-show',
			label: 'Show transcript',
			icon: 'MicrophoneIcon',
			press: () => runtime.show(id),
		},
		{
			key: 'vt-copy',
			label: 'Copy transcript',
			icon: 'CopyIcon',
			press: () => runtime.copy(transcript.text),
		},
		{
			key: 'vt-remove',
			label: 'Remove transcript',
			icon: 'TrashIcon',
			danger: true,
			press: () => runtime.remove(id),
		},
		...translationActions(transcript).map(action => ({
			...action,
			icon: 'LanguageIcon',
		})),
	]
}

/** Appends the rows to the first ActionSheet found in the tree. */
function appendRows(tree: ReactNode, rows: ReactElement): ReactNode {
	let done = false
	const walk = (node: ReactNode): ReactNode => {
		if (done) return node
		if (Array.isArray(node)) return node.map(walk)
		if (!isValidElement(node)) return node
		const element = node as Element
		if (element.type === Design.ActionSheet) {
			done = true
			return cloneElement(element, {
				children: placeGroup(element.props.children, rows) ?? [
					element.props.children,
					rows,
				],
			})
		}
		const children = walk(element.props.children)
		return done ? cloneElement(element, { children }) : node
	}
	return walk(tree)
}

/** Adds the transcript entries to the long-press menu of voice messages. */
export function patchMessageMenu(
	runtime: Runtime,
	cleanup: (undo: () => void) => void,
) {
	cleanup(
		instead(
			ActionSheetActionCreators as unknown as SheetOpener,
			'openLazy',
			function (args, original) {
				const [sheet, key, props] = args
				const message = props?.message
				if (key !== LongPressKey || !sheet?.then || !voiceAttachment(message))
					return Reflect.apply(original, this, args)

				const entries = entriesFor(runtime, message as VoiceMessage)
				const wrapped = sheet.then(module => {
					const Original = module.default
					if (typeof Original !== 'function') return module
					return {
						...module,
						default: function VoiceMessageActions(sheetProps: object) {
							const rows = (
								<Design.ActionSheetRow.Group key="vt-menu">
									{entries.map(entry => (
										<Design.ActionSheetRow
											key={entry.key}
											label={entry.label}
											variant={entry.danger ? 'danger' : 'default'}
											icon={<TableRowAssetIcon name={entry.icon} />}
											onPress={() => {
												ActionSheetActionCreators.hideActionSheet(key)
												entry.press()
											}}
										/>
									))}
								</Design.ActionSheetRow.Group>
							)
							return appendRows(Original(sheetProps), rows)
						},
					}
				})
				return Reflect.apply(original, this, [wrapped, ...args.slice(1)])
			},
		),
	)
}
