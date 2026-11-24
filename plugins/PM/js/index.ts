import { startStatsFor, withStats } from '../../../lib/stats-ui'
import manifest from '../manifest.json'
import { DefaultAiSettings } from './ai'
import { install, state } from './monitor'
import SettingsComponent from './settings'
import type { AiSettings } from './ai'

export default plugin<{ jsonStorage: AiSettings }>({
	// Holds the Groq key and model of the AI review.
	jsonStorage: { load: true, default: DefaultAiSettings },
	// Runs before other plugins init and start, so the hooks they add then are timed.
	// After it stops, hooks it wrapped call straight through until Discord reloads.
	preInit({ cleanup, plugin, unscoped }) {
		state.startedLate = plugin.startedLate
		cleanup(install(unscoped))
	},
	// Valenced registers the settings page when it sees a plugin become started. Without a start
	// lifecycle that happens at once during boot, before its settings screen listens, so the page
	// would not open. An empty start lets the status change arrive a tick later, like other plugins.
	async start({ cleanup, jsonStorage }) {
		cleanup(startStatsFor(manifest, jsonStorage))
		const saved = await jsonStorage.get()
		// Light mode is a saved choice: apply it as soon as the settings are read.
		state.sampleEvery = saved?.lightMode ? 10 : 1
	},
	SettingsComponent: withStats(manifest, SettingsComponent),
})
