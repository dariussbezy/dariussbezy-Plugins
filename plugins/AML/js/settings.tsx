import { TableRowAssetIcon } from '@valenced/components'
import Page from '@valenced/components/Page'
import { Design } from '@valenced/discord/design'
import { useState, useSyncExternalStore } from 'react'
import { ScrollView } from 'react-native'
import manifest from '../manifest.json'
import { MaxCacheSize } from './engine'
import { ColorRows, Swatch } from './history'
import { DefaultSettings } from './types'
import type { ComponentType } from 'react'
import type { Journal } from './journal'
import type {
	Entry,
	EntryKind,
	HistoryViewProps,
	IgnoreScope,
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
	| { name: 'color'; key: ColorKey }

const Colors = {
	deletedMessageColor: 'Deleted message color',
	editedMessageColor: 'Edited message color',
	deletedNameColor: 'Deleted username color',
} as const
type ColorKey = keyof typeof Colors

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
					<Design.TableRowGroup title="In chat">
						{toggle(
							'retainDeleted',
							'Keep deleted messages visible',
							'TrashIcon',
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
						{(Object.keys(Colors) as ColorKey[]).map(key => (
							<Design.TableRow
								key={key}
								label={Colors[key]}
								icon={icon('PaintPaletteIcon')}
								trailing={<Swatch color={settings[key]} />}
								arrow
								onPress={() => setScreen({ name: 'color', key })}
							/>
						))}
					</Design.TableRowGroup>
					<Design.TableRowGroup title="Filters">
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
							label="Clear local history"
							icon={icon('TrashIcon')}
							variant="danger"
							onPress={() =>
								confirm(
									'Clear local history?',
									'This removes the journal from this device.',
									clearHistory,
								)
							}
						/>
						<Design.TableRow
							label="Clear recent message cache"
							icon={icon('TrashIcon')}
							variant="danger"
							onPress={() =>
								confirm(
									'Clear recent message cache?',
									'This removes cached messages from this device.',
									clearCache,
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
							subLabel="Only messages this device received are logged. Nothing is uploaded, and messages never received cannot be recovered."
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
			description={`25–${MaxCacheSize} messages. Default: ${DefaultSettings.cacheLimit}.`}
			value={draft}
			onChange={setDraft}
			onBlur={() => {
				const count = Number(draft.trim())
				if (Number.isInteger(count) && count >= 25 && count <= MaxCacheSize)
					onAccept(count)
				else setDraft(String(value))
			}}
		/>
	)
}
