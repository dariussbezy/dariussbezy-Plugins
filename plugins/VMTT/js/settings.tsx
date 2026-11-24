import Page from '@valenced/components/Page'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { Design } from '@valenced/discord/design'
import { useState, useSyncExternalStore } from 'react'
import { ScrollView } from 'react-native'
import { StatsRow } from '../../../lib/stats-ui'
import manifest from '../manifest.json'
import { getRuntime } from './runtime'
import {
	AutoModes,
	DefaultSettings,
	Languages,
	labelOf,
	MaxTranscripts,
	modelFor,
	ProviderOptions,
	Providers,
} from './shared'
import { pickOption } from './sheets'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { Option, Settings } from './shared'

const BUILD = manifest.version

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>

const subscribeNothing = () => () => {}
const noVersion = () => 0

export default function SettingsComponent({
	api: { jsonStorage: storage },
}: Props) {
	const settings = { ...DefaultSettings, ...storage.use() }
	const runtime = getRuntime()
	useSyncExternalStore(
		runtime?.subscribe ?? subscribeNothing,
		runtime?.snapshot ?? noVersion,
	)
	const [showKey, setShowKey] = useState(false)
	const provider = Providers[settings.provider]
	const isServer = settings.provider === 'server'
	const count = runtime?.transcripts.size ?? 0

	const select = <T extends string>(
		title: string,
		options: Option<T>[],
		value: T,
		onPick: (value: T) => void,
		subLabel?: string,
		icon?: string,
	) => (
		<Design.TableRow
			label={title}
			subLabel={subLabel}
			icon={icon ? <TableRowAssetIcon name={icon} /> : undefined}
			trailing={
				<Design.TableRow.TrailingText
					text={labelOf(options, value).split(' (')[0].replace(' only', '')}
				/>
			}
			arrow
			onPress={() => pickOption(title, options, value, onPick)}
		/>
	)

	return (
		<ScrollView keyboardShouldPersistTaps="handled">
			<Page>
				<Design.Stack spacing={24}>
					<Design.TableRowGroup
						title="Service"
						description={
							isServer
								? 'No API key needed. The link to the audio is sent to the server only when a message is transcribed.'
								: 'Audio is sent to Groq only when a message is transcribed. Create a key at console.groq.com/keys.'
						}
					>
						{select(
							'Service',
							ProviderOptions,
							settings.provider,
							id =>
								storage.set({
									provider: id,
									model: Providers[id].models[0].value,
								}),
							undefined,
							'MicrophoneIcon',
						)}
						{!isServer &&
							select(
								'Model',
								provider.models,
								modelFor(settings),
								model => storage.set({ model }),
								undefined,
								'RobotIcon',
							)}
						{select(
							'Language',
							Languages,
							settings.language,
							language => storage.set({ language }),
							undefined,
							'LanguageIcon',
						)}
					</Design.TableRowGroup>

					<Design.Stack spacing={8} key={settings.provider}>
						{isServer ? (
							<Design.TextInput
								label="Server address"
								description="Leave empty to use the built-in server."
								placeholder="https://your-server.workers.dev"
								defaultValue={settings.serverUrl}
								onChange={serverUrl =>
									storage.set({ serverUrl: serverUrl.trim() })
								}
							/>
						) : (
							<>
								<Design.TextInput
									label="API key"
									description="Stored only on this device and sent only to Groq."
									placeholder="Paste your API key"
									secureTextEntry={!showKey}
									defaultValue={settings.apiKey}
									onChange={apiKey => storage.set({ apiKey: apiKey.trim() })}
								/>
								<Design.Button
									size="sm"
									variant="secondary"
									text={showKey ? 'Hide key' : 'Show key'}
									onPress={() => setShowKey(!showKey)}
								/>
							</>
						)}
						<Design.Button
							size="sm"
							variant="secondary"
							text="Test connection"
							onPress={() => void runtime?.testConnection()}
						/>
					</Design.Stack>

					<Design.TableRowGroup title="Display">
						<Design.TableSwitchRow
							icon={<TableRowAssetIcon name="TextIcon" />}
							label="Show text on voice messages"
							subLabel="Show the transcript below the voice message."
							value={settings.inline}
							onValueChange={inline => {
								storage.set({ inline })
								// Rows read the setting while rendering, so rebuild them once it is stored.
								setTimeout(() => runtime?.refreshAll(), 0)
							}}
						/>
						<Design.TableSwitchRow
							label="Also open a result card"
							icon={<TableRowAssetIcon name="CopyIcon" />}
							subLabel="Open a card with a Copy button when the text is ready."
							value={settings.card}
							onValueChange={card => storage.set({ card })}
						/>
					</Design.TableRowGroup>

					<Design.TableRowGroup
						title="Automatic"
						description="Each automatic transcription is a request to your service, so it uses your quota."
					>
						{select(
							'Auto-transcribe',
							AutoModes,
							settings.auto,
							auto => storage.set({ auto }),
							'Transcribe new incoming voice messages by themselves.',
							'BellIcon',
						)}
					</Design.TableRowGroup>

					<Design.TableRowGroup
						title="History"
						description={`Up to ${MaxTranscripts} transcripts are kept so they are still there after a restart.`}
					>
						<Design.TableSwitchRow
							label="Remember transcripts"
							icon={<TableRowAssetIcon name="ClockIcon" />}
							subLabel="Keep transcripts after closing the app."
							value={settings.saveTranscripts}
							onValueChange={saveTranscripts => {
								storage.set({ saveTranscripts })
								if (saveTranscripts) setTimeout(() => runtime?.persist(), 0)
								else runtime?.forgetSaved()
							}}
						/>
						<Design.TableRow
							label={`Clear transcripts (${count})`}
							icon={<TableRowAssetIcon name="TrashIcon" />}
							variant="danger"
							disabled={!count}
							onPress={() => runtime?.clear()}
						/>
					</Design.TableRowGroup>
					<StatsRow />
					<Design.TableRowGroup title="Quick guide">
						<Design.TableRow
							icon={<TableRowAssetIcon name="CircleInformationIcon" />}
							label="Transcribe a voice message"
							subLabel="Long-press a voice message and choose Transcribe. The text appears under the message."
							subLabelLineClamp={4}
						/>
						<Design.TableRow
							icon={<TableRowAssetIcon name="CircleInformationIcon" />}
							label="Providers"
							subLabel="Pick where the audio is sent. Providers that need your own key keep it on this device."
							subLabelLineClamp={4}
						/>
						<Design.TableRow
							icon={<TableRowAssetIcon name="CircleInformationIcon" />}
							label="Saved transcripts"
							subLabel="Turn on saving to keep transcripts after a restart. Clear them any time here."
							subLabelLineClamp={4}
						/>
					</Design.TableRowGroup>
					<Design.Text
						variant="text-xs/normal"
						color="text-muted"
						style={{ textAlign: 'center' }}
					>
						Voice Messages To Text {BUILD}
					</Design.Text>
				</Design.Stack>
			</Page>
		</ScrollView>
	)
}
