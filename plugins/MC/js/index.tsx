import { clearBridge } from './bridge'
import { patchYouBar } from './inject'
import { startMusic } from './music'
import { closeSearch } from './search'
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

		// Spotify works everywhere; the Music Controls app (Android only) is started inside startMusic.
		cleanup(() => setStorage(undefined), clearBridge, closeSearch, startMusic())
		patchYouBar(cleanup, error => plugin.reportError(error))

		// The YouBar is already rendered when the plugin starts late; it cannot be re-patched live.
		if (plugin.startedLate) plugin.requireReload()
	},
	SettingsComponent,
})
