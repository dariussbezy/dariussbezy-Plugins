import { TableRowAssetIcon } from '@valenced/components'
import { ToastActionCreators } from '@valenced/discord/actions'
import { Tokens } from '@valenced/discord/common/tokens'
import { Design } from '@valenced/discord/design'
import { Stores } from '@valenced/discord/flux'
import { lookupModule } from '@valenced/modules/finders'
import { withDependencies, withProps } from '@valenced/modules/finders/filters'
import { useState } from 'react'
import { Keyboard, Pressable, View } from 'react-native'
import { showDetails } from './alerts'
import { getChannel, getGuildName, userName } from './discord'
import type {
	ColorRowsProps,
	Entry,
	HistoryFilter,
	HistoryViewProps,
} from './types'

const PageSize = 25

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

/** The author as Discord shows them: server nickname, then display name, then username. */
function displayName(entry: Entry) {
	const { authorId, guildId, author } = entry.before
	const members = (
		Stores as unknown as {
			GuildMemberStore?: {
				getNick?(guildId: string, userId: string): string | null
			}
		}
	).GuildMemberStore
	return (
		(guildId ? members?.getNick?.(guildId, authorId) : undefined) ??
		userName(authorId) ??
		author
	)
}

type ProfileSheet = {
	default(options: {
		userId: string
		channelId?: string
		guildId?: string
	}): void
	getUserProfileActionSheetKey: unknown
}

/** Opens the author's profile, as tapping a mention in chat does. */
function openProfile(entry: Entry) {
	const byExports = withProps<ProfileSheet>('getUserProfileActionSheetKey')
	const { relative } = withDependencies
	const sheet =
		lookupModule(byExports, { cached: false })[0] ??
		// modules/user_profile/native/showUserProfileActionSheet.tsx, before it loads: matched by its
		// helper modules right after it, then loaded.
		lookupModule(
			withDependencies([
				null,
				null,
				null,
				null,
				null,
				null,
				relative(1),
				relative(2),
				null,
				relative(3),
				null,
				null,
				null,
			]).and(byExports),
			{ cached: false, initialize: true },
		)[0]
	if (typeof sheet?.default !== 'function') {
		ToastActionCreators.open('dariuss.advanced-message-logger.profile', {
			text: "Discord's profile could not be opened from here.",
		})
		return
	}
	const { authorId, channelId, guildId } = entry.before
	sheet.default({ userId: authorId, channelId, guildId: guildId || undefined })
}

/** The author as a mention pill, like in chat. Tapping it opens their profile. */
function Mention({ entry }: { entry: Entry }) {
	return (
		// custom: Discord has no mention component outside the chat; its own press area, so the tap
		// opens the profile instead of the entry.
		<Pressable
			accessibilityRole="button"
			hitSlop={6}
			onPress={() => openProfile(entry)}
			style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
		>
			<Design.Text
				variant="text-md/semibold"
				style={{
					color: themeColor(['MENTION_FOREGROUND', 'TEXT_LINK'], '#C9CDFB'),
					backgroundColor: themeColor(
						['MENTION_BACKGROUND', 'BACKGROUND_MENTIONED'],
						'#5865F23D',
					),
					borderRadius: 4,
					paddingHorizontal: 2,
				}}
			>
				@{displayName(entry)}
			</Design.Text>
		</Pressable>
	)
}
export const EmptyFilter: HistoryFilter = {
	query: '',
	kind: 'all',
	author: '',
	channel: '',
	server: '',
	from: '',
	to: '',
}

const Presets = [
	['Red', '#ED4245'],
	['Orange', '#F07B3E'],
	['Gold', '#F1C40F'],
	['Green', '#43B581'],
	['Teal', '#1ABC9C'],
	['Blue', '#3498DB'],
	['Indigo', '#5865F2'],
	['Purple', '#9B59B6'],
	['Pink', '#EB459E'],
	['Gray', '#80848E'],
] as const

function dayStart(value: string) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return
	const [year, month, day] = value.split('-').map(Number)
	const date = new Date(0)
	date.setFullYear(year, month - 1, day)
	date.setHours(0, 0, 0, 0)
	if (
		date.getFullYear() === year &&
		date.getMonth() === month - 1 &&
		date.getDate() === day
	)
		return date
}

const contains = (query: string, ...values: (string | undefined)[]) => {
	const needle = query.trim().toLowerCase()
	return !needle || values.some(value => value?.toLowerCase().includes(needle))
}

export function matchesFilter(entry: Entry, filter: HistoryFilter) {
	const { before, after, kind, at } = entry
	if (filter.kind !== 'all' && filter.kind !== kind) return false
	const channelName = getChannel(before.channelId)?.name
	const serverName = getGuildName(before.guildId)
	if (
		!contains(
			filter.author.replace(/^@/, ''),
			before.author,
			before.authorId,
		) ||
		!contains(
			filter.channel.replace(/^#/, ''),
			channelName,
			before.channelId,
		) ||
		!contains(filter.server, serverName, before.guildId)
	) {
		return false
	}
	const from = dayStart(filter.from.trim())
	const to = dayStart(filter.to.trim())
	if (from && at < from.getTime()) return false
	if (to) {
		to.setDate(to.getDate() + 1)
		if (at >= to.getTime()) return false
	}
	return contains(
		filter.query,
		kind,
		before.author,
		before.authorId,
		before.content,
		after?.content,
		before.id,
		channelName,
		before.channelId,
		serverName,
		before.guildId,
		new Date(at).toLocaleDateString(),
	)
}

const isActive = (filter: HistoryFilter) =>
	filter.kind !== 'all' ||
	[
		filter.query,
		filter.author,
		filter.channel,
		filter.server,
		filter.from,
		filter.to,
	].some(part => part.trim())

/** The journal list with search, filters and saved searches. */
export function HistoryView({
	entries,
	kinds = true,
	defaultKind = 'all',
	saved,
	onSavedChange,
}: HistoryViewProps) {
	const [filter, setFilter] = useState<HistoryFilter>({
		...EmptyFilter,
		kind: defaultKind,
	})
	const [expanded, setExpanded] = useState(false)
	const [name, setName] = useState('')
	const [limit, setLimit] = useState(PageSize)

	const change = (patch: Partial<HistoryFilter>) => {
		setFilter({ ...filter, ...patch })
		setLimit(PageSize)
	}
	const from = dayStart(filter.from.trim())
	const to = dayStart(filter.to.trim())
	const invalidFrom = !!filter.from.trim() && !from
	const invalidTo = !!filter.to.trim() && !to
	const reversed = !!from && !!to && from.getTime() > to.getTime()
	const active = isActive(filter)
	const cleanName = name.trim()
	const matching = entries.filter(entry => matchesFilter(entry, filter))

	function save() {
		const trimmed = Object.fromEntries(
			Object.entries(filter).map(([key, value]) => [key, value.trim()]),
		) as HistoryFilter
		const others = saved.filter(
			item => item.name.toLowerCase() !== cleanName.toLowerCase(),
		)
		onSavedChange(
			[{ name: cleanName, filter: trimmed }, ...others].slice(0, 20),
		)
		setName('')
	}

	return (
		<>
			<Design.TextInput
				label="Search history"
				placeholder="Message, sender, channel, date, or event"
				value={filter.query}
				maxLength={200}
				onChange={query => change({ query })}
			/>
			<Design.TableRowGroup>
				<Design.TableRow
					label={expanded ? 'Hide filters' : 'Filters and saved searches'}
					subLabel={active ? 'Filters active' : undefined}
					arrow={!expanded}
					onPress={() => setExpanded(!expanded)}
				/>
				{active && (
					<Design.TableRow
						label="Clear filters"
						onPress={() => setFilter(EmptyFilter)}
					/>
				)}
			</Design.TableRowGroup>
			{expanded && (
				<>
					{kinds && (
						<Design.TableRadioGroup<HistoryFilter['kind']>
							title="Event type"
							value={filter.kind}
							onChange={kind => change({ kind })}
						>
							<Design.TableRadioRow label="All events" value="all" />
							<Design.TableRadioRow label="Edited" value="edited" />
							<Design.TableRadioRow label="Deleted" value="deleted" />
						</Design.TableRadioGroup>
					)}
					<Design.TextInput
						label="Author"
						placeholder="Name or user ID"
						value={filter.author}
						maxLength={100}
						onChange={author => change({ author })}
					/>
					<Design.TextInput
						label="Channel"
						placeholder="Name or channel ID"
						value={filter.channel}
						maxLength={100}
						onChange={channel => change({ channel })}
					/>
					<Design.TextInput
						label="Server"
						placeholder="Name or server ID"
						value={filter.server}
						maxLength={100}
						onChange={server => change({ server })}
					/>
					<Design.TextInput
						label="From date"
						placeholder="YYYY-MM-DD"
						value={filter.from}
						maxLength={10}
						status={invalidFrom ? 'error' : undefined}
						errorMessage={
							invalidFrom ? 'Enter a date as YYYY-MM-DD.' : undefined
						}
						onChange={value => change({ from: value })}
					/>
					<Design.TextInput
						label="To date"
						placeholder="YYYY-MM-DD"
						value={filter.to}
						maxLength={10}
						status={invalidTo || reversed ? 'error' : undefined}
						errorMessage={
							invalidTo
								? 'Enter a date as YYYY-MM-DD.'
								: reversed
									? 'Use a date on or after the start date.'
									: undefined
						}
						onChange={value => change({ to: value })}
					/>
					<Design.TextInput
						label="Filter name"
						placeholder="Name this search"
						value={name}
						maxLength={48}
						onChange={setName}
					/>
					<Design.Button
						text="Save filter"
						disabled={
							!cleanName || !active || invalidFrom || invalidTo || reversed
						}
						onPress={save}
					/>
					<Design.TableRowGroup title="Saved filters">
						{saved.length ? (
							saved.map((item, index) => (
								<Design.TableRow
									key={item.name}
									label={item.name}
									subLabel="Tap to apply"
									onPress={() => setFilter({ ...item.filter })}
									trailing={
										<Design.Button
											text="Remove"
											size="sm"
											variant="secondary"
											accessibilityLabel={`Remove filter ${item.name}`}
											onPress={() =>
												onSavedChange(
													saved.filter((_, savedIndex) => savedIndex !== index),
												)
											}
										/>
									}
								/>
							))
						) : (
							<Design.TableRow label="No saved filters yet" />
						)}
					</Design.TableRowGroup>
				</>
			)}
			<Design.TableRowGroup title={`History · ${matching.length}`}>
				{matching.length ? (
					matching.slice(0, limit).map(entry => (
						<Design.TableRow
							key={`${entry.before.channelId}:${entry.before.id}:${entry.kind}:${entry.at}`}
							label={
								// custom: the mention and the event side by side, the mention pressable on its own.
								<View
									style={{
										flexDirection: 'row',
										alignItems: 'center',
										flexWrap: 'wrap',
									}}
								>
									<Mention entry={entry} />
									<Design.Text variant="text-md/semibold">
										{entry.kind === 'edited' ? ' · Edited' : ' · Deleted'}
									</Design.Text>
								</View>
							}
							subLabel={`${new Date(entry.at).toLocaleString()}\n${entry.before.content || '(No text)'}`}
							subLabelLineClamp={3}
							icon={
								<TableRowAssetIcon
									name={entry.kind === 'edited' ? 'PencilIcon' : 'TrashIcon'}
								/>
							}
							arrow
							onPress={() => showDetails(entry)}
						/>
					))
				) : (
					<Design.TableRow
						label={
							entries.length ? 'No matching entries' : 'Nothing logged yet'
						}
					/>
				)}
				{matching.length > limit && (
					<Design.TableRow
						label="Show more"
						onPress={() => setLimit(limit + PageSize)}
					/>
				)}
			</Design.TableRowGroup>
		</>
	)
}

/** A round color dot. */
export function Swatch({ color }: { color: string }) {
	// custom: Discord has no native color swatch component.
	return (
		<View
			style={{
				width: 20,
				height: 20,
				borderRadius: 10,
				backgroundColor: color,
			}}
		/>
	)
}

/** A list of color presets with the current one checked. */
export function ColorRows({
	title,
	value,
	fallback,
	onSelect,
}: ColorRowsProps) {
	const current = value.toUpperCase()
	const presets = [['Default', fallback], ...Presets] as const
	const selected = presets.findIndex(
		([, color]) => color.toUpperCase() === current,
	)
	return (
		<Design.Stack spacing={12}>
			<Design.TableRowGroup title={title}>
				{presets.map(([label, color], index) => (
					<Design.TableRow
						key={label}
						label={label}
						onPress={() => onSelect(color)}
						trailing={
							// custom: Discord has no native color swatch component.
							<View
								style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
							>
								<View
									style={{
										width: 20,
										height: 20,
										borderRadius: 10,
										backgroundColor: color,
									}}
								/>
								<View style={{ width: 20 }}>
									{index === selected ? (
										<TableRowAssetIcon name="CircleCheckIcon" />
									) : null}
								</View>
							</View>
						}
					/>
				))}
			</Design.TableRowGroup>
			<HexInput value={value} onSelect={onSelect} />
		</Design.Stack>
	)
}

/** Any color by its hex code, under the presets, applied with its own button like a preset. */
function HexInput({
	value,
	onSelect,
}: {
	value: string
	onSelect(color: string): void
}) {
	const [text, setText] = useState(value.toUpperCase())
	const parsed = /^#?([0-9a-f]{6})$/i.exec(text.trim())
	const apply = () => {
		if (!parsed) return
		// Close the keyboard first: a focused field that unmounts can keep the old screen drawn.
		Keyboard.dismiss()
		onSelect(`#${parsed[1].toUpperCase()}`)
	}
	return (
		<Design.Stack spacing={8}>
			<Design.TextInput
				label="Custom color (HEX)"
				description={
					parsed || !text.trim()
						? 'Any color as six hex digits, for example #FF5555.'
						: 'Not a color yet: type six hex digits, for example #FF5555.'
				}
				placeholder="#RRGGBB"
				value={text}
				maxLength={7}
				onChange={setText}
				returnKeyType="done"
			/>
			<Design.Button
				text="Use this color"
				variant="primary"
				disabled={!parsed}
				onPress={apply}
			/>
		</Design.Stack>
	)
}
