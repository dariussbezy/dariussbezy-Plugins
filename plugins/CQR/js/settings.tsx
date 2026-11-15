import { getAssetIdByName } from '@valenced/assets'
import Page from '@valenced/components/Page'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import {
	ActionSheetActionCreators,
	ToastActionCreators,
} from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Stores } from '@valenced/discord/flux'
import { lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { useSyncExternalStore } from 'react'
import { Image, ScrollView } from 'react-native'
import manifest from '../manifest.json'
import {
	getSettings,
	keyOf,
	setSettings,
	snapshot,
	subscribe,
	toSaved,
} from './shared'
import type { EmojiPicker, RowEmoji, SavedEmoji } from './shared'

const REACTION_INTENTION = 0

const GUIDE: [string, string][] = [
	[
		'Add emoji does nothing?',
		'Discord loads its emoji picker the first time you use it. Long-press a message, tap the smiley at the end of the reactions, close it and come back.',
	],
	[
		'How many are shown',
		'Discord fits about six emojis in the row, depending on the screen. Emojis past that are kept but not shown.',
	],
	[
		'Frequent emojis',
		'With filling on, spots left over show your frequent emojis like before. Turn it off to show only your own.',
	],
	[
		'Custom emojis',
		'Emojis from servers you left, or that need Nitro, cannot be used for reactions.',
	],
]

interface ChannelStores {
	SelectedChannelStore: { getChannelId(): string | undefined }
	ChannelStore: { getChannel(id: string): unknown }
}

function currentChannel() {
	const { SelectedChannelStore, ChannelStore } =
		Stores as unknown as ChannelStores
	const id = SelectedChannelStore?.getChannelId()
	return id ? ChannelStore?.getChannel(id) : undefined
}

/** The picker module, once Discord has loaded it. */
function findPicker() {
	const [picker] = lookupModule(
		withProps<EmojiPicker>('openEmojiPickerActionSheet'),
	)
	return picker
}

function Preview({ emoji }: { emoji: SavedEmoji }) {
	if (emoji.id)
		return (
			// custom: Discord's emoji image needs its CDN URL; no design component takes an emoji
			<Image
				source={{
					uri: `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'webp'}?size=48`,
				}}
				style={{ width: 24, height: 24 }}
			/>
		)
	return (
		<Design.Text variant="heading-lg/normal">{emoji.surrogates}</Design.Text>
	)
}

export default function SettingsComponent() {
	useSyncExternalStore(subscribe, snapshot, snapshot)
	const { emojis, fill } = getSettings()
	const trash = getAssetIdByName('TrashIcon')
	const up = getAssetIdByName('ArrowSmallUpIcon')
	const down = getAssetIdByName('ArrowSmallDownIcon')

	const move = (index: number, by: number) => {
		const next = [...emojis]
		;[next[index], next[index + by]] = [next[index + by], next[index]]
		setSettings({ emojis: next })
	}
	const remove = (index: number) =>
		setSettings({ emojis: emojis.filter((_, other) => other !== index) })
	const add = () => {
		const picker = findPicker()
		if (!picker) {
			ToastActionCreators.open('dariuss.custom-quick-reactions.picker', {
				text: 'Open the emoji picker once from a message, then try again.',
			})
			return
		}
		picker.openEmojiPickerActionSheet(
			{
				onPressEmoji(emoji: RowEmoji) {
					try {
						ActionSheetActionCreators.hideActionSheet()
					} catch {}
					const saved = toSaved(emoji)
					const { emojis: current } = getSettings()
					if (saved && !current.some(other => keyOf(other) === keyOf(saved)))
						setSettings({ emojis: [...current, saved] })
				},
				channel: currentChannel(),
				pickerIntention: REACTION_INTENTION,
			},
			'stack',
		)
	}

	return (
		<ScrollView keyboardShouldPersistTaps="handled">
			<Page>
				<Design.Stack spacing={24}>
					<Design.TableRowGroup title="Quick reactions">
						{emojis.length ? (
							emojis.map((emoji, index) => (
								<Design.TableRow
									key={keyOf(emoji)}
									label={`:${emoji.name}:`}
									icon={<Preview emoji={emoji} />}
									trailing={
										<Design.Stack
											direction="horizontal"
											align="center"
											spacing={8}
										>
											{up != null && (
												<Design.IconButton
													icon={up}
													size="sm"
													variant="secondary"
													accessibilityLabel={`Move ${emoji.name} up`}
													disabled={index === 0}
													onPress={() => move(index, -1)}
												/>
											)}
											{down != null && (
												<Design.IconButton
													icon={down}
													size="sm"
													variant="secondary"
													accessibilityLabel={`Move ${emoji.name} down`}
													disabled={index === emojis.length - 1}
													onPress={() => move(index, 1)}
												/>
											)}
											{trash != null && (
												<Design.IconButton
													icon={trash}
													size="sm"
													variant="destructive"
													accessibilityLabel={`Remove ${emoji.name}`}
													onPress={() => remove(index)}
												/>
											)}
										</Design.Stack>
									}
								/>
							))
						) : (
							<Design.TableRow
								icon={<TableRowAssetIcon name="CircleInformationIcon" />}
								label="No emojis yet"
								subLabel="Discord's frequent emojis are shown until you add some."
							/>
						)}
					</Design.TableRowGroup>
					<Design.TableRowGroup>
						<Design.TableRow
							icon={<TableRowAssetIcon name="PlusSmallIcon" />}
							label="Add emoji"
							subLabel="Pick one from Discord's emoji picker."
							onPress={add}
						/>
						<Design.TableSwitchRow
							icon={<TableRowAssetIcon name="ReactionIcon" />}
							label="Fill with frequent emojis"
							subLabel="Show your frequent emojis in the spots left over."
							value={fill}
							onValueChange={value => setSettings({ fill: value })}
						/>
						<Design.TableRow
							icon={<TableRowAssetIcon name="RefreshIcon" />}
							label="Reset"
							subLabel="Remove your emojis and show Discord's frequent ones again."
							variant="danger"
							disabled={!emojis.length}
							onPress={() => setSettings({ emojis: [] })}
						/>
					</Design.TableRowGroup>
					<Design.TableRowGroup title="Quick guide">
						{GUIDE.map(([label, subLabel]) => (
							<Design.TableRow
								key={label}
								icon={<TableRowAssetIcon name="CircleInformationIcon" />}
								label={label}
								subLabel={subLabel}
								subLabelLineClamp={4}
							/>
						))}
					</Design.TableRowGroup>
					<Design.Text
						variant="text-xs/normal"
						color="text-muted"
						style={{ textAlign: 'center' }}
					>
						{`Custom Quick Reactions ${manifest.version}`}
					</Design.Text>
				</Design.Stack>
			</Page>
		</ScrollView>
	)
}
