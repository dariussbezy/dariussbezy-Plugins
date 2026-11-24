/// <reference types="@valenced/themes-api" />

import { startStatsFor, withStats } from '../../../lib/stats-ui'
import manifest from '../manifest.json'
import { applyLook, readLook, refreshColors } from './look'
import palette from './palette.json'

let Settings: ((props: any) => any) | undefined

export default plugin<{ jsonStorage: Record<string, never> }>({
	jsonStorage: { load: true, default: {} },
	preInit({ themes }) {
		const look = readLook()
		themes.registerGroup('midnight', {
			name: 'Midnight',
			description: 'Midnight by refact0r, adapted for mobile by dariuss.',
		})
		themes.registerTheme('midnight', 'auto', {
			name: 'Midnight (Auto)',
			description:
				"Blue accents, translucent navy panels and the original Midnight wallpaper. Follows Discord's light or dark appearance.",
			getColors: () => applyLook(palette, look),
			// As on desktop by default: surfaces at 60% over the wallpaper, softened like its panel blur.
			...(look.wallpaper
				? {
						background: {
							path: 'assets/wallpaper.png',
							opacity: look.brightness,
							blur: look.blur,
							dimming: look.dimming,
						},
					}
				: {}),
		})
		const families: Record<
			string,
			import('@valenced/themes-api/types').FontVariant[]
		> = {}
		for (const [suffix, weight] of Object.entries({
			Normal: 400,
			Medium: 500,
			Semibold: 600,
			Bold: 700,
			ExtraBold: 800,
		})) {
			for (const italic of [false, true]) {
				families[`ggsans-${suffix}${italic ? 'Italic' : ''}`] = [
					{
						path: italic ? 'assets/Figtree-Italic.ttf' : 'assets/Figtree.ttf',
						weight,
						italic,
						axes: { wght: weight },
					},
				]
			}
		}
		themes.registerFontPack('midnight', 'figtree', {
			name: 'Midnight Figtree',
			description: 'Original Figtree typography, including bold and italic.',
			families,
		})
		themes.registerIconPack('midnight', 'moon', {
			name: 'Midnight Moon',
			description: 'Original moon logo for Home and mobile DMs navigation.',
			icons: { ClydeIcon: 'assets/moon.png', HomeIcon: 'assets/moon.png' },
		})
	},
	async init() {
		Settings = (await import('./settings')).default
	},
	async start({ jsonStorage, cleanup, plugin: instance }) {
		cleanup(startStatsFor(manifest, jsonStorage))
		void refreshColors(manifest.id, palette)
		const { startAppearance } = await import('./layout')
		cleanup(startAppearance((error: unknown) => instance.reportError(error)))
		if (instance.startedLate) instance.requireReload()
	},
	SettingsComponent: withStats(manifest, props =>
		// Rendered as its own component, so its hooks never mix with the wrapper's.
		Settings ? <Settings {...props} /> : null,
	),
})
