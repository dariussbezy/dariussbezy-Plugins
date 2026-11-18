import Page from '@valenced/components/Page'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { Tokens } from '@valenced/discord/common/tokens'
import { Design } from '@valenced/discord/design'
import { ScrollView, StyleSheet, View } from 'react-native'
import manifest from '../manifest.json'
import { useMc } from './bridge'
import { LevelLabels, useGlassColors } from './glass'
import { GlassLayers } from './inject'
import { Levels, setSetting, useSettings } from './shared'
import type { Level } from './shared'

const icon = (name: string) => <TableRowAssetIcon name={name} />

const PREVIEW_HEIGHT = 64
const PREVIEW_RADIUS = 20

/** Backdrop colours taken from the theme's own status and brand tokens. */
function useStripes() {
	const { theme } = (Design as any).useThemeContext()
	const { colors, internal } = Tokens.default as any
	return [
		'STATUS_POSITIVE_BACKGROUND',
		'STATUS_DANGER_BACKGROUND',
		'STATUS_WARNING_BACKGROUND',
		'BACKGROUND_BRAND',
		'STATUS_POSITIVE_BACKGROUND',
	].map(name => {
		try {
			return internal.resolveSemanticColor(theme, colors[name]) as string
		} catch {
			return 'transparent'
		}
	})
}

/** The bar's look on top of a colourful backdrop, so the transparency is visible. */
function Preview() {
	const settings = useSettings()
	const mc = useMc()
	const level = mc ? mc.level : settings.level
	const colors = useGlassColors(level)
	const stripes = useStripes()
	return (
		// custom: a static mock of the bar over a backdrop; no native component draws this
		<View style={{ height: 120, borderRadius: 16, overflow: 'hidden' }}>
			<View style={[StyleSheet.absoluteFill, { flexDirection: 'row' }]}>
				{stripes.map((color, index) => (
					<View
						// biome-ignore lint/suspicious/noArrayIndexKey: static list
						key={index}
						style={{ flex: 1, backgroundColor: color }}
					/>
				))}
			</View>
			<View
				style={{
					position: 'absolute',
					left: 16,
					right: 16,
					bottom: 16,
					height: PREVIEW_HEIGHT,
					borderRadius: PREVIEW_RADIUS,
					backgroundColor: settings.enabled ? colors.body : undefined,
					borderWidth: settings.enabled ? 1 : 0,
					borderColor: colors.border,
				}}
			>
				{settings.enabled ? (
					<GlassLayers
						colors={colors}
						level={level}
						radius={PREVIEW_RADIUS}
						joined={false}
					/>
				) : null}
			</View>
		</View>
	)
}

export default function SettingsComponent() {
	const settings = useSettings()
	const mc = useMc()
	return (
		<ScrollView keyboardShouldPersistTaps="handled">
			<Page>
				<Design.Stack spacing={24}>
					<Design.TableRowGroup title="Preview">
						<Preview />
					</Design.TableRowGroup>
					<Design.TableRowGroup title="Transparent YOUBAR">
						<Design.TableSwitchRow
							label="Transparent look"
							subLabel="Applies to the YouBar after Discord restarts."
							icon={icon('PaintPaletteIcon')}
							value={settings.enabled}
							onValueChange={value => setSetting('enabled', value)}
						/>
						<Design.TableSwitchRow
							label="Hide the nameplate"
							subLabel="Removes the nameplate Discord draws in the YouBar (its local nameplate setting), so the bar is fully transparent. Applies after Discord restarts."
							subLabelLineClamp={4}
							icon={icon('EyeSlashIcon')}
							value={settings.hideNameplate}
							onValueChange={value => setSetting('hideNameplate', value)}
						/>
						<Design.TableSwitchRow
							label="Remove the dark bar under it"
							subLabel="Removes the dark shade Discord adds under the YouBar, for better transparency. Applies after Discord restarts."
							subLabelLineClamp={4}
							icon={icon('ImageIcon')}
							value={settings.hideShade}
							onValueChange={value => setSetting('hideShade', value)}
						/>
						{mc ? (
							<Design.TableRow
								label="Following Music Controls"
								subLabel={`Following Music Controls while its player is shown (${LevelLabels[mc.level].label}).`}
								subLabelLineClamp={3}
								icon={icon('MusicIcon')}
							/>
						) : null}
					</Design.TableRowGroup>
					<Design.TableRadioGroup
						title="Transparency"
						value={settings.level}
						onChange={value => {
							if (Levels.includes(value as Level))
								setSetting('level', value as Level)
						}}
					>
						{Levels.map(id => (
							<Design.TableRadioRow
								key={id}
								value={id}
								label={LevelLabels[id].label}
								subLabel={LevelLabels[id].subLabel}
							/>
						))}
					</Design.TableRadioGroup>
					<Design.Text variant="text-sm/medium" color="text-muted">
						Transparent YOUBAR {manifest.version}
					</Design.Text>
				</Design.Stack>
			</Page>
		</ScrollView>
	)
}
