import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { ActionSheetActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { useSyncExternalStore } from 'react'
import { translationActions } from './quick-translate'
import { formatDuration } from './shared'
import type { Runtime } from './runtime'
import type { Option } from './shared'

export const ResultKey = 'voice-transcript'
const PickerKey = 'voice-transcript-picker'

const hide = (key: string) => ActionSheetActionCreators.hideActionSheet(key)

export function ResultSheet({ runtime, id }: { runtime: Runtime; id: string }) {
	useSyncExternalStore(runtime.subscribe, runtime.snapshot)
	const transcript = runtime.transcripts.get(id)
	const actions = transcript ? translationActions(transcript) : []
	const subtitle = transcript
		? [
				transcript.language || 'Voice message',
				transcript.dur ? formatDuration(transcript.dur) : '',
				transcript.by,
			]
				.filter(Boolean)
				.join(' · ')
		: undefined

	return (
		<Design.ActionSheet scrollable>
			<Design.BottomSheetTitleHeader
				title="Transcript"
				subtitle={subtitle}
				leading={<TableRowAssetIcon name="MicrophoneIcon" />}
			/>
			<Design.Card>
				<Design.Text selectable variant="text-md/normal">
					{transcript?.text ?? 'This transcript is no longer available.'}
				</Design.Text>
			</Design.Card>
			{transcript && (
				<Design.TableRowGroup>
					<Design.TableRow
						label="Copy text"
						icon={<TableRowAssetIcon name="CopyIcon" />}
						onPress={() => runtime.copy(transcript.text)}
					/>
					{actions.map(action => (
						<Design.TableRow
							key={action.key}
							label={action.label}
							icon={<TableRowAssetIcon name="LanguageIcon" />}
							onPress={() => {
								hide(ResultKey)
								action.press()
							}}
						/>
					))}
					<Design.TableRow
						label="Transcribe again"
						icon={<TableRowAssetIcon name="RetryIcon" />}
						onPress={() => {
							hide(ResultKey)
							runtime.again(id)
						}}
					/>
				</Design.TableRowGroup>
			)}
		</Design.ActionSheet>
	)
}

interface PickerProps {
	title: string
	options: Option[]
	value: string
	onPick(value: string): void
}

function Picker({ title, options, value, onPick }: PickerProps) {
	return (
		<Design.ActionSheet scrollable>
			<Design.BottomSheetTitleHeader title={title} />
			<Design.TableRadioGroup
				value={value}
				onChange={next => {
					hide(PickerKey)
					onPick(next)
				}}
			>
				{options.map(option => (
					<Design.TableRadioRow
						key={option.value}
						label={option.label}
						value={option.value}
					/>
				))}
			</Design.TableRadioGroup>
		</Design.ActionSheet>
	)
}

/** Opens a native sheet with one radio row per option. */
export function pickOption<T extends string>(
	title: string,
	options: Option<T>[],
	value: T,
	onPick: (value: T) => void,
) {
	ActionSheetActionCreators.openLazy(
		Promise.resolve({ default: Picker }),
		PickerKey,
		{ title, options, value, onPick: onPick as (value: string) => void },
	)
}
