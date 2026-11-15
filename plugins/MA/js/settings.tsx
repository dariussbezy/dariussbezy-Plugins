import { getAssetIdByName } from '@valenced/assets'
import { FormSwitch } from '@valenced/components'
import Page from '@valenced/components/Page'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { Design } from '@valenced/discord/design'
import { useSyncExternalStore } from 'react'
import { ScrollView } from 'react-native'
import manifest from '../manifest.json'
import {
	getSettings,
	isSection,
	newSection,
	sessionIcons,
	setSettings,
	snapshot,
	subscribe,
} from './shared'
import type { ComponentProps } from 'react'

const GUIDE: [string, string][] = [
	[
		'Add the buttons',
		'Long-press a message once: its buttons appear here. Your own messages, pinned messages and messages with files show extra buttons, so open those too.',
	],
	[
		'Arrange them',
		'Use the arrows to move a button, the switch to hide it for now and the trash button to remove it. Removed buttons are listed below, where a tap puts them back. Section breaks split the menu into boxes.',
	],
	[
		'Language',
		'Buttons are remembered by their name, so after changing Discord’s language open a message menu again and arrange the new names.',
	],
]

export default function SettingsComponent() {
	useSyncExternalStore(subscribe, snapshot, snapshot)
	const { order, hidden, removed, hideReactions, icons } = getSettings()
	const list = order.filter(label => !removed.includes(label))
	const iconFor = (label: string) => {
		const component = sessionIcons.get(label)
		if (component)
			return (
				<TableRowAssetIcon
					IconComponent={
						component as NonNullable<
							ComponentProps<typeof TableRowAssetIcon>['IconComponent']
						>
					}
				/>
			)
		const { name, id } = icons[label] ?? {}
		if (name && getAssetIdByName(name) != null)
			return <TableRowAssetIcon name={name} />
		return id != null ? <TableRowAssetIcon id={id} /> : undefined
	}
	const trash = getAssetIdByName('TrashIcon')
	const up = getAssetIdByName('ArrowSmallUpIcon')
	const down = getAssetIdByName('ArrowSmallDownIcon')

	/** Swaps a row with its neighbour in the list; removed buttons in between stay where they are. */
	const move = (index: number, by: number) => {
		const next = [...order]
		const from = next.indexOf(list[index])
		const to = next.indexOf(list[index + by])
		;[next[from], next[to]] = [next[to], next[from]]
		setSettings({ order: next, customized: true })
	}
	const remove = (label: string) =>
		setSettings(
			isSection(label)
				? { order: order.filter(other => other !== label), customized: true }
				: { removed: [...removed, label], customized: true },
		)
	const restore = (label: string) =>
		setSettings({ removed: removed.filter(other => other !== label) })
	const toggle = (label: string, shown: boolean) =>
		setSettings({
			hidden: shown
				? hidden.filter(other => other !== label)
				: [...hidden, label],
			customized: true,
		})

	return (
		<ScrollView keyboardShouldPersistTaps="handled">
			<Page>
				<Design.Stack spacing={24}>
					<Design.TableRowGroup title="Message buttons">
						{list.length ? (
							list.map((label, index) => {
								const section = isSection(label)
								const shown = section || !hidden.includes(label)
								return (
									<Design.TableRow
										key={label}
										label={section ? 'Section break' : label}
										subLabel={shown ? undefined : 'Hidden'}
										icon={
											section ? (
												<TableRowAssetIcon name="ChevronSmallDownIcon" />
											) : (
												iconFor(label)
											)
										}
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
														accessibilityLabel={`Move ${label} up`}
														disabled={index === 0}
														onPress={() => move(index, -1)}
													/>
												)}
												{down != null && (
													<Design.IconButton
														icon={down}
														size="sm"
														variant="secondary"
														accessibilityLabel={`Move ${label} down`}
														disabled={index === list.length - 1}
														onPress={() => move(index, 1)}
													/>
												)}
												{!section && (
													<FormSwitch
														value={shown}
														onValueChange={value => toggle(label, value)}
													/>
												)}
												{trash != null && (
													<Design.IconButton
														icon={trash}
														size="sm"
														variant="destructive"
														accessibilityLabel={
															section
																? 'Remove section break'
																: `Remove ${label}`
														}
														onPress={() => remove(label)}
													/>
												)}
											</Design.Stack>
										}
									/>
								)
							})
						) : (
							<Design.TableRow
								icon={<TableRowAssetIcon name="CircleInformationIcon" />}
								label="No buttons yet"
								subLabel="Long-press a message, then come back here."
							/>
						)}
					</Design.TableRowGroup>
					{removed.length > 0 && (
						<Design.TableRowGroup title="Removed buttons">
							{removed.map(label => (
								<Design.TableRow
									key={label}
									label={label}
									subLabel="Tap to put it back in the menu"
									icon={iconFor(label)}
									onPress={() => restore(label)}
								/>
							))}
						</Design.TableRowGroup>
					)}
					<Design.TableRowGroup>
						<Design.TableRow
							icon={<TableRowAssetIcon name="PlusSmallIcon" />}
							label="Add section break"
							subLabel="Added at the end of the list. Move it with the arrows."
							disabled={!order.length}
							onPress={() =>
								setSettings({
									order: [...order, newSection()],
									customized: true,
								})
							}
						/>
						<Design.TableSwitchRow
							icon={<TableRowAssetIcon name="ReactionIcon" />}
							label="Hide quick reactions"
							subLabel="Remove the reactions row above the buttons."
							value={hideReactions}
							onValueChange={value => setSettings({ hideReactions: value })}
						/>
						<Design.TableRow
							icon={<TableRowAssetIcon name="RefreshIcon" />}
							label="Reset"
							subLabel="Show every button again in Discord’s order and forget the list."
							variant="danger"
							onPress={() =>
								setSettings({
									order: [],
									hidden: [],
									removed: [],
									customized: false,
								})
							}
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
						{`Message Actions ${manifest.version}`}
					</Design.Text>
				</Design.Stack>
			</Page>
		</ScrollView>
	)
}
