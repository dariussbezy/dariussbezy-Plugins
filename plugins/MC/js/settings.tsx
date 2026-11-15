import Page from '@valenced/components/Page'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { ToastActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { useCallback, useEffect, useState } from 'react'
import { Linking, Platform, ScrollView } from 'react-native'
import manifest from '../manifest.json'
import { refresh, restorePlayer, useMusic } from './music'
import { APP_URL, androidBridge, probe } from './native'
import { Player } from './player'
import { presenceReady } from './presence'
import { openSearch } from './search'
import { ButtonIds, setSetting, useSettings } from './shared'
import { reconnect } from './spotify'
import type { ComponentProps } from 'react'
import type { ButtonId, PlayerMode, Settings } from './shared'

type RowProps = Omit<ComponentProps<typeof Design.TableRow>, 'icon'> & {
	icon: string
}
type SwitchProps = Omit<
	ComponentProps<typeof Design.TableSwitchRow>,
	'icon'
> & {
	icon: string
}

const Row = ({ icon, ...props }: RowProps) => (
	<Design.TableRow
		subLabelLineClamp={5}
		{...props}
		icon={<TableRowAssetIcon name={icon} />}
	/>
)
const SwitchRow = ({ icon, ...props }: SwitchProps) => (
	<Design.TableSwitchRow {...props} icon={<TableRowAssetIcon name={icon} />} />
)

const BUTTON_LABELS: Record<ButtonId, { label: string; icon: string }> = {
	Shuffle: { label: 'Shuffle', icon: 'ArrowsLeftRightIcon' },
	Previous: { label: 'Previous', icon: 'ArrowSmallLeftIcon' },
	Play: { label: 'Play / pause', icon: 'PlayIcon' },
	Next: { label: 'Next', icon: 'ArrowSmallRightIcon' },
	Repeat: { label: 'Repeat', icon: 'RefreshIcon' },
	Search: { label: 'Search (Spotify)', icon: 'MagnifyingGlassIcon' },
}

const GUIDE: [string, string, string][] = [
	[
		'Which apps',
		'MusicIcon',
		'Spotify works on Android and iOS through the Spotify account linked in Discord > Connections. YouTube Music and SoundCloud work only on Android, with the Music Controls app (APK).',
	],
	[
		'Playback controls',
		'PlayIcon',
		'Pause, resume, skip and go back. Tap or drag the progress bar to seek. Long-press the song to open it in the app that plays. Spotify may require Premium for playback controls.',
	],
	[
		'Shuffle and repeat',
		'ArrowsLeftRightIcon',
		'Shown for Spotify and YouTube Music. SoundCloud does not share them with other apps, so the buttons are hidden while it plays.',
	],
	[
		'Search and queue',
		'MagnifyingGlassIcon',
		'Spotify only. Tap a result to play it now, or use the buttons on the row to play it next or add it to the queue.',
	],
	[
		'Listening status',
		'MusicIcon',
		'Android only, off by default. While YouTube Music or SoundCloud plays, your profile shows Listening to YouTube Music or SoundCloud with the song, the artist and the time. It updates every few seconds while Discord is in the background and clears when the music stops.',
	],
	[
		'Swipe the player',
		'ChevronSmallDownIcon',
		'Swipe left or right to hide it for this music session, then tap the music button beside the YouBar buttons to restore it. Drag the card up or down, or tap its handle, to switch between closed, small and expanded.',
	],
	[
		'Animated wave',
		'WaveformIcon',
		'Turn Animated waves on for a moving wave or off for the standard slider. Motion pauses with playback and respects Reduce Motion.',
	],
	[
		'Setting up the app',
		'DownloadIcon',
		'Install the Music Controls app, open it and turn on notification access. On Android 13 and newer, if the switch is greyed out, open App info for Music Controls, tap ⋮, choose Allow restricted settings and try again.',
	],
	[
		'Automatic hiding',
		'EyeSlashIcon',
		'The player disappears when nothing plays or after five minutes paused, and returns when playback resumes.',
	],
]

function ButtonGroup({ mode }: { mode: PlayerMode }) {
	const settings = useSettings()
	return (
		<Design.TableRowGroup
			title={
				mode === 'expanded'
					? 'Expanded player buttons'
					: 'Compact player buttons'
			}
		>
			{ButtonIds.map(id => {
				const key = `${mode}${id}` as keyof Settings
				return (
					<SwitchRow
						key={key}
						icon={BUTTON_LABELS[id].icon}
						label={BUTTON_LABELS[id].label}
						value={settings[key]}
						onValueChange={value => setSetting(key, value)}
					/>
				)
			})}
		</Design.TableRowGroup>
	)
}

function Diagnostics() {
	const music = useMusic()
	const [native, setNative] = useState<{ ok: boolean; detail: string } | null>(
		null,
	)
	const check = useCallback(() => {
		setNative(null)
		if (androidBridge) void probe().then(setNative)
		void refresh()
	}, [])
	useEffect(check, [check])

	const playback = music.playback
	const rows: [string, string, boolean][] = [
		['Platform', `${Platform.OS} ${Platform.Version}`, true],
		['Spotify', music.spotifyStatus, music.spotifyConnected],
	]
	if (androidBridge)
		rows.push(
			['Native part', native ? native.detail : 'Checking…', native?.ok ?? true],
			['Music Controls app', music.bridgeStatus, music.bridgeConnected],
		)
	rows.push([
		'Now playing',
		playback
			? `${playback.title}${playback.app ? ` (${playback.app})` : ''}, cover ${playback.artwork ? 'yes' : 'no'}, shuffle ${playback.canShuffle ? 'yes' : 'no'}, repeat ${playback.canRepeat ? 'yes' : 'no'}`
			: 'Nothing',
		!!playback,
	])
	const report = [
		`Music Controls ${manifest.version}`,
		...rows.map(([label, value]) => `${label}: ${value}`),
	].join('\n')

	return (
		<Design.TableRowGroup title="Diagnostics">
			{rows.map(([label, value, ok]) => (
				<Row
					key={label}
					icon={ok ? 'CircleCheckIcon' : 'CircleWarningIcon'}
					label={label}
					subLabel={value}
				/>
			))}
			<Row icon="RefreshIcon" label="Check again" onPress={check} />
			<Row
				icon="CopyIcon"
				label="Copy diagnostics"
				onPress={() => {
					void Clipboard.setString(report)
					ToastActionCreators.open('dariuss.music-controls.copied', {
						text: 'Diagnostics copied',
					})
				}}
			/>
		</Design.TableRowGroup>
	)
}

export default function SettingsComponent() {
	const settings = useSettings()
	const music = useMusic()

	return (
		<ScrollView keyboardShouldPersistTaps="handled">
			<Page>
				<Design.Stack spacing={24}>
					<Design.TableRowGroup title="Spotify · Android and iOS">
						<Row
							icon="LinkIcon"
							label={music.spotifyConnected ? 'Connected' : 'Connection status'}
							subLabel={music.spotifyStatus}
						/>
						<Row
							icon="LinkIcon"
							label="Reconnect"
							subLabel="Use the Spotify account already linked to Discord. No app needed."
							arrow
							onPress={() => {
								reconnect()
							}}
						/>
						<Row
							icon="MagnifyingGlassIcon"
							label="Search Spotify"
							subLabel="Find a song, then play it now, play it next or add it to the queue."
							arrow
							onPress={openSearch}
						/>
					</Design.TableRowGroup>
					<Design.TableRowGroup title="YouTube Music and SoundCloud · Android only">
						{androidBridge ? (
							<>
								<Row
									icon={music.bridgeConnected ? 'CircleCheckIcon' : 'LinkIcon'}
									label={
										music.bridgeConnected ? 'Connected' : 'Connection status'
									}
									subLabel={music.bridgeStatus}
								/>
								<Row
									icon="DownloadIcon"
									label="Download the Music Controls app"
									subLabel="Only for Android users who listen on YouTube Music or SoundCloud. Not needed for Spotify, and not for iPhone. Opens the APK in your browser."
									arrow
									onPress={() => void Linking.openURL(APP_URL)}
								/>
								{presenceReady() && (
									<SwitchRow
										icon="MusicIcon"
										label="Listening status"
										subLabel="Show Listening to YouTube Music or SoundCloud with the song and its time on your profile. Spotify shows its own."
										value={settings.listeningStatus}
										onValueChange={value => {
											setSetting('listeningStatus', value)
											// Shows or clears the status right away.
											setTimeout(() => void refresh(), 100)
										}}
									/>
								)}
							</>
						) : (
							<Row
								icon="CircleWarningIcon"
								label="Not available on iPhone"
								subLabel="iOS does not let Discord read or control music from other apps, and the Music Controls app (APK) is Android only. Spotify works through Discord."
							/>
						)}
						<Row
							icon="RefreshIcon"
							label="Refresh playback"
							arrow
							onPress={() => void refresh()}
						/>
					</Design.TableRowGroup>
					<Design.TableRowGroup title="Player">
						<SwitchRow
							icon="ChevronSmallDownIcon"
							label="Compact player"
							subLabel="Start with the compact player. Tap the song to expand it."
							value={settings.compact}
							onValueChange={value => setSetting('compact', value)}
						/>
						<SwitchRow
							icon="MusicIcon"
							label="Always show player"
							subLabel="Keep a small bar on screen when nothing is playing, with Spotify search."
							value={settings.alwaysShow}
							onValueChange={value => setSetting('alwaysShow', value)}
						/>
						<SwitchRow
							icon="WaveformIcon"
							label="Animated waves"
							subLabel="On: animated waves. Off: the standard slider."
							value={settings.animatedWave}
							onValueChange={value => setSetting('animatedWave', value)}
						/>
						{music.dismissed && (
							<Row
								icon="MusicIcon"
								label="Restore player"
								subLabel="Show the player you swiped away."
								arrow
								onPress={restorePlayer}
							/>
						)}
					</Design.TableRowGroup>
					<ButtonGroup mode="expanded" />
					<ButtonGroup mode="compact" />
					<Design.TableRowGroup title="Expanded player preview">
						<Player previewMode="expanded" />
					</Design.TableRowGroup>
					<Design.TableRowGroup title="Compact player preview">
						<Player previewMode="compact" />
					</Design.TableRowGroup>
					<Diagnostics />
					<Design.TableRowGroup title="Quick guide">
						{GUIDE.map(([label, icon, subLabel]) => (
							<Row key={label} icon={icon} label={label} subLabel={subLabel} />
						))}
					</Design.TableRowGroup>
					<Design.Stack align="center">
						<Design.Text variant="text-xs/normal" color="text-muted">
							{`Music Controls ${manifest.version}`}
						</Design.Text>
					</Design.Stack>
				</Design.Stack>
			</Page>
		</ScrollView>
	)
}
