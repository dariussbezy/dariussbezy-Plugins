import Page from '@valenced/components/Page'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { Design } from '@valenced/discord/design'
import { Stores } from '@valenced/discord/flux'
import { useState } from 'react'
import { ScrollView } from 'react-native'
import manifest from '../manifest.json'
import { DefaultSettings } from './shared'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { Settings } from './shared'

const icon = (name: string) => <TableRowAssetIcon name={name} />

interface Relationships {
	getBlockedIDs?: () => string[]
	getIgnoredIDs?: () => string[]
}

interface Users {
	getUser(id: string): { username?: string; globalName?: string } | undefined
}

const nameOf = (id: string) => {
	const user = (Stores.UserStore as unknown as Users | undefined)?.getUser(id)
	return user?.globalName ?? user?.username ?? id
}

const GUIDE: [string, string][] = [
	[
		'What it does',
		'Messages from blocked or ignored users show up like any other message, with no collapsed group and no Show message tap.',
	],
	[
		'Where',
		'Server channels and threads, plus group chats and 1:1 DMs if enabled.',
	],
	[
		'Not showing yet?',
		'Messages already loaded keep their old look. Switch channel or restart Discord to reload them.',
	],
]

export default function SettingsComponent({
	api: { jsonStorage: storage },
}: ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>) {
	const { blocked, ignored, groupChats, directMessages, pings } = {
		...DefaultSettings,
		...storage.use(),
	}

	const [draft, setDraft] = useState('')
	const excluded = storage.use()?.excluded ?? []
	const relationships = Stores.RelationshipStore as unknown as
		| Relationships
		| undefined
	const blockedIds = relationships?.getBlockedIDs?.() ?? []
	const ignoredIds = relationships?.getIgnoredIDs?.() ?? []
	const ids = [...new Set([...blockedIds, ...ignoredIds, ...excluded])]
	const toggle = (id: string, keep: boolean) =>
		storage.set({
			excluded: keep
				? [...new Set([...excluded, id])]
				: excluded.filter(other => other !== id),
		})
	const validDraft = /^d{15,25}$/.test(draft.trim())

	return (
		<ScrollView keyboardShouldPersistTaps="handled">
			<Page>
				<Design.Stack spacing={24}>
					<Design.TableRowGroup>
						<Design.TableSwitchRow
							icon={icon('DenyIcon')}
							label="Show blocked users' messages"
							value={blocked}
							onValueChange={blocked => storage.set({ blocked })}
						/>
						<Design.TableSwitchRow
							icon={icon('EyeSlashIcon')}
							label="Show ignored users' messages"
							value={ignored}
							onValueChange={ignored => storage.set({ ignored })}
						/>
						<Design.TableSwitchRow
							icon={icon('GroupIcon')}
							label="Also in group chats"
							subLabel="Group chats are shared with other people, so this is optional."
							value={groupChats}
							onValueChange={groupChats => storage.set({ groupChats })}
						/>
						<Design.TableSwitchRow
							icon={icon('UserIcon')}
							label="Also in direct messages"
							subLabel="Only changes how old messages look. Blocked and ignored users still cannot DM you."
							value={directMessages}
							onValueChange={directMessages => storage.set({ directMessages })}
						/>
						<Design.TableSwitchRow
							icon={icon('BellIcon')}
							label="Allow pings from blocked users"
							subLabel="Messages that mention you stay visible and can ping you. Off keeps Discord's behaviour for them."
							value={pings}
							onValueChange={pings => storage.set({ pings })}
						/>
					</Design.TableRowGroup>
					<Design.TableRowGroup title="Keep these hidden">
						{ids.length === 0 && (
							<Design.TableRow
								icon={icon('CircleInformationIcon')}
								label="No blocked or ignored users"
							/>
						)}
						{ids.map(id => (
							<Design.TableSwitchRow
								key={id}
								icon={icon('DenyIcon')}
								label={nameOf(id)}
								subLabel={`${blockedIds.includes(id) ? 'Blocked' : ignoredIds.includes(id) ? 'Ignored' : 'Not in your lists'} · keep their messages hidden`}
								value={excluded.includes(id)}
								onValueChange={keep => toggle(id, keep)}
							/>
						))}
					</Design.TableRowGroup>
					<Design.TextInput
						label="Keep a user hidden by ID"
						placeholder="User ID"
						value={draft}
						maxLength={25}
						onChange={setDraft}
					/>
					<Design.Button
						text="Add"
						disabled={!validDraft}
						onPress={() => {
							toggle(draft.trim(), true)
							setDraft('')
						}}
					/>
					<Design.TableRowGroup title="Quick guide">
						{GUIDE.map(([label, subLabel]) => (
							<Design.TableRow
								key={label}
								icon={icon('CircleInformationIcon')}
								label={label}
								subLabel={subLabel}
							/>
						))}
					</Design.TableRowGroup>
					<Design.Text
						variant="text-xs/normal"
						color="text-muted"
						style={{ textAlign: 'center' }}
					>
						{`${manifest.name} ${manifest.version}`}
					</Design.Text>
				</Design.Stack>
			</Page>
		</ScrollView>
	)
}
