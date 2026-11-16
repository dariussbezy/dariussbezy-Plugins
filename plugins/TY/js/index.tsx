import { patchYouBar } from './inject'
import SettingsComponent from './settings'
import { DefaultSettings, setStorage } from './shared'
import type { Settings } from './shared'

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DefaultSettings,
	},
	async start({ cleanup, jsonStorage, plugin }) {
		await jsonStorage.get()
		setStorage(jsonStorage)
		cleanup(() => setStorage(undefined))
		patchYouBar(cleanup, error => plugin.reportError(error))

		// The YouBar is already rendered when the plugin starts late; it cannot be re-patched live.
		if (plugin.startedLate) plugin.requireReload()
	},
	SettingsComponent,
})
