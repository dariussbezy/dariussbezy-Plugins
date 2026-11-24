import { SearchInput, TableRowAssetIcon } from '@valenced/components'
import { Design } from '@valenced/discord/design'
import { Stores } from '@valenced/discord/flux'
import { useMemo, useState } from 'react'
import { Image } from 'react-native'
import { addPlace, Everywhere, getSettings, removePlace } from './shared'
import type { Place } from './shared'

type Target = { id: string; name: string; icon?: string }

interface PlaceStores {
	GuildStore?: {
		getGuilds(): Record<
			string,
			{
				id: string
				name?: string
				icon?: string | null
				getIconURL?(size: number): unknown
			}
		>
		getGuild(id: string): { name?: string } | undefined
	}
	ChannelStore?: {
		getChannel(
			id: string,
		): { id: string; name?: string; recipients?: string[] } | undefined
	}
	PrivateChannelSortStore?: { getPrivateChannelIds(): string[] }
	UserStore?: {
		getUser(id: string):
			| {
					id?: string
					avatar?: string | null
					username?: string
					globalName?: string
					getAvatarURL?(guildId: undefined, size: number): unknown
			  }
			| undefined
	}
}

const stores = () => Stores as unknown as PlaceStores
const asUri = (value: unknown) =>
	typeof value === 'string' && value ? value : undefined

function servers(): Target[] {
	const all = Object.values(stores().GuildStore?.getGuilds() ?? {})
	return all
		.filter(guild => guild?.id)
		.map(guild => {
			let icon: string | undefined
			try {
				icon = asUri(guild.getIconURL?.(64))
			} catch {}
			// The store's helper can return nothing (or an asset) on mobile: use the CDN address.
			if (!icon?.startsWith('http') && guild.icon)
				icon = `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`
			if (!icon?.startsWith('http')) icon = undefined
			return { id: guild.id, name: guild.name ?? guild.id, icon }
		})
		.sort((a, b) => a.name.localeCompare(b.name))
}

function dms(): Target[] {
	const { PrivateChannelSortStore, ChannelStore, UserStore } = stores()
	const ids = PrivateChannelSortStore?.getPrivateChannelIds() ?? []
	const found: Target[] = []
	for (const id of ids) {
		const channel = ChannelStore?.getChannel(id)
		if (!channel) continue
		const people = (channel.recipients ?? []).map(userId =>
			UserStore?.getUser(userId),
		)
		const name =
			channel.name ||
			people
				.map(user => user?.globalName ?? user?.username)
				.filter(Boolean)
				.join(', ') ||
			id
		let icon: string | undefined
		try {
			icon =
				people.length === 1
					? asUri(people[0]?.getAvatarURL?.(undefined, 64))
					: undefined
		} catch {}
		const person = people.length === 1 ? people[0] : undefined
		if (!icon?.startsWith('http') && person?.id && person.avatar)
			icon = `https://cdn.discordapp.com/avatars/${person.id}/${person.avatar}.png?size=64`
		if (!icon?.startsWith('http')) icon = undefined
		found.push({ id, name, icon })
	}
	return found
}

/** The name to show for a list, kept fresh while the server or DM still exists. */
export function placeName(key: string) {
	if (key === Everywhere) return 'Everywhere'
	const place = getSettings().places[key]
	if (!place) return 'Everywhere'
	if (place.kind === 'server')
		return stores().GuildStore?.getGuild(key)?.name ?? place.name
	return dms().find(target => target.id === key)?.name ?? place.name
}

function TargetIcon({ target, kind }: { target: Target; kind: Place['kind'] }) {
	return target.icon ? (
		// custom: Discord has no component for a plain remote image.
		<Image
			source={{ uri: target.icon }}
			style={{ width: 32, height: 32, borderRadius: 16 }}
		/>
	) : (
		<TableRowAssetIcon name={kind === 'server' ? 'ServerIcon' : 'UserIcon'} />
	)
}

/** Picks which list is edited: everywhere, a server's or a DM's. New ones can be added here. */
export default function PlacePicker({
	current,
	onPick,
}: {
	current: string
	onPick(key: string): void
}) {
	const [adding, setAdding] = useState<Place['kind'] | null>(null)
	const [query, setQuery] = useState('')
	const { places } = getSettings()
	const targets = useMemo(
		() => (adding === 'server' ? servers() : adding === 'dm' ? dms() : []),
		[adding],
	)
	// Icons for the lists already added.
	const known = useMemo(
		() => new Map([...servers(), ...dms()].map(target => [target.id, target])),
		[],
	)

	if (adding) {
		const shown = targets.filter(target =>
			target.name.toLowerCase().includes(query.trim().toLowerCase()),
		)
		return (
			<Design.Stack spacing={16}>
				<Design.TableRowGroup>
					<Design.TableRow
						icon={<TableRowAssetIcon name="ArrowLargeLeftIcon" />}
						label="Back"
						onPress={() => {
							setAdding(null)
							setQuery('')
						}}
					/>
				</Design.TableRowGroup>
				<SearchInput
					value={query}
					onChange={setQuery}
					placeholder={adding === 'server' ? 'Search servers' : 'Search DMs'}
				/>
				<Design.TableRowGroup
					title={adding === 'server' ? 'Choose a server' : 'Choose a DM'}
				>
					{shown.length ? (
						shown.map(target => (
							<Design.TableRow
								key={target.id}
								icon={<TargetIcon target={target} kind={adding} />}
								label={target.name}
								subLabel={places[target.id] ? 'Has its own list' : undefined}
								arrow
								onPress={() => {
									addPlace(target.id, adding, target.name)
									setAdding(null)
									setQuery('')
									onPick(target.id)
								}}
							/>
						))
					) : (
						<Design.TableRow label="Nothing found" />
					)}
				</Design.TableRowGroup>
			</Design.Stack>
		)
	}

	const keys = Object.keys(places).sort((a, b) =>
		placeName(a).localeCompare(placeName(b)),
	)
	const check = (key: string) =>
		key === current ? (
			<TableRowAssetIcon name="CheckmarkLargeIcon" />
		) : undefined
	return (
		<Design.Stack spacing={16}>
			<Design.TableRowGroup title="Edit the list for">
				<Design.TableRow
					icon={<TableRowAssetIcon name="GlobeEarthIcon" />}
					label="Everywhere"
					subLabel="Used wherever there is no list of its own."
					trailing={check(Everywhere)}
					onPress={() => onPick(Everywhere)}
				/>
				{keys.map(key => (
					<Design.TableRow
						key={key}
						icon={
							known.get(key) ? (
								<TargetIcon target={known.get(key)!} kind={places[key].kind} />
							) : (
								<TableRowAssetIcon
									name={
										places[key].kind === 'server' ? 'ServerIcon' : 'UserIcon'
									}
								/>
							)
						}
						label={placeName(key)}
						subLabel={places[key].kind === 'server' ? 'Server list' : 'DM list'}
						trailing={check(key)}
						onPress={() => onPick(key)}
					/>
				))}
			</Design.TableRowGroup>
			<Design.TableRowGroup title="Add a list">
				<Design.TableRow
					icon={<TableRowAssetIcon name="ServerIcon" />}
					label="For a server"
					arrow
					onPress={() => setAdding('server')}
				/>
				<Design.TableRow
					icon={<TableRowAssetIcon name="UserIcon" />}
					label="For a DM"
					arrow
					onPress={() => setAdding('dm')}
				/>
			</Design.TableRowGroup>
			{current !== Everywhere ? (
				<Design.TableRowGroup>
					<Design.TableRow
						icon={<TableRowAssetIcon name="TrashIcon" />}
						label={`Remove the list for ${placeName(current)}`}
						subLabel="It goes back to the list used everywhere."
						variant="danger"
						onPress={() => {
							removePlace(current)
							onPick(Everywhere)
						}}
					/>
				</Design.TableRowGroup>
			) : null}
		</Design.Stack>
	)
}
