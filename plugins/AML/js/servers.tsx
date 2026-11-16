import { SearchInput, TableRowAssetIcon } from '@valenced/components'
import Page from '@valenced/components/Page'
import { Design } from '@valenced/discord/design'
import { useMemo, useState } from 'react'
import { Image, ScrollView } from 'react-native'
import { listGuilds } from './discord'

const ICON = 40

/** Picks the servers whose messages stay logged. Everything else is ignored. */
export default function ServerPicker({
	selected,
	onChange,
	back,
}: {
	selected: string[]
	onChange(ids: string[]): void
	back: React.ReactNode
}) {
	const [query, setQuery] = useState('')
	const guilds = useMemo(() => listGuilds(ICON * 2), [])
	const shown = guilds.filter(guild =>
		guild.name.toLowerCase().includes(query.trim().toLowerCase()),
	)
	const chosen = new Set(selected)
	const toggle = (id: string) =>
		onChange(
			chosen.has(id)
				? selected.filter(other => other !== id)
				: [...selected, id],
		)
	const present = guilds.filter(guild => chosen.has(guild.id)).length

	return (
		<ScrollView keyboardShouldPersistTaps="handled">
			<Page>
				<Design.Stack spacing={16}>
					{back}
					<SearchInput
						value={query}
						onChange={setQuery}
						placeholder="Search servers"
					/>
					<Design.Stack direction="horizontal" spacing={8}>
						<Design.Button
							text="Select all"
							variant="secondary"
							size="sm"
							onPress={() =>
								onChange([
									...new Set([...selected, ...shown.map(guild => guild.id)]),
								])
							}
						/>
						<Design.Button
							text={query.trim() ? 'Clear shown' : 'Clear'}
							variant="secondary"
							size="sm"
							onPress={() => {
								const drop = new Set(shown.map(guild => guild.id))
								onChange(selected.filter(id => !drop.has(id)))
							}}
						/>
					</Design.Stack>
					<Design.TableRowGroup
						title={`Servers · ${present} of ${guilds.length} logged`}
					>
						{shown.length ? (
							shown.map(guild => (
								<Design.TableCheckboxRow
									key={guild.id}
									value={guild.id}
									checked={chosen.has(guild.id)}
									label={guild.name}
									icon={
										guild.icon ? (
											// custom: Discord has no component for a plain remote image, so the icon is an Image
											<Image
												source={guild.icon}
												style={{
													width: ICON,
													height: ICON,
													borderRadius: 12,
												}}
											/>
										) : (
											<TableRowAssetIcon name="HomeIcon" />
										)
									}
									onPress={() => toggle(guild.id)}
								/>
							))
						) : (
							<Design.TableRow
								label={guilds.length ? 'No server matches' : 'No servers found'}
							/>
						)}
					</Design.TableRowGroup>
				</Design.Stack>
			</Page>
		</ScrollView>
	)
}
