import Page from '@valenced/components/Page'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { Design } from '@valenced/discord/design'
import { ScrollView } from 'react-native'
import manifest from '../manifest.json'
import { DefaultSettings } from './shared'
import { openPingSheet } from './sheet'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { RoleMode } from './logic'
import type { Settings } from './shared'

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>

interface SettingItem {
	key: {
		[K in keyof Settings]: Settings[K] extends boolean ? K : never
	}[keyof Settings]
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

const FILTER_ITEMS: SettingItem[] = [
	{
		key: 'excludeEveryone',
		icon: 'AtIcon',
		label: 'Ignore @everyone and @here',
		subLabel: 'Do not count server-wide pings.',
	},
]

const LIST_ITEMS: SettingItem[] = [
	{
		key: 'includeReplies',
		icon: 'ArrowAngleLeftUpIcon',
		label: 'Show replies without a ping',
		subLabel:
			'Also list replies to your messages that did not ping you. Only replies received while Discord is open are listed.',
	},
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
					<Design.Stack spacing={8}>
						<Design.TableRowGroup title="Filters">
							{renderItems(FILTER_ITEMS)}
						</Design.TableRowGroup>
						<Design.TableRadioGroup<RoleMode>
							title="Role mentions"
							value={settings.roleMode}
							onChange={roleMode => {
								void storage.set({ roleMode })
							}}
						>
							<Design.TableRadioRow
								value="all"
								icon={<TableRowAssetIcon name="AtIcon" />}
								label="Count every role ping"
								subLabel="Pings sent to any role you have."
							/>
							<Design.TableRadioRow
								value="except"
								icon={<TableRowAssetIcon name="EyeSlashIcon" />}
								label="Ignore the roles I list"
								subLabel="Every other role ping still counts."
							/>
							<Design.TableRadioRow
								value="only"
								icon={<TableRowAssetIcon name="CheckmarkLargeIcon" />}
								label="Only count the roles I list"
								subLabel="Pings to any other role are ignored."
							/>
						</Design.TableRadioGroup>
						{settings.roleMode !== 'all' && (
							<Design.TextInput
								label="Role IDs"
								description="Separated by commas. Copy a role's ID with Developer Mode on."
								placeholder="123456789012345678, 234567890123456789"
								defaultValue={settings.roleIds}
								onChange={roleIds => {
									void storage.set({ roleIds })
								}}
							/>
						)}
					</Design.Stack>
					<Design.TableRowGroup title="Preview">
						<Design.TableRow
							label="Open ping list"
							icon={<TableRowAssetIcon name="AtIcon" />}
							arrow
							onPress={openPingSheet}
						/>
					</Design.TableRowGroup>
					<Design.TableRowGroup title="Quick guide">
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
						<Design.TableRow
							label="Several pings in one chat"
							icon={<TableRowAssetIcon name="AtIcon" />}
							subLabel="A ping you opened is not offered again, so tapping the chat a second time goes to its next ping."
							subLabelLineClamp={4}
						/>
						<Design.TableRow
							label="Choose what counts"
							icon={<TableRowAssetIcon name="EyeSlashIcon" />}
							subLabel="Under Filters, ignore @everyone and @here, and pick which role pings count by role ID."
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
