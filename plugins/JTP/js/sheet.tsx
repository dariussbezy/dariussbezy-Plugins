import { getAssetIdByName } from '@valenced/assets'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import {
	ActionSheetActionCreators,
	ToastActionCreators,
} from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Stores } from '@valenced/discord/flux'
import { BottomSheet } from '@valenced/externals/gorhom'
import { ReactNativeSafeAreaContext } from '@valenced/externals/react-native-safe-area-context'
import { useReRender } from '@valenced/utils/react'
import { useEffect, useState } from 'react'
import { Image, useWindowDimensions } from 'react-native'
import { CountBadge } from './badge'
import { formatTime, snowflakeTime } from './logic'
import { SHEET_KEY } from './navigation'
import {
	getRows,
	loadRow,
	markRead,
	openMessage,
	openRow,
	totalOf,
} from './pings'
import { listeners } from './shared'
import type { ImageSourcePropType } from 'react-native'
import type { Ping } from './logic'
import type { Row, RowPings } from './pings'

const { ActionSheet, BottomSheetTitleHeader, Button, TableRow, TableRowGroup } =
	Design

const AVATAR = 40
const PREVIEW_ROWS = 10
const ROW_HEIGHT = 80
const HEADER_HEIGHT = 110

interface NamedChannel {
	type: number
	name?: string
	guild_id?: string | null
	rawRecipients?: { username?: string }[]
	recipients?: string[]
}

let toastCounter = 0

export function toast(text: string) {
	ToastActionCreators.open(`dariuss.jump-to-ping.${++toastCounter}`, { text })
}

function channelLabel({ channelId, dm }: Row) {
	const channel = (
		Stores.ChannelStore as unknown as {
			getChannel(id: string): NamedChannel | undefined
		}
	).getChannel(channelId)
	if (!channel) return 'Unknown channel'
	if (dm) {
		const users = Stores.UserStore as unknown as {
			getUser(id: string): { username?: string } | undefined
		}
		const names =
			channel.name ||
			(channel.recipients ?? [])
				.map(id => users.getUser(id)?.username)
				.filter(Boolean)
				.join(', ')
		return `DM · ${names || 'Unknown'}`
	}
	const guild = (
		Stores.GuildStore as unknown as {
			getGuild(id: string): { name?: string } | undefined
		}
	).getGuild(channel.guild_id ?? '')
	return `#${channel.name || 'channel'}${guild?.name ? ` · ${guild.name}` : ''}`
}

type IconSource = string | number | undefined

const asSource = (value: IconSource): ImageSourcePropType | null =>
	typeof value === 'string'
		? { uri: value }
		: typeof value === 'number'
			? value
			: null

/** The server icon, or the avatar of the person in a DM, when Discord can provide one. */
function avatarSource({ channelId, dm }: Row): ImageSourcePropType | null {
	try {
		const channel = (
			Stores.ChannelStore as unknown as {
				getChannel(
					id: string,
				): { guild_id?: string | null; recipients?: string[] } | undefined
			}
		).getChannel(channelId)
		if (!channel) return null
		if (dm) {
			const user = (
				Stores.UserStore as unknown as {
					getUser(
						id: string,
					):
						| { getAvatarURL?(guildId?: string, size?: number): IconSource }
						| undefined
				}
			).getUser(channel.recipients?.[0] ?? '')
			return asSource(user?.getAvatarURL?.(undefined, AVATAR * 2))
		}
		const guild = (
			Stores.GuildStore as unknown as {
				getGuild(id: string):
					| {
							id?: string
							icon?: string | null
							getIconURL?(size?: number): IconSource
					  }
					| undefined
			}
		).getGuild(channel.guild_id ?? '')
		return (
			asSource(guild?.getIconURL?.(AVATAR * 2)) ??
			(guild?.id && guild.icon
				? {
						uri: `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=${AVATAR * 2}`,
					}
				: null)
		)
	} catch {
		return null
	}
}

function RowIcon({ row }: { row: Row }) {
	const source = avatarSource(row)
	if (!source)
		return <TableRowAssetIcon name={row.dm ? 'ChatMarkUnreadIcon' : 'AtIcon'} />
	return (
		// custom: Discord has no component for a plain remote image, so the icon is an Image
		<Image
			source={source}
			style={{
				width: AVATAR,
				height: AVATAR,
				borderRadius: row.dm ? AVATAR / 2 : 12,
			}}
		/>
	)
}

/** The latest message of a DM, shown next to its unread count. */
function latestDirectMessage({
	channelId,
	lastMessageId,
}: Row): Ping | undefined {
	if (!lastMessageId) return
	const message = (
		Stores.MessageStore as unknown as {
			getMessage(
				channelId: string,
				id: string,
			):
				| {
						content?: string
						author?: { username?: string; globalName?: string | null }
						attachments?: unknown[]
				  }
				| undefined
		}
	).getMessage(channelId, lastMessageId)
	if (!message) return
	const text = (message.content ?? '').replace(/\s+/g, ' ').trim()
	return {
		id: lastMessageId,
		author: message.author?.globalName || message.author?.username || 'Unknown',
		text: text || (message.attachments?.length ? '(attachment)' : ''),
	}
}

function rowSubtitle(row: Row, first?: Ping) {
	const noun = row.dm
		? 'unread message'
		: row.queued
			? 'unvisited ping'
			: 'unread ping'
	const meta = `${row.count} ${noun}${row.count === 1 ? '' : 's'}`
	const time = first ? ` · ${formatTime(snowflakeTime(first.id))}` : ''
	return first?.text ? `${first.author}: ${first.text}\n${meta}${time}` : meta
}

function PingSheet() {
	const rerender = useReRender()
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [loaded, setLoaded] = useState<RowPings | null>(null)
	const [measured, setMeasured] = useState(0)
	const { height: windowHeight } = useWindowDimensions()
	const { bottom } = ReactNativeSafeAreaContext.useSafeAreaInsets()

	useEffect(() => {
		listeners.add(rerender)
		return () => {
			listeners.delete(rerender)
		}
	}, [rerender])

	const rows = getRows()
	const [previews, setPreviews] = useState<Record<string, Ping>>({})
	const signature = rows
		.map(row => `${row.channelId}:${row.count}:${row.oldest}`)
		.join('|')

	// First ping of each listed chat, loaded one by one so the list opens instantly.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the signature stands for the rows.
	useEffect(() => {
		let stopped = false
		void (async () => {
			for (const row of getRows().slice(0, PREVIEW_ROWS)) {
				if (stopped) return
				if (row.dm) continue
				try {
					const first = (await loadRow(row)).pings[0]
					if (stopped || !first) continue
					setPreviews(previous =>
						previous[row.channelId]?.id === first.id
							? previous
							: { ...previous, [row.channelId]: first },
					)
				} catch {
					// The row simply stays without a preview.
				}
			}
		})()
		return () => {
			stopped = true
		}
	}, [signature])
	// The picker follows live data: if the chat is read meanwhile, fall back to the list.
	const selected = rows.find(row => row.channelId === selectedId)

	const fail = (message: string) => (error: unknown) => {
		console.error(`Jump to Ping: ${message}`, error)
		toast(message)
	}

	const select = async (row: Row) => {
		setSelectedId(row.channelId)
		setLoaded(null)
		try {
			setLoaded(await loadRow(row))
		} catch (error) {
			fail('Could not load pings')(error)
			setSelectedId(null)
		}
	}

	const onRowPress = (row: Row) => {
		if (row.dm || row.count === 1) {
			openRow(row, fail('Could not open this chat')).catch(
				fail('Could not find this ping'),
			)
		} else void select(row)
	}

	const readIcon = getAssetIdByName('ChatCheckIcon')
	const renderRow = (row: Row) => (
		<TableRow
			key={row.channelId}
			label={
				row.dm ? channelLabel(row).replace(/^DM · /, '') : channelLabel(row)
			}
			subLabel={rowSubtitle(
				row,
				row.dm ? latestDirectMessage(row) : previews[row.channelId],
			)}
			icon={<RowIcon row={row} />}
			labelLineClamp={1}
			subLabelLineClamp={2}
			arrow
			trailing={
				<Design.Stack direction="horizontal" align="center" spacing={8}>
					<CountBadge count={row.count} />
					{readIcon != null && (
						<Design.IconButton
							icon={readIcon}
							size="sm"
							variant="secondary"
							accessibilityLabel="Mark as read"
							onPress={() => {
								try {
									markRead(row.channelId)
								} catch (error) {
									fail('Could not mark this chat as read')(error)
								}
							}}
						/>
					)}
				</Design.Stack>
			}
			onPress={() => onRowPress(row)}
		/>
	)
	const sections = [
		{ title: 'Servers', items: rows.filter(row => !row.dm) },
		{ title: 'Direct messages', items: rows.filter(row => row.dm) },
	]

	const maxHeight = Math.floor(windowHeight * 0.85)
	const itemCount = selected ? (loaded?.pings.length ?? 1) + 2 : rows.length
	const startHeight = Math.min(
		maxHeight,
		HEADER_HEIGHT + itemCount * ROW_HEIGHT + bottom,
	)
	const total = totalOf(rows)

	const header = (
		<BottomSheetTitleHeader
			title={selected ? channelLabel(selected) : 'Pings'}
			subtitle={
				selected
					? 'Choose a message to jump to'
					: rows.length
						? `${total} ${total === 1 ? 'ping' : 'pings'} in ${rows.length} ${rows.length === 1 ? 'chat' : 'chats'}`
						: 'You are all caught up'
			}
		/>
	)

	return (
		<ActionSheet
			key={selected?.channelId ?? 'chats'}
			scrollable
			startExpanded={false}
			startHeight={startHeight}
			maxHeight={maxHeight}
			contentHeight={Math.min(
				maxHeight,
				Math.max(startHeight, measured + HEADER_HEIGHT),
			)}
			header={header}
		>
			<BottomSheet.BottomSheetScrollView
				style={{ flex: 1 }}
				contentContainerStyle={{ paddingBottom: bottom + 24 }}
				keyboardShouldPersistTaps="handled"
				onContentSizeChange={(_width: number, height: number) =>
					setMeasured(Math.ceil(height))
				}
			>
				{selected ? (
					<MessagePicker
						row={selected}
						loaded={loaded}
						onBack={() => setSelectedId(null)}
						onOpen={id =>
							openMessage(selected, id, fail('Could not open this chat'))
						}
					/>
				) : (
					sections.map(
						({ title, items }) =>
							items.length > 0 && (
								<TableRowGroup key={title} title={title}>
									{items.map(renderRow)}
								</TableRowGroup>
							),
					)
				)}
			</BottomSheet.BottomSheetScrollView>
		</ActionSheet>
	)
}

function MessagePicker({
	row,
	loaded,
	onBack,
	onOpen,
}: {
	row: Row
	loaded: RowPings | null
	onBack(): void
	onOpen(messageId: string | undefined): void
}) {
	const pings = loaded?.pings ?? []
	return (
		<>
			<Button text="Back to chats" variant="secondary" onPress={onBack} />
			<TableRowGroup>
				{!loaded && <TableRow label="Loading messages…" />}
				{pings.map(ping => (
					<TableRow
						key={ping.id}
						label={ping.author}
						subLabel={`${ping.text || '(No text)'}\n${formatTime(snowflakeTime(ping.id))}`}
						labelLineClamp={1}
						subLabelLineClamp={2}
						arrow
						onPress={() => onOpen(ping.id)}
					/>
				))}
				{loaded && pings.length < row.count && (
					<TableRow
						label="Open first unread message"
						subLabel="Some pings could not be found in recent messages."
						arrow
						onPress={() => onOpen(loaded.fallback)}
					/>
				)}
			</TableRowGroup>
		</>
	)
}

export function openPingSheet() {
	ActionSheetActionCreators.openLazy(
		Promise.resolve({ default: PingSheet }),
		SHEET_KEY,
		{},
	)
}
