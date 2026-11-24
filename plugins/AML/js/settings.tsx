import { getAssetIdByName } from '@valenced/assets'
import { TableRowAssetIcon } from '@valenced/components'
import Page from '@valenced/components/Page'
import { Tokens } from '@valenced/discord/common/tokens'
import { Design } from '@valenced/discord/design'
import { Stores } from '@valenced/discord/flux'
import { useState, useSyncExternalStore } from 'react'
import { Image, Platform, ScrollView, View } from 'react-native'
import { StatsButton } from '../../../lib/stats-ui'
import manifest from '../manifest.json'
import { MaxCacheSize, MinCacheSize } from './engine'
import { ColorRows, Swatch } from './history'
import ServerPicker from './servers'
import { DefaultSettings } from './types'
import type { ComponentType } from 'react'
import type { Journal } from './journal'
import type {
	Entry,
	EntryKind,
	HistoryViewProps,
	IgnoreScope,
	IosHighlight,
	Settings,
} from './types'

export type Controller = {
	journal: Journal
	HistoryView: ComponentType<HistoryViewProps>
	ignored(): { id: string; scope: IgnoreScope | undefined; name: string }[]
	toggleIgnored(id: string): void
	capture(): string
	clearHistory(): void
	clearCache(): void
	confirm(title: string, content: string, onConfirm: () => void): void
	notify(title: string, content: string): void
}

let controller: Controller | undefined
export const setController = (value: Controller | undefined) => {
	controller = value
}

type Screen =
	| { name: 'main' }
	| { name: 'history'; kind: 'all' | EntryKind }
	| { name: 'ignored' }
	| { name: 'servers' }
	| { name: 'color'; key: ColorKey }
	| { name: 'iosColor'; key: 'iosDeletedHighlight' | 'iosEditedHighlight' }

const Colors = {
	deletedMessageColor: 'Deleted message color',
	editedMessageColor: 'Edited message color',
	deletedNameColor: 'Deleted username color',
	deletedHighlightColor: 'Deleted highlight color',
	editedHighlightColor: 'Edited highlight color',
} as const
const HighlightKeys = new Set<ColorKey>([
	'deletedHighlightColor',
	'editedHighlightColor',
])
type ColorKey = keyof typeof Colors

/**
 * iPhone draws a highlight only in Discord's own colors (its chat cell ignores custom ones), so
 * these are the choices there.
 */
type HighlightKey = 'deletedHighlightColor' | 'editedHighlightColor'
type IosKey = 'iosDeletedHighlight' | 'iosEditedHighlight'
const IosKeyOf: Record<HighlightKey, IosKey> = {
	deletedHighlightColor: 'iosDeletedHighlight',
	editedHighlightColor: 'iosEditedHighlight',
}
const IosTitles: Record<IosKey, string> = {
	iosDeletedHighlight: Colors.deletedHighlightColor,
	iosEditedHighlight: Colors.editedHighlightColor,
}
const IosChoices: [IosHighlight, string][] = [
	['red', 'Red'],
	['yellow', 'Yellow'],
	['blurple', 'Blurple'],
]
/** What each iPhone choice looks like, for the preview. */
export const IosHex: Record<IosHighlight, string> = {
	red: '#ED4245',
	yellow: '#F0B232',
	blurple: '#5865F2',
}

const IgnoreGroups: [IgnoreScope | undefined, string][] = [
	['user', 'Ignored users'],
	['DM', 'Ignored DMs'],
	['channel', 'Ignored channels'],
	['server', 'Ignored servers'],
	[undefined, 'Other ignored IDs'],
]

const icon = (name: string) => <TableRowAssetIcon name={name} />

export default function SettingsComponent() {
	if (!controller) {
		return (
			<ScrollView keyboardShouldPersistTaps="handled">
				<Page>
					<Design.TableRowGroup>
						<Design.TableRow
							label="Starting…"
							subLabel="Reopen this page once the plugin has started."
						/>
					</Design.TableRowGroup>
				</Page>
			</ScrollView>
		)
	}
	return <Screens controller={controller} />
}

function Screens({
	controller: {
		journal,
		HistoryView,
		ignored,
		toggleIgnored,
		capture,
		clearHistory,
		clearCache,
		confirm,
		notify,
	},
}: {
	controller: Controller
}) {
	const { settings, entries } = useSyncExternalStore(
		journal.subscribe,
		journal.state,
	)
	const [screen, setScreen] = useState<Screen>({ name: 'main' })
	const set = (patch: Partial<Settings>) => journal.update(patch)
	const back = (
		<Design.Button
			text="Back to settings"
			variant="secondary"
			onPress={() => setScreen({ name: 'main' })}
		/>
	)

	const toggle = (
		key: keyof Settings,
		label: string,
		iconName: string,
		subLabel?: string,
	) => (
		<Design.TableSwitchRow
			label={label}
			subLabel={subLabel}
			icon={icon(iconName)}
			value={settings[key] === true}
			onValueChange={value => set({ [key]: value })}
		/>
	)

	if (screen.name === 'color') {
		const { key } = screen
		return (
			<ScrollView keyboardShouldPersistTaps="handled">
				<Page>
					<Design.Stack spacing={24}>
						{back}
						<ColorRows
							title={Colors[key]}
							value={settings[key]}
							fallback={DefaultSettings[key]}
							onSelect={color => {
								set({ [key]: color })
								setScreen({ name: 'main' })
							}}
						/>
					</Design.Stack>
				</Page>
			</ScrollView>
		)
	}

	if (screen.name === 'iosColor') {
		const { key } = screen
		return (
			<ScrollView keyboardShouldPersistTaps="handled">
				<Page>
					<Design.Stack spacing={24}>
						{back}
						<Design.TableRowGroup title={IosTitles[key]}>
							{IosChoices.map(([value, label]) => (
								<Design.TableRow
									key={value}
									label={label}
									icon={<Swatch color={IosHex[value]} />}
									trailing={
										settings[key] === value ? (
											<TableRowAssetIcon name="CheckmarkLargeIcon" />
										) : undefined
									}
									onPress={() => {
										set({ [key]: value })
										setScreen({ name: 'main' })
									}}
								/>
							))}
						</Design.TableRowGroup>
						<Design.Text variant="text-sm/normal" color="text-muted">
							iPhone draws the highlight box only in Discord's own colors. Red
							and blurple add Discord's note under the message.
						</Design.Text>
					</Design.Stack>
				</Page>
			</ScrollView>
		)
	}

	if (screen.name === 'history') {
		return (
			<ScrollView keyboardShouldPersistTaps="handled">
				<Page>
					<Design.Stack spacing={24}>
						{back}
						<HistoryView
							entries={entries as readonly Entry[]}
							defaultKind={screen.kind}
							saved={settings.savedFilters}
							onSavedChange={savedFilters => set({ savedFilters })}
						/>
					</Design.Stack>
				</Page>
			</ScrollView>
		)
	}

	if (screen.name === 'servers') {
		return (
			<ServerPicker
				back={back}
				selected={settings.serverIds}
				onChange={serverIds => set({ serverIds })}
			/>
		)
	}

	if (screen.name === 'ignored') {
		const targets = ignored()
		return (
			<ScrollView keyboardShouldPersistTaps="handled">
				<Page>
					<Design.Stack spacing={24}>
						{back}
						<Design.TableRowGroup title="Logger exclusions">
							<Design.TableRow
								icon={icon('CircleInformationIcon')}
								label="Choose what stays out of the logger"
								subLabel="Ignored users are skipped in every chat. Ignored DMs, channels and servers are skipped as a whole. Tap an item to stop ignoring it."
							/>
						</Design.TableRowGroup>
						{IgnoreGroups.map(([scope, title]) => {
							const group = targets.filter(target => target.scope === scope)
							if (!scope && !group.length) return null
							return (
								<Design.TableRowGroup
									key={title}
									title={`${title} · ${group.length}`}
								>
									{group.length ? (
										group.map(target => (
											<Design.TableRow
												key={target.id}
												label={target.name}
												subLabel={`${target.id} · tap to stop ignoring`}
												icon={icon('EyeSlashIcon')}
												onPress={() => toggleIgnored(target.id)}
											/>
										))
									) : (
										<Design.TableRow label="None ignored" />
									)}
								</Design.TableRowGroup>
							)
						})}
					</Design.Stack>
				</Page>
			</ScrollView>
		)
	}

	return (
		<ScrollView keyboardShouldPersistTaps="handled">
			<Page>
				<Design.Stack spacing={24}>
					<Design.TableRowGroup title="Journal">
						<Design.TableRow
							label="Deleted messages"
							icon={icon('TrashIcon')}
							arrow
							onPress={() => setScreen({ name: 'history', kind: 'deleted' })}
						/>
						<Design.TableRow
							label="Edited messages"
							icon={icon('PencilIcon')}
							arrow
							onPress={() => setScreen({ name: 'history', kind: 'edited' })}
						/>
					</Design.TableRowGroup>
					<Design.TableRowGroup title="Capture">
						{toggle('logDeletes', 'Log deletions', 'TrashIcon')}
						{toggle('logEdits', 'Log edits', 'PencilIcon')}
						{toggle('skipBots', 'Skip bots', 'RobotIcon')}
						{toggle('skipSelf', 'Skip my messages', 'UserCircleIcon')}
						<Design.TableRow
							label="Check message capture"
							icon={icon('WrenchIcon')}
							onPress={() => notify('Message capture', capture())}
						/>
					</Design.TableRowGroup>
					<Design.TableRadioGroup
						title="Capture mode"
						value={settings.captureMode}
						onChange={value =>
							set({ captureMode: value === 'loaded' ? 'loaded' : 'all' })
						}
					>
						<Design.TableRadioRow
							label="All"
							value="all"
							subLabel="Watch every message event Discord receives."
						/>
						<Design.TableRadioRow
							label="Loaded"
							value="loaded"
							subLabel="Watch the open chat and chats with loaded messages."
						/>
					</Design.TableRadioGroup>
					<CacheLimitInput
						value={settings.cacheLimit}
						onAccept={cacheLimit => set({ cacheLimit })}
					/>
					<Design.TableRadioGroup
						title="Deleted and edited messages"
						value={settings.messageStyle}
						onChange={value =>
							set({
								messageStyle:
									value === 'text' || value === 'box' ? value : 'highlight',
							})
						}
					>
						<Design.TableRadioRow
							label="Highlight"
							value="highlight"
							subLabel="Colored text, a colored box and line, and a note under the message (Discord's AutoMod style)."
						/>
						<Design.TableRadioRow
							label="Box"
							value="box"
							subLabel="Colored text with your highlight colors as box and line, without the note."
						/>
						<Design.TableRadioRow
							label="Text only"
							value="text"
							subLabel="Only the colored text, no box and no note."
						/>
					</Design.TableRadioGroup>
					<StylePreview settings={settings} />
					<Design.TableRadioGroup
						title="Replies to deleted messages"
						value={settings.quoteAuthorAs}
						onChange={value =>
							set({ quoteAuthorAs: value === 'name' ? 'name' : 'mention' })
						}
					>
						<Design.TableRadioRow
							label="@mention"
							value="mention"
							subLabel="The quote mentions the author. They get pinged unless you turn the reply's mention off."
						/>
						<Design.TableRadioRow
							label="@name"
							value="name"
							subLabel="The quote shows the author's name as plain text. Nobody is pinged."
						/>
					</Design.TableRadioGroup>
					<Design.TableRowGroup title="In chat">
						{toggle(
							'showTag',
							'Show a tag next to the name',
							'TagIcon',
							'"Deleted" or "Edited", in the highlight color.',
						)}
						{toggle(
							'dismissButton',
							'Dismiss button',
							'XSmallIcon',
							'Uses Discord\'s note under logged messages, with a "Dismiss" link (it brings a "?" button). Dismiss removes the edits of an edited message, or a deleted message from the chat and the history. Only with the Highlight style.',
						)}
						{toggle(
							'retainDeleted',
							'Keep deleted messages visible',
							'TrashIcon',
							'Deleted messages stay in the chat, marked as deleted. Off: they disappear as usual and stay only in the history.',
						)}
						{toggle(
							'dimDeletedMedia',
							'Dim photos of deleted messages',
							'ImageIcon',
						)}
						{toggle(
							'fillDeletedReplies',
							'Show deleted messages in replies',
							'ArrowAngleLeftUpIcon',
							'Instead of "Original message was deleted", when the message is in the log.',
						)}
						{toggle(
							'showInlineEdits',
							'Show previous versions in chat',
							'PencilIcon',
						)}
						{toggle(
							'colorDeletedUsername',
							'Color deleted usernames',
							'UserCircleIcon',
						)}
						{toggle('showDeletedTime', 'Show deletion time', 'ClockIcon')}
						{toggle('showEditTime', 'Show edit time', 'ClockIcon')}
						{toggle('showSeconds', 'Show seconds in times', 'ClockIcon')}
						{toggle('use12HourClock', 'Use a 12-hour clock', 'ClockIcon')}
						{(Object.keys(Colors) as ColorKey[]).map(key => {
							// iPhone draws highlights only in Discord's own colors: same row, fewer choices.
							const ios = Platform.OS === 'ios' && HighlightKeys.has(key)
							const preset = ios ? IosKeyOf[key as HighlightKey] : undefined
							return (
								<Design.TableRow
									key={key}
									label={Colors[key]}
									subLabel={
										!HighlightKeys.has(key)
											? undefined
											: settings.messageStyle === 'text'
												? 'For Highlight and Box. Not used with Text only.'
												: 'For Highlight and Box.'
									}
									icon={icon('PaintPaletteIcon')}
									trailing={
										<Swatch
											color={preset ? IosHex[settings[preset]] : settings[key]}
										/>
									}
									arrow
									disabled={
										HighlightKeys.has(key) && settings.messageStyle === 'text'
									}
									onPress={() =>
										setScreen(
											preset
												? { name: 'iosColor', key: preset }
												: { name: 'color', key },
										)
									}
								/>
							)
						})}
					</Design.TableRowGroup>
					<Design.TableRowGroup title="Filters">
						{toggle(
							'onlySelectedServers',
							'Ignore all servers except…',
							'ShieldIcon',
							'Log messages only from the servers you pick. Keeps the cache from filling up with servers you rarely open.',
						)}
						{settings.onlySelectedServers ? (
							<Design.TableRow
								label="Choose servers to log"
								subLabel={`${settings.serverIds.length} selected`}
								icon={icon('HomeIcon')}
								arrow
								onPress={() => setScreen({ name: 'servers' })}
							/>
						) : null}
						{toggle(
							'keepDMs',
							'Log DMs and group DMs',
							'ChatMarkUnreadIcon',
							'Direct messages are not affected by the server selection.',
						)}
						<Design.TableRow
							label="Ignored users, DMs and channels"
							subLabel={`${ignored().length} exclusions`}
							icon={icon('EyeSlashIcon')}
							arrow
							onPress={() => setScreen({ name: 'ignored' })}
						/>
					</Design.TableRowGroup>
					<Design.TableRowGroup title="Local storage">
						{toggle(
							'persist',
							'Save history across restarts',
							'ClipboardListIcon',
							'Keep logged edits and deletions after restarting Discord.',
						)}
						{toggle(
							'rememberReceived',
							'Remember new messages',
							'ClockIcon',
							'Keep received messages after a restart so later edits and deletions are still recognized.',
						)}
						<Design.TableRow
							label="Clear everything"
							subLabel="The history and the cached messages on this device."
							icon={icon('TrashIcon')}
							variant="danger"
							onPress={() =>
								confirm(
									'Clear everything?',
									'This removes the history and every cached message from this device. It cannot be undone.',
									() => {
										clearHistory()
										clearCache()
									},
								)
							}
						/>
					</Design.TableRowGroup>
					<Design.TableRadioGroup
						title="History retention"
						value={String(settings.retentionDays)}
						onChange={value => set({ retentionDays: Number(value) })}
					>
						{[1, 7, 30, 0].map(days => (
							<Design.TableRadioRow
								key={days}
								value={String(days)}
								label={
									days === 0
										? 'Forever'
										: `${days} ${days === 1 ? 'day' : 'days'}`
								}
							/>
						))}
					</Design.TableRadioGroup>
					<StatsButton manifest={manifest} settings={() => settings} />
					<Design.TableRowGroup title="Quick guide">
						<Design.TableRow
							icon={icon('CircleInformationIcon')}
							label="Journal"
							subLabel="Open the journal to see the previous text of edited or deleted messages. Search, filter by date or save a search to reuse it."
						/>
						<Design.TableRow
							icon={icon('CircleInformationIcon')}
							label="In chat"
							subLabel="Deleted messages stay visible when you reopen their chat. Long-press a message to view or remove its history. On an edited message, Compare edits shows what changed between versions."
						/>
						<Design.TableRow
							icon={icon('CircleInformationIcon')}
							label="Ignore people and places"
							subLabel="Long-press a message, DM, channel or server, or open a profile menu, to exclude it. Undo it under Filters."
						/>
						<Design.TableRow
							icon={icon('CircleInformationIcon')}
							label="Privacy"
							subLabel="Only messages this device received are logged. Logged messages stay on this device, and messages never received cannot be recovered."
						/>
					</Design.TableRowGroup>
					<Design.Text
						variant="text-xs/normal"
						color="text-muted"
						style={{ textAlign: 'center' }}
					>
						{`Adv. Message Logger ${manifest.version}`}
					</Design.Text>
				</Design.Stack>
			</Page>
		</ScrollView>
	)
}

function CacheLimitInput({
	value,
	onAccept,
}: {
	value: number
	onAccept(value: number): void
}) {
	const [draft, setDraft] = useState(String(value))
	return (
		<Design.TextInput
			label="Maximum cached messages"
			description={`${MinCacheSize}–${MaxCacheSize} messages. Default: ${DefaultSettings.cacheLimit}.`}
			value={draft}
			onChange={setDraft}
			onBlur={() => {
				const count = Number(draft.trim())
				if (
					Number.isInteger(count) &&
					count >= MinCacheSize &&
					count <= MaxCacheSize
				)
					onAccept(count)
				else setDraft(String(value))
			}}
		/>
	)
}

/** A semantic token as a plain color for the current theme, trying each name in turn. */
function themeColor(names: string[], fallback: string) {
	try {
		const { colors, internal } = Tokens.default as unknown as {
			colors: Record<string, unknown>
			internal: {
				resolveSemanticColor(theme: unknown, color: unknown): unknown
			}
		}
		const theme = (Stores.ThemeStore as unknown as { theme?: string }).theme
		for (const name of names) {
			if (!colors[name]) continue
			const value = internal.resolveSemanticColor(theme, colors[name])
			if (typeof value === 'string' && value !== 'transparent') return value
		}
	} catch {}
	return fallback
}

type SampleProps = {
	style: Settings['messageStyle']
	name: string
	nameColor?: string
	time: string
	text: string
	textColor?: string
	box?: string
	note?: string
	old?: string
	avatar: string
}

/**
 * One chat message as Discord draws it, in the chosen style.
 * custom: Discord has no component that draws a sample chat message.
 */
function Sample(props: SampleProps) {
	const boxed = props.box && props.style !== 'text'
	const strong = themeColor(['TEXT_STRONG', 'HEADER_PRIMARY'], '#F2F3F5')
	const normal = themeColor(['TEXT_DEFAULT', 'TEXT_NORMAL'], '#DBDEE1')
	const muted = themeColor(['TEXT_MUTED'], '#949BA4')
	const shield = getAssetIdByName('ShieldIcon')
	return (
		<View
			style={{
				flexDirection: 'row',
				gap: 12,
				paddingVertical: 8,
				paddingLeft: 13,
				paddingRight: 16,
				borderLeftWidth: 3,
				borderLeftColor: boxed ? props.box : 'transparent',
				backgroundColor: boxed ? `${props.box}26` : 'transparent',
			}}
		>
			<View
				style={{
					width: 36,
					height: 36,
					borderRadius: 18,
					backgroundColor: props.avatar,
					alignItems: 'center',
					justifyContent: 'center',
				}}
			>
				<Design.Text variant="text-md/bold" style={{ color: '#FFFFFF' }}>
					{props.name[0]}
				</Design.Text>
			</View>
			<View style={{ flex: 1, gap: 2 }}>
				<View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
					<Design.Text
						variant="text-md/semibold"
						style={{ color: props.nameColor ?? strong }}
					>
						{props.name}
					</Design.Text>
					<Design.Text variant="text-xs/medium" style={{ color: muted }}>
						{props.time}
					</Design.Text>
				</View>
				{props.old ? (
					<Design.Text variant="text-xs/normal" style={{ color: muted }}>
						{props.old}
					</Design.Text>
				) : null}
				<Design.Text
					variant="text-md/normal"
					style={{ color: props.textColor ?? normal }}
				>
					{props.text}
				</Design.Text>
				{props.note && props.style === 'highlight' ? (
					<View
						style={{
							flexDirection: 'row',
							alignItems: 'center',
							gap: 6,
							marginTop: 2,
						}}
					>
						{shield ? (
							<Image
								source={shield}
								style={{ width: 14, height: 14, tintColor: muted }}
							/>
						) : null}
						<Design.Text variant="text-xs/medium" style={{ color: muted }}>
							{props.note}
						</Design.Text>
					</View>
				) : null}
			</View>
		</View>
	)
}

/** A short chat with an edited and a deleted message, in the chosen style and colors. */
function StylePreview({ settings }: { settings: Settings }) {
	const style = settings.messageStyle
	const deletedText = settings.deletedMessageColor
	const editedText = settings.editedMessageColor
	const chat = themeColor(
		['BACKGROUND_BASE_LOWER', 'BACKGROUND_PRIMARY', 'BG_BASE_PRIMARY'],
		'#313338',
	)
	return (
		<Design.TableRowGroup title="Preview">
			<View
				style={{
					backgroundColor: chat,
					paddingVertical: 6,
					borderRadius: 12,
					overflow: 'hidden',
				}}
			>
				<Sample
					style={style}
					name="Alex"
					avatar="#5865F2"
					time="Today at 12:01"
					text="See you at 5?"
				/>
				<Sample
					style={style}
					name="Sam"
					avatar="#3BA55C"
					time="Today at 12:02"
					old={settings.showInlineEdits ? 'Sure, at 6' : undefined}
					text="Sure, at 5 then"
					textColor={Platform.OS === 'ios' ? editedText : undefined}
					box={
						Platform.OS === 'ios'
							? IosHex[settings.iosEditedHighlight]
							: settings.editedHighlightColor
					}
					note="Edited"
				/>
				<Sample
					style={style}
					name="Sam"
					nameColor={
						settings.colorDeletedUsername
							? settings.deletedNameColor
							: undefined
					}
					avatar="#3BA55C"
					time="Today at 12:03"
					text="I won't make it"
					textColor={deletedText}
					box={
						Platform.OS === 'ios'
							? IosHex[settings.iosDeletedHighlight]
							: settings.deletedHighlightColor
					}
					note="Deleted"
				/>
			</View>
		</Design.TableRowGroup>
	)
}
