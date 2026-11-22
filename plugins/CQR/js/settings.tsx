import { getAssetIdByName } from '@valenced/assets'
import Page from '@valenced/components/Page'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import {
	ActionSheetActionCreators,
	ToastActionCreators,
} from '@valenced/discord/actions'
import { Tokens } from '@valenced/discord/common/tokens'
import { Design } from '@valenced/discord/design'
import { Stores } from '@valenced/discord/flux'
import { lookupModule } from '@valenced/modules/finders'
import { withDependencies, withProps } from '@valenced/modules/finders/filters'
import { useState, useSyncExternalStore } from 'react'
import {
	Image,
	Pressable,
	ScrollView,
	useWindowDimensions,
	View,
} from 'react-native'
import manifest from '../manifest.json'
import {
	getSettings,
	keyOf,
	lookups,
	measured,
	setSettings,
	snapshot,
	subscribe,
	toSaved,
} from './shared'
import type { EmojiPicker, RowEmoji, SavedEmoji } from './shared'

const REACTION_INTENTION = 0
/** Page padding plus the preview card's own padding, on both sides. */
const SIDE_SPACE = 2 * 16 + 2 * 14
const GAP = 8
const MINI_ROWS = ['first', 'second', 'third']
const MINI_COLUMNS = ['a', 'b', 'c', 'd', 'e', 'f', 'g']

const GUIDE: [string, string][] = [
	[
		'Adding emojis',
		'Tap an empty spot in the preview and pick an emoji: it goes exactly there. Picking one you already have moves it.',
	],
	[
		'Moving and removing',
		'Tap an emoji, then tap any other spot: it moves there, or swaps with the emoji there. Remove leaves the spot empty.',
	],
	[
		'Rows',
		'Show 1, 2 or 3 rows in the long-press menu. The picker button ends the last row.',
	],
	[
		'Empty spots',
		'With filling on, empty spots show your frequent emojis. Turn it off to show only your own.',
	],
	[
		'How many fit',
		'Discord fits as many as the screen allows, usually six or seven a row. The preview uses the exact count once the long-press menu has been opened.',
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

const { relative } = withDependencies

/**
 * Discord's emoji picker. Its module only loads the first time someone opens the picker, so it is
 * also matched before that by its dependency layout (modules/emoji_picker/native/
 * openEmojiPickerActionSheet.tsx, with helpers right after it) and then loaded.
 */
function findPicker() {
	if (lookups.picker) return lookups.picker
	const byExports = withProps<EmojiPicker>('openEmojiPickerActionSheet')
	const found =
		lookupModule(byExports, { cached: false })[0] ??
		lookupModule(
			withDependencies([null, relative(1), null, relative(2), null, null]).and(
				byExports,
			),
			{ cached: false, initialize: true },
		)[0]
	if (found) lookups.picker = found
	return found
}

type Palette = {
	surface?: string
	tile?: string
	accent?: string
	muted?: string
}

/** Theme colors as plain strings: Discord's tokens resolved for the current theme. */
function usePalette(): Palette {
	const { theme } =
		(
			Design as unknown as {
				useThemeContext?: () => { theme?: string }
			}
		).useThemeContext?.() ?? {}
	const pick = (...names: string[]) => {
		const { colors, internal } = Tokens.default as unknown as {
			colors: Record<string, unknown>
			internal: {
				resolveSemanticColor(theme: unknown, color: unknown): unknown
			}
		}
		for (const name of names) {
			try {
				if (!colors[name]) continue
				const value = internal.resolveSemanticColor(theme, colors[name])
				if (typeof value === 'string' && value !== 'transparent') return value
			} catch {}
		}
		return undefined
	}
	return {
		surface: pick(
			'BACKGROUND_SECONDARY',
			'BACKGROUND_BASE_LOW',
			'BACKGROUND_PRIMARY',
		),
		tile: pick(
			'BACKGROUND_MODIFIER_ACCENT',
			'BACKGROUND_TERTIARY',
			'BACKGROUND_FLOATING',
		),
		accent: pick('TEXT_BRAND', 'BRAND_500', 'INTERACTIVE_ACTIVE'),
		muted: pick('INTERACTIVE_MUTED', 'TEXT_MUTED'),
	}
}

function EmojiGlyph({ emoji, size }: { emoji: SavedEmoji; size: number }) {
	if (emoji.id)
		return (
			// custom: Discord's emoji image needs its CDN URL; no design component takes an emoji
			<Image
				source={{
					uri: `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'webp'}?size=64`,
				}}
				style={{ width: size, height: size }}
			/>
		)
	return (
		<Design.Text
			variant="heading-xl/normal"
			style={{ fontSize: size * 0.85, lineHeight: size * 1.1 }}
		>
			{emoji.surrogates}
		</Design.Text>
	)
}

/**
 * A tap-to-edit copy of the quick reactions in the long-press menu.
 * custom: no Discord component draws the reaction grid outside the long-press menu.
 */
function Grid({
	spots,
	perRow,
	size,
	fill,
	selected,
	palette,
	onPress,
}: {
	spots: (SavedEmoji | null)[]
	perRow: number
	size: number
	fill: boolean
	selected: number | null
	palette: Palette
	onPress(index: number): void
}) {
	const lines: { id: string; from: number }[] = []
	for (let from = 0; from < spots.length + 1; from += perRow)
		lines.push({ id: `line-${from}`, from })
	const smiley = getAssetIdByName('ReactionIcon')
	const clock = getAssetIdByName('ClockIcon')
	const plus = getAssetIdByName('PlusSmallIcon')
	const tile = {
		width: size,
		height: size,
		borderRadius: Math.round(size * 0.28),
		alignItems: 'center' as const,
		justifyContent: 'center' as const,
		borderWidth: 2,
	}
	const icon = (
		source: number | null | undefined,
		scale: number,
		opacity = 1,
	) =>
		source != null ? (
			<Image
				source={source}
				style={{
					width: size * scale,
					height: size * scale,
					tintColor: palette.muted,
					opacity,
				}}
			/>
		) : null
	return (
		<View
			style={{
				backgroundColor: palette.surface,
				borderRadius: 20,
				padding: 14,
				gap: GAP,
			}}
		>
			{lines.map(line => (
				<View key={line.id} style={{ flexDirection: 'row', gap: GAP }}>
					{Array.from(
						{ length: perRow },
						(_, column) => line.from + column,
					).map(index => {
						if (index === spots.length)
							return (
								<View
									key="picker"
									style={[
										tile,
										{
											backgroundColor: palette.tile,
											borderColor: 'transparent',
										},
									]}
								>
									{icon(smiley, 0.42)}
								</View>
							)
						if (index > spots.length) return null
						const emoji = spots[index]
						const active = index === selected
						const target = selected != null && !active
						return (
							<Pressable
								key={`spot-${index}`}
								accessibilityRole="button"
								accessibilityLabel={
									emoji
										? `${emoji.name}, spot ${index + 1}`
										: `Empty spot ${index + 1}`
								}
								onPress={() => onPress(index)}
								style={({ pressed }) => [
									tile,
									{
										backgroundColor: emoji ? palette.tile : 'transparent',
										borderColor: active
											? palette.accent
											: emoji
												? 'transparent'
												: palette.muted,
										borderStyle: emoji || active ? 'solid' : 'dashed',
										opacity: pressed ? 0.6 : 1,
										transform: [{ scale: active ? 1.06 : 1 }],
									},
								]}
							>
								{emoji ? (
									<EmojiGlyph emoji={emoji} size={size * 0.56} />
								) : target ? (
									icon(plus, 0.4, 0.9)
								) : fill ? (
									icon(clock, 0.34, 0.45)
								) : (
									icon(plus, 0.36, 0.45)
								)}
							</Pressable>
						)
					})}
				</View>
			))}
		</View>
	)
}

/**
 * Three cards, each a miniature of the menu with that many rows.
 * custom: Discord has no choice component that shows a picture per option.
 */
function RowChoice({
	rows,
	perRow,
	palette,
	onChange,
}: {
	rows: number
	perRow: number
	palette: Palette
	onChange(rows: number): void
}) {
	return (
		<View style={{ flexDirection: 'row', gap: GAP }}>
			{[1, 2, 3].map(count => {
				const active = count === rows
				return (
					<Pressable
						key={count}
						accessibilityRole="radio"
						accessibilityState={{ selected: active }}
						accessibilityLabel={`${count} ${count === 1 ? 'row' : 'rows'}`}
						onPress={() => onChange(count)}
						style={({ pressed }) => ({
							flex: 1,
							backgroundColor: palette.surface,
							borderRadius: 16,
							borderWidth: 2,
							borderColor: active ? palette.accent : 'transparent',
							paddingVertical: 14,
							paddingHorizontal: 10,
							gap: 10,
							alignItems: 'center',
							opacity: pressed ? 0.7 : 1,
						})}
					>
						<View
							style={{
								gap: 3,
								height: 3 * 7 + 2 * 3,
								justifyContent: 'center',
							}}
						>
							{MINI_ROWS.slice(0, count).map(row => (
								<View key={row} style={{ flexDirection: 'row', gap: 3 }}>
									{MINI_COLUMNS.slice(0, Math.min(perRow, 7)).map(column => (
										<View
											key={column}
											style={{
												width: 7,
												height: 7,
												borderRadius: 2,
												backgroundColor: active
													? palette.accent
													: palette.muted,
												opacity: active ? 1 : 0.45,
											}}
										/>
									))}
								</View>
							))}
						</View>
						<Design.Text
							variant="text-sm/semibold"
							color={active ? 'text-strong' : 'text-muted'}
						>
							{count === 1 ? '1 row' : `${count} rows`}
						</Design.Text>
					</Pressable>
				)
			})}
		</View>
	)
}

export default function SettingsComponent() {
	useSyncExternalStore(subscribe, snapshot, snapshot)
	const { emojis, fill, rows } = getSettings()
	const { width } = useWindowDimensions()
	const palette = usePalette()
	const [selected, setSelected] = useState<number | null>(null)

	// Spots per row: what Discord measured, or the same sum on this screen's width.
	const perRow =
		measured.slots > 1
			? measured.slots
			: Math.max(4, Math.floor(Math.min(width, 600) / 62))
	const size = Math.max(
		34,
		Math.floor((width - SIDE_SPACE - GAP * (perRow - 1)) / perRow),
	)
	const total = rows * perRow - 1
	const spots = Array.from(
		{ length: total },
		(_, index) => emojis[index] ?? null,
	)
	const hidden = emojis.slice(total).filter(Boolean).length
	const current =
		selected != null && selected < total && emojis[selected] ? selected : null

	const place = (from: number, to: number) => {
		const next = [...emojis]
		while (next.length <= Math.max(from, to)) next.push(null)
		;[next[from], next[to]] = [next[to], next[from]]
		setSettings({ emojis: next })
	}
	const removeAt = (index: number) => {
		const next = [...emojis]
		next[index] = null
		setSettings({ emojis: next })
		setSelected(null)
	}
	const add = (at?: number) => {
		const picker = findPicker()
		if (!picker) {
			ToastActionCreators.open('dariuss.custom-quick-reactions.picker', {
				text: "Discord's emoji picker could not be found. Open it once from a message, then try again.",
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
					if (!saved) return
					const now = [...getSettings().emojis]
					const existing = now.findIndex(
						other => other != null && keyOf(other) === keyOf(saved),
					)
					// Already there: it moves to the chosen spot instead of appearing twice.
					if (existing >= 0) now[existing] = null
					const free = now.indexOf(null)
					const spot = at ?? (free >= 0 ? free : now.length)
					while (now.length <= spot) now.push(null)
					now[spot] = saved
					setSettings({ emojis: now })
				},
				channel: currentChannel(),
				pickerIntention: REACTION_INTENTION,
			},
			'stack',
		)
	}

	const press = (index: number) => {
		if (current != null) {
			if (index !== current) place(current, index)
			setSelected(null)
			return
		}
		if (emojis[index]) setSelected(index)
		else add(index)
	}

	const chosen = current != null ? emojis[current] : null
	return (
		<ScrollView keyboardShouldPersistTaps="handled">
			<Page>
				<Design.Stack spacing={24}>
					<Design.Stack spacing={10}>
						<Design.Text variant="heading-lg/bold">Quick reactions</Design.Text>
						<Design.Text variant="text-sm/normal" color="text-muted">
							{chosen
								? `Tap any spot to move :${chosen.name}: there.`
								: 'Your long-press menu. Tap an empty spot to add an emoji there, or an emoji to move it.'}
						</Design.Text>
						<Grid
							spots={spots}
							perRow={perRow}
							size={size}
							fill={fill}
							selected={current}
							palette={palette}
							onPress={press}
						/>
						{chosen && current != null ? (
							<Design.Stack direction="horizontal" spacing={8}>
								<Design.Button
									text="Remove"
									variant="destructive"
									onPress={() => removeAt(current)}
								/>
								<Design.Button
									text="Done"
									variant="secondary"
									onPress={() => setSelected(null)}
								/>
							</Design.Stack>
						) : null}
						{hidden > 0 ? (
							<Design.Text variant="text-xs/normal" color="text-muted">
								{`${hidden} more ${hidden === 1 ? 'emoji is' : 'emojis are'} saved past the last spot. Add a row to show them.`}
							</Design.Text>
						) : null}
					</Design.Stack>
					<Design.Stack spacing={10}>
						<Design.Text variant="heading-md/bold">Rows</Design.Text>
						<RowChoice
							rows={rows}
							perRow={perRow}
							palette={palette}
							onChange={count => {
								setSettings({ rows: count })
								setSelected(null)
							}}
						/>
					</Design.Stack>
					<Design.TableRowGroup>
						<Design.TableSwitchRow
							icon={<TableRowAssetIcon name="ClockIcon" />}
							label="Fill with frequent emojis"
							subLabel="Empty spots show your frequent emojis."
							value={fill}
							onValueChange={value => setSettings({ fill: value })}
						/>
						<Design.TableRow
							icon={<TableRowAssetIcon name="RefreshIcon" />}
							label="Reset"
							subLabel="Remove your emojis and turn filling back on, so Discord's frequent ones show again."
							variant="danger"
							disabled={!emojis.length && fill}
							onPress={() => {
								setSettings({ emojis: [], fill: true })
								setSelected(null)
							}}
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
