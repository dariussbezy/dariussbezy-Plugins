import Page from '@valenced/components/Page'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { Design } from '@valenced/discord/design'
import { ScrollView } from 'react-native'
import manifest from '../manifest.json'
import { DefaultSettings } from './shared'
import { openPingSheet } from './sheet'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { Settings } from './shared'

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>

interface SettingItem {
	key: keyof Settings
	icon: string
	label: string
	subLabel: string
}

const BUTTON_ITEMS: SettingItem[] = [
	{
		key: 'hideWhenEmpty',
		icon: 'BellIcon',
		label: 'Only show with pings',
		subLabel: 'Hide the button when you have no unread pings.',
	},
	{
		key: 'showBadge',
		icon: 'AtIcon',
		label: 'Show count badge',
		subLabel: 'Show the number of unread pings on the button.',
	},
]

const LIST_ITEMS: SettingItem[] = [
	{
		key: 'includeDMs',
		icon: 'ChatMarkUnreadIcon',
		label: 'Include DMs',
		subLabel: 'List unread direct messages as pings.',
	},
	{
		key: 'keepUnvisitedPings',
		icon: 'AtIcon',
		label: 'Keep unvisited pings',
		subLabel:
			'Keep channel pings in a local queue until you open them, even after Discord marks the channel read. Does not apply to DMs. Resets when Discord restarts.',
	},
]

export default function SettingsComponent({
	api: { jsonStorage: storage },
}: Props) {
	const settings = { ...DefaultSettings, ...storage.use() }

	const renderItems = (items: SettingItem[]) =>
		items.map(({ key, icon, label, subLabel }) => (
			<Design.TableSwitchRow
				key={key}
				icon={<TableRowAssetIcon name={icon} />}
				label={label}
				subLabel={subLabel}
				subLabelLineClamp={4}
				value={settings[key]}
				onValueChange={value => {
					void storage.set({ [key]: value })
				}}
			/>
		))

	return (
		<ScrollView keyboardShouldPersistTaps="handled">
			<Page>
				<Design.Stack spacing={24}>
					<Design.TableRowGroup title="Button">
						{renderItems(BUTTON_ITEMS)}
					</Design.TableRowGroup>
					<Design.TableRowGroup title="List">
						{renderItems(LIST_ITEMS)}
					</Design.TableRowGroup>
					<Design.TableRowGroup title="Preview">
						<Design.TableRow
							label="Open ping list"
							icon={<TableRowAssetIcon name="AtIcon" />}
							arrow
							onPress={openPingSheet}
						/>
					</Design.TableRowGroup>
					<Design.TableRowGroup title="How it works">
						<Design.TableRow
							label="Open the list"
							icon={<TableRowAssetIcon name="CircleInformationIcon" />}
							subLabel="Tap the button beside the notifications bell. Tap a chat to jump to its first unread ping; pick a message when it has several. Read marks a chat as read."
							subLabelLineClamp={6}
						/>
						<Design.TableRow
							label="Jump to the newest chat"
							icon={<TableRowAssetIcon name="ClockIcon" />}
							subLabel="Long-press the button to open the first unread ping of the most recently active chat."
							subLabelLineClamp={4}
						/>
					</Design.TableRowGroup>
					<Design.Text
						variant="text-xs/normal"
						color="text-muted"
						style={{ textAlign: 'center' }}
					>
						Jump to Ping {manifest.version}
					</Design.Text>
				</Design.Stack>
			</Page>
		</ScrollView>
	)
}
