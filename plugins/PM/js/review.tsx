import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { ToastActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { useEffect, useReducer, useRef, useState } from 'react'
import { Linking } from 'react-native'
import {
	AiError,
	analyse,
	currentModel,
	DefaultAiSettings,
	KEY_URL,
	listModels,
	reviewText,
	SuggestedModels,
} from './ai'
import { formatMs } from './monitor'
import {
	checkRecording,
	recordedMs,
	recording,
	startRecording,
	stopRecording,
} from './recording'
import type { ComponentProps } from 'react'
import type { Advice, AiSettings, Review } from './ai'

type RowProps = Omit<ComponentProps<typeof Design.TableRow>, 'icon'> & {
	icon: string
}

const Row = ({ icon, ...props }: RowProps) => (
	<Design.TableRow
		subLabelLineClamp={12}
		{...props}
		icon={<TableRowAssetIcon name={icon} />}
	/>
)

export interface AiStorage {
	use(): Partial<AiSettings> | undefined
	set(value: Partial<AiSettings>): Promise<void>
}

const DURATIONS: [minutes: number, note: string][] = [
	[1, 'A quick check of one action, such as opening a server.'],
	[3, 'Scrolling and switching channels for a moment.'],
	[5, 'Normal use. Recommended.'],
	[10, 'Longer use for rare problems.'],
	[20, 'A long session; the most reliable picture.'],
]

/** Kept outside the component so a running analysis and its result survive leaving the page. */
const session: {
	review?: Review
	error?: string
	busy: boolean
	minutes: number
	models: string[]
	modelsNote?: string
} = { busy: false, minutes: 5, models: [] }

const clock = (ms: number) => {
	const seconds = Math.max(0, Math.round(ms / 1000))
	const pad = (value: number) => String(value).padStart(2, '0')
	return `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`
}

const copy = (text: string, toast: string) => {
	void Clipboard.setString(text)
	ToastActionCreators.open('dariuss.performance-monitor.copied', {
		text: toast,
	})
}

const STEPS = [
	`Open ${KEY_URL} in a browser and sign up or log in. It is free and needs no card.`,
	'Open "API Keys" in the menu on the left.',
	'Tap "Create API Key", give it any name (for example Valenced) and confirm.',
	'Copy the key now. It starts with gsk_ and is shown only once.',
	'Paste it in the field below and tap "Check key".',
]

function KeyInput({
	storage,
	stored,
}: {
	storage: AiStorage
	stored: AiSettings
}) {
	const [draft, setDraft] = useState(stored.groqKey)
	const [note, setNote] = useState<string>()
	const [checking, setChecking] = useState(false)

	const check = async () => {
		const key = draft.trim()
		await storage.set({ groqKey: key })
		setChecking(true)
		setNote(undefined)
		try {
			session.models = await listModels(key)
			session.modelsNote = undefined
			setNote(`The key works. ${session.models.length} models available.`)
		} catch (error) {
			setNote(
				error instanceof AiError ? error.message : 'Could not check the key.',
			)
		} finally {
			setChecking(false)
		}
	}

	return (
		<Design.Stack spacing={12}>
			<Design.TextInput
				label="Groq API key"
				description="Stored only in this plugin on your phone. It is sent to Groq and nowhere else, and never written to logs."
				placeholder="gsk_..."
				value={draft}
				secureTextEntry
				onChange={setDraft}
				onBlur={() => void storage.set({ groqKey: draft.trim() })}
			/>
			<Design.Button
				text={checking ? 'Checking...' : 'Check key'}
				variant="secondary"
				disabled={checking || !draft.trim()}
				onPress={() => void check()}
			/>
			{note && (
				<Design.Text variant="text-sm/normal" color="text-muted">
					{note}
				</Design.Text>
			)}
		</Design.Stack>
	)
}

function ModelInput({ storage, model }: { storage: AiStorage; model: string }) {
	const [draft, setDraft] = useState(model)
	return (
		<Design.TextInput
			label="Model"
			description="Any Groq chat model id. Pick one above or type it."
			value={draft}
			onChange={setDraft}
			onBlur={() =>
				void storage.set({ model: draft.trim() || DefaultAiSettings.model })
			}
		/>
	)
}

function adviceRows(
	title: string,
	icon: string,
	list: Advice[],
	hint: string | undefined,
) {
	if (!list.length) return null
	return (
		<Design.TableRowGroup title={title} key={title}>
			{list.map(item => (
				<Row
					key={`${title}|${item.id}`}
					icon={icon}
					label={item.name}
					subLabel={`${item.reason}${item.report && hint ? `\n\n${hint}` : ''}`}
					onPress={() =>
						copy(
							item.report ?? `${item.name} (${item.id}): ${item.reason}`,
							item.report ? 'Report copied' : 'Copied',
						)
					}
				/>
			))}
		</Design.TableRowGroup>
	)
}

export default function ReviewScreen({
	storage,
	onBack,
}: {
	storage: AiStorage
	onBack(): void
}) {
	const [, rerender] = useReducer((value: number) => value + 1, 0)
	const mounted = useRef(true)
	const [minutes, setMinutes] = useState(session.minutes)
	const saved = { ...DefaultAiSettings, ...storage.use() }
	const stored = { ...saved, model: currentModel(saved.model) }

	useEffect(() => {
		mounted.current = true
		const timer = setInterval(() => {
			checkRecording()
			rerender()
		}, 1000)
		return () => {
			mounted.current = false
			clearInterval(timer)
		}
	}, [])

	const run = async () => {
		session.busy = true
		session.error = undefined
		rerender()
		try {
			session.review = await analyse(stored)
		} catch (error) {
			session.error =
				error instanceof AiError ? error.message : 'The analysis failed.'
		} finally {
			session.busy = false
			if (mounted.current) rerender()
		}
	}

	const active = recording.status === 'recording'
	const finished = recording.status === 'finished'
	const elapsed = recordedMs()
	const { review } = session
	const hasKey = !!stored.groqKey.trim()
	const models = session.models.length
		? session.models
		: SuggestedModels.map(([id]) => id)
	const notes = new Map(SuggestedModels)

	return (
		<Design.Stack spacing={24}>
			<Design.TableRowGroup title="AI review">
				<Row
					icon="ArrowSmallLeftIcon"
					label="Back to the monitor"
					onPress={onBack}
				/>
				<Row
					icon="LockIcon"
					label="What is sent"
					subLabel="Only anonymous numbers: plugin ids and names, how long their hooks ran and how often, and hook labels such as 'flux MESSAGE_CREATE'. No messages, names, servers, tokens or any other data from Discord or your account is sent. It goes to Groq only, with your own key."
				/>
				{active ? (
					<>
						<Row
							icon="ClockIcon"
							label={`Recording ${clock(elapsed)} of ${clock(recording.targetMs)}`}
							subLabel="Use Discord as you normally would, or the way that feels slow. It stops by itself; you can also stop it now."
						/>
						<Row
							icon="CircleXIcon"
							label="Stop recording"
							subLabel="Keep what was recorded so far."
							onPress={() => {
								stopRecording()
								rerender()
							}}
						/>
					</>
				) : (
					<>
						{finished && (
							<Row
								icon="CircleCheckIcon"
								label={`Recorded ${clock(elapsed)}`}
								subLabel={`${recording.plugins.size} plugins measured. ${recording.stalls.count} JS thread stalls over 100 ms.`}
							/>
						)}
						<Row
							icon="PlayIcon"
							label={finished ? 'Record again' : 'Start recording'}
							subLabel={`Records for ${minutes} min. The totals on the main page keep counting and are not changed.`}
							onPress={() => {
								session.review = undefined
								session.error = undefined
								startRecording(minutes * 60_000)
								rerender()
							}}
						/>
					</>
				)}
				{finished && !active && (
					<Row
						icon="RobotIcon"
						label={session.busy ? 'Analysing...' : 'Analyse with AI'}
						subLabel={
							hasKey
								? `Sends the numbers to Groq (${stored.model}) and shows recommendations.`
								: 'Add your Groq API key in "Groq setup" below first.'
						}
						onPress={session.busy ? undefined : () => void run()}
					/>
				)}
			</Design.TableRowGroup>

			{!active && (
				<Design.TableRadioGroup
					title="Recording length"
					value={String(minutes)}
					onChange={(value: string) => {
						session.minutes = Number(value)
						setMinutes(Number(value))
					}}
				>
					{DURATIONS.map(([count, note]) => (
						<Design.TableRadioRow
							key={count}
							label={`${count} min`}
							value={String(count)}
							subLabel={note}
						/>
					))}
				</Design.TableRadioGroup>
			)}

			{session.error && (
				<Design.TableRowGroup title="Problem">
					<Row
						icon="WarningIcon"
						label="The analysis did not work"
						subLabel={session.error}
					/>
					{hasKey && finished && (
						<Row
							icon="RefreshIcon"
							label="Try again"
							onPress={() => void run()}
						/>
					)}
				</Design.TableRowGroup>
			)}

			{review && (
				<>
					<Design.TableRowGroup title="Result">
						<Row
							icon={
								review.verdict === 'good'
									? 'CircleCheckIcon'
									: review.verdict === 'poor'
										? 'WarningIcon'
										: 'CircleInformationIcon'
							}
							label={
								review.verdict === 'good'
									? 'Plugins look healthy'
									: review.verdict === 'poor'
										? 'Some plugins cost a lot'
										: 'Some room for improvement'
							}
							subLabel={review.summary}
						/>
						<Row
							icon="CopyIcon"
							label="Copy the whole result"
							subLabel={`${review.model} · recorded for ${formatMs(recordedMs())}`}
							onPress={() => copy(reviewText(review), 'Result copied')}
						/>
					</Design.TableRowGroup>
					{adviceRows(
						'Consider disabling',
						'CircleXIcon',
						review.disable,
						undefined,
					)}
					{adviceRows(
						'Report to the developer',
						'FlagIcon',
						review.report,
						'Tap to copy the report text.',
					)}
					{adviceRows('Looks fine', 'CircleCheckIcon', review.fine, undefined)}
					{review.notes.length > 0 && (
						<Design.TableRowGroup title="Notes">
							{review.notes.map(note => (
								<Row key={note} icon="CircleInformationIcon" label={note} />
							))}
						</Design.TableRowGroup>
					)}
					<Design.Stack align="center">
						<Design.Text variant="text-xs/normal" color="text-muted">
							AI advice can be wrong. Treat it as a hint and confirm by
							disabling a plugin and comparing.
						</Design.Text>
					</Design.Stack>
				</>
			)}

			<Design.TableRowGroup title="Groq setup: get a free key">
				{STEPS.map((step, index) => (
					<Row
						key={step}
						icon="CircleInformationIcon"
						label={`${index + 1}. ${step}`}
					/>
				))}
				<Row
					icon="LinkIcon"
					label={`Open ${KEY_URL}`}
					onPress={() => void Linking.openURL(`https://${KEY_URL}/keys`)}
				/>
			</Design.TableRowGroup>
			<KeyInput storage={storage} stored={stored} />
			<Design.TableRadioGroup
				title="Model"
				value={stored.model}
				onChange={(value: string) => void storage.set({ model: value })}
			>
				{models.map(id => (
					<Design.TableRadioRow
						key={id}
						label={id}
						value={id}
						subLabel={notes.get(id)}
					/>
				))}
			</Design.TableRadioGroup>
			<ModelInput key={stored.model} storage={storage} model={stored.model} />
		</Design.Stack>
	)
}
