import {
	AlertActionCreators,
	ToastActionCreators,
} from '@valenced/discord/actions'
import { Tokens } from '@valenced/discord/common/tokens'
import { Design } from '@valenced/discord/design'
import { Stores } from '@valenced/discord/flux'
import { ScrollView } from 'react-native'
import { diffWords } from './diff'
import { getChannel, jumpToMessage, userName } from './discord'
import type { Entry } from './types'

const Keys = {
	details: 'dariuss.advanced-message-logger.details',
	notification: 'dariuss.advanced-message-logger.notification',
	compare: 'dariuss.advanced-message-logger.compare',
	confirm: 'dariuss.advanced-message-logger.confirm',
}
const DetailsLimit = 1200
const PreviewLimit = 400

let removeEntries: (entries: readonly Entry[]) => void = () => {}
/** Tells the alerts how to remove journal entries. */
export const configureAlerts = (remove: typeof removeEntries) => {
	removeEntries = remove
}

const close = (key: string) => AlertActionCreators.dismissAlert(key)

/** Message text with mention markup turned into names. */
function readable(entry: Entry) {
	const mentions = entry.before.original?.mentions
	return entry.before.content
		.replace(/<@!?(\d+)>/g, (_match, id: string) => {
			const saved = Array.isArray(mentions)
				? (mentions as { id?: string; username?: string }[]).find(
						user => user?.id === id,
					)
				: undefined
			return `@${userName(id) ?? saved?.username ?? 'Unknown user'}`
		})
		.replace(
			/<#(\d+)>/g,
			(_match, id: string) => `#${getChannel(id)?.name ?? 'unknown-channel'}`,
		)
}

export function jump(entry: Entry) {
	if (!jumpToMessage(entry.before.channelId, entry.before.id)) {
		ToastActionCreators.open(`${Keys.details}.unavailable`, {
			text: 'This channel is unavailable.',
		})
	}
}

export function showDetails(entry: Entry, related: readonly Entry[] = [entry]) {
	const text = (item: Entry) => item.before.content || '(No text)'
	const body =
		related.length > 1
			? related
					.slice(0, 5)
					.map(
						item =>
							`${item.kind === 'edited' ? 'Edited' : 'Deleted'}: ${text(item)}`,
					)
					.join('\n\n')
			: entry.kind === 'edited'
				? `Before\n${text(entry)}\n\nAfter\n${entry.after?.content || '(No text)'}`
				: text(entry)
	AlertActionCreators.openAlert(
		Keys.details,
		<Design.AlertModal
			title={`${entry.before.author} · ${entry.kind}`}
			content={
				body.length > DetailsLimit ? `${body.slice(0, DetailsLimit)}…` : body
			}
			actions={
				<>
					<Design.AlertActionButton
						text="Jump to message"
						onPress={() => {
							close(Keys.details)
							jump(entry)
						}}
					/>
					<Design.AlertActionButton
						text={related.length > 1 ? 'Remove history' : 'Remove from history'}
						variant="destructive"
						onPress={() => {
							removeEntries(related)
							close(Keys.details)
						}}
					/>
					<Design.AlertActionButton
						text="Close"
						variant="secondary"
						onPress={() => close(Keys.details)}
					/>
				</>
			}
		/>,
	)
}

/** A semantic color token as a plain color for the current theme. */
const tint = (name: 'TEXT_FEEDBACK_CRITICAL' | 'TEXT_FEEDBACK_POSITIVE') =>
	Tokens.default.internal.resolveSemanticColor(
		(Stores.ThemeStore as unknown as { theme: string }).theme,
		Tokens.default.colors[name],
	)

/** What changed between each version of an edited message, word by word. */
export function showDiff(related: readonly Entry[]) {
	const edits = related
		.filter(entry => entry.kind === 'edited')
		.sort((a, b) => a.at - b.at)
	if (!edits.length) return
	const removed = tint('TEXT_FEEDBACK_CRITICAL')
	const added = tint('TEXT_FEEDBACK_POSITIVE')
	AlertActionCreators.openAlert(
		Keys.compare,
		<Design.AlertModal
			title={`${edits[0].before.author} · ${edits.length === 1 ? '1 edit' : `${edits.length} edits`}`}
			content="Removed text is red and crossed out, added text is green."
			extraContent={
				// custom: the colored word differences are inline spans of one text
				<ScrollView style={{ maxHeight: 360 }} nestedScrollEnabled>
					{edits.map((entry, index) => {
						const next = edits[index + 1]
						const after = entry.after?.content ?? next?.before.content ?? ''
						return (
							<Design.Stack
								key={`${entry.at}:${entry.before.content}`}
								spacing={4}
							>
								<Design.Text variant="text-xs/semibold" color="text-muted">
									{`Version ${index + 1} → ${index + 2}`}
								</Design.Text>
								<Design.Text variant="text-md/normal" color="text-default">
									{diffWords(entry.before.content, after).map((piece, at) => (
										<Design.Text
											// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of text pieces that never reorders
											key={at}
											variant="text-md/normal"
											color="text-default"
											style={
												piece.kind === 'removed'
													? {
															color: removed,
															textDecorationLine: 'line-through',
														}
													: piece.kind === 'added'
														? { color: added, fontWeight: '600' }
														: undefined
											}
										>
											{piece.text}
										</Design.Text>
									))}
								</Design.Text>
							</Design.Stack>
						)
					})}
				</ScrollView>
			}
			actions={
				<>
					<Design.AlertActionButton
						text="Jump to message"
						onPress={() => {
							close(Keys.compare)
							jump(edits[0])
						}}
					/>
					<Design.AlertActionButton
						text="Close"
						variant="secondary"
						onPress={() => close(Keys.compare)}
					/>
				</>
			}
		/>,
	)
}

export function notify(title: string, entry?: Entry, content?: string) {
	AlertActionCreators.openAlert(
		Keys.notification,
		<Design.AlertModal
			title={title}
			content={
				content ?? (entry ? readable(entry).slice(0, PreviewLimit) : undefined)
			}
			actions={
				<>
					{entry && (
						<Design.AlertActionButton
							text="Jump to message"
							onPress={() => {
								close(Keys.notification)
								jump(entry)
							}}
						/>
					)}
					<Design.AlertActionButton
						text="Dismiss"
						variant="secondary"
						onPress={() => close(Keys.notification)}
					/>
				</>
			}
		/>,
	)
}

export function confirm(title: string, content: string, onConfirm: () => void) {
	AlertActionCreators.openAlert(
		Keys.confirm,
		<Design.AlertModal
			title={title}
			content={content}
			actions={
				<>
					<Design.AlertActionButton
						text="Clear"
						variant="destructive"
						onPress={() => {
							onConfirm()
							close(Keys.confirm)
						}}
					/>
					<Design.AlertActionButton
						text="Cancel"
						variant="secondary"
						onPress={() => close(Keys.confirm)}
					/>
				</>
			}
		/>,
	)
}

export function dismissAll() {
	for (const key of Object.values(Keys)) close(key)
}
