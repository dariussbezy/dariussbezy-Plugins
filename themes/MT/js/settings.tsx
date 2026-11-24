import Page from '@valenced/components/Page'
import { Design } from '@valenced/discord/design'
import * as React from 'react'
import { ScrollView } from 'react-native'
import { StatsRow } from '../../../lib/stats-ui'
import manifest from '../manifest.json'
import { DefaultLook, Limits, readLook, refreshColors, writeLook } from './look'
import palette from './palette.json'
import type { Look } from './look'

export default function Settings({ api }: any) {
	const { Stack, TableRowGroup, TableRow, TableSwitchRow, Button } = Design
	const h = React.createElement
	const row = (label: string, subLabel: string) =>
		h(TableRow, { key: label, label, subLabel })
	const [look, setLook] = React.useState<Look>(readLook)
	const [changed, setChanged] = React.useState(false)
	const save = (patch: Partial<Look>) => {
		const next = { ...look, ...patch }
		setLook(next)
		setChanged(true)
		try {
			writeLook(next)
		} catch {}
	}
	// One restart prompt when leaving these settings, not one per change: the wallpaper is given to
	// Valenced when the theme registers, so it applies after a restart.
	const changedRef = React.useRef(false)
	changedRef.current = changed
	React.useEffect(
		() => () => {
			if (!changedRef.current) return
			void refreshColors(manifest.id, palette)
			api?.plugin?.requireReload?.()
		},
		[api],
	)
	/** A value with − and + buttons. custom: Discord's slider ignores touches in plugin settings on iPhone. */
	const stepper = (
		key: 'blur' | 'dimming' | 'brightness',
		label: string,
		subLabel: string,
		shown: (value: number) => string,
	) => {
		const { min, max, step } = Limits[key]
		const set = (value: number) =>
			save({
				[key]: Math.round(Math.min(max, Math.max(min, value)) * 100) / 100,
			})
		return h(TableRow, {
			key,
			label: `${label}: ${shown(look[key])}`,
			subLabel,
			disabled: !look.wallpaper,
			trailing: h(
				Stack,
				{ direction: 'horizontal', spacing: 8 },
				h(Button, {
					size: 'sm',
					variant: 'secondary',
					text: '−',
					disabled: !look.wallpaper || look[key] <= min,
					onPress: () => set(look[key] - step),
				}),
				h(Button, {
					size: 'sm',
					variant: 'secondary',
					text: '+',
					disabled: !look.wallpaper || look[key] >= max,
					onPress: () => set(look[key] + step),
				}),
			),
		})
	}
	const percent = (value: number) => `${Math.round(value * 100)}%`
	return h(
		Page,
		{},
		h(
			ScrollView,
			{ contentContainerStyle: { paddingBottom: 24 } },
			h(
				Stack,
				{ spacing: 24 },
				h(
					TableRowGroup,
					{ title: 'Wallpaper', children: null },
					h(TableSwitchRow, {
						label: 'Show the wallpaper',
						subLabel:
							"The original Midnight wallpaper behind Discord's screens.",
						value: look.wallpaper,
						onValueChange: (wallpaper: boolean) => save({ wallpaper }),
					}),
					stepper(
						'blur',
						'Blur',
						'How soft the wallpaper looks. Desktop Midnight: 8.',
						value => String(value),
					),
					stepper(
						'dimming',
						'Surface opacity',
						'How much of the wallpaper the panels cover. Desktop Midnight: 60%.',
						percent,
					),
					stepper(
						'brightness',
						'Wallpaper brightness',
						'How bright the wallpaper itself is.',
						percent,
					),
					h(TableRow, {
						label: 'Reset to the desktop look',
						onPress: () => save({ ...DefaultLook }),
					}),
				),
				h(
					TableRowGroup,
					{ title: 'Text', children: null },
					h(TableSwitchRow, {
						label: 'Brighter channel names',
						subLabel:
							'Channel names one step lighter, so they stay readable over the wallpaper.',
						value: look.brightChannels,
						onValueChange: (brightChannels: boolean) =>
							save({ brightChannels }),
					}),
				),
				changed
					? h(
							TableRowGroup,
							{ children: null },
							row(
								'Restart Discord to apply',
								'Discord asks to restart once you leave these settings.',
							),
						)
					: null,
				h(StatsRow, null),
				h(
					TableRowGroup,
					{ title: 'Quick guide', children: null },
					row(
						'Choose Midnight (Auto)',
						'Open Valenced Settings → Themes → Color themes → Midnight.',
					),
					row(
						'Font and moon icon',
						'Choose Midnight Figtree under Fonts for the original typography, and Midnight Moon under Icons for the moon logo, as in the desktop theme. Restart after changing either.',
					),
					row(
						'Automatic appearance',
						"The palette follows Discord's appearance. Select automatic appearance in Discord to follow your device.",
					),
				),
				h(
					TableRowGroup,
					{ title: 'About', children: null },
					row(
						`Midnight Mobile · ${manifest.version}`,
						'Desktop theme by refact0r. Mobile adaptation by dariussbezy. Desktop window controls and hover effects do not apply on mobile.',
					),
				),
			),
		),
	)
}
