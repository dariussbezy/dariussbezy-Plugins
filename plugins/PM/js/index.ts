import { install, state } from './monitor'
import SettingsComponent from './settings'

export default plugin({
	// Runs before other plugins init and start, so the hooks they add then are timed.
	// After it stops, hooks it wrapped call straight through until Discord reloads.
	preInit({ cleanup, plugin, unscoped }) {
		state.startedLate = plugin.startedLate
		cleanup(install(unscoped))
	},
	// Valenced registers the settings page when it sees a plugin become started. Without a start
	// lifecycle that happens at once during boot, before its settings screen listens, so the page
	// would not open. An empty start lets the status change arrive a tick later, like other plugins.
	start() {},
	SettingsComponent,
})
