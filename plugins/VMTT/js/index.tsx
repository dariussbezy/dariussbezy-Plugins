import { onFluxEventDispatched } from '@valenced/discord/flux'
import { getJsonStorage } from '@valenced/json-storage'
import { pluginStorageDirFor } from '@valenced/plugins/constants'
import { startStatsFor, withStats } from '../../../lib/stats-ui'
import manifest from '../manifest.json'
import { patchRows } from './inline'
import { patchMessageMenu } from './menu'
import { createRuntime, setRuntime } from './runtime'
import SettingsComponent from './settings'
import { DefaultSettings } from './shared'
import type { History } from './runtime'
import type { Settings } from './shared'

/** Lets Quick Translate know which messages show their transcript inline. */
interface TranscriptBridge {
	getTranscript(id: string): string | undefined
	handlesInline(id: string): boolean
}

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: { load: true, default: DefaultSettings },
	async start({ cleanup, jsonStorage, plugin: instance }) {
		cleanup(startStatsFor(manifest, jsonStorage))
		await jsonStorage.get()
		const history = getJsonStorage<History>(
			`${pluginStorageDirFor(manifest.id)}/transcripts.json`,
			{ default: { items: [] } },
		)
		await history.get()

		const report = (error: unknown) => instance.reportError(error)
		const runtime = createRuntime({ settings: jsonStorage, history, report })
		runtime.load()
		setRuntime(runtime)

		const bridge: TranscriptBridge = {
			getTranscript: id => runtime.transcripts.get(id)?.text,
			handlesInline: id =>
				runtime.inlineReady &&
				runtime.settings().inline &&
				runtime.transcripts.has(id),
		}
		const scope = globalThis as {
			__valencedVoiceTranscriptBridge?: TranscriptBridge
		}
		scope.__valencedVoiceTranscriptBridge = bridge

		// Undo functions run in reverse order, after the runtime stops its work.
		const undo: (() => void)[] = []
		const register = (fn: () => void) => undo.push(fn)
		register(patchRows(runtime, register, report))
		patchMessageMenu(runtime, register)
		register(
			onFluxEventDispatched<{ optimistic?: boolean }>(
				'MESSAGE_CREATE',
				event => {
					try {
						runtime.onMessageCreate(event)
					} catch (error) {
						report(error)
					}
					return event
				},
			),
		)

		cleanup(() => {
			runtime.dispose()
			for (const fn of undo.splice(0).reverse()) fn()
			if (scope.__valencedVoiceTranscriptBridge === bridge)
				scope.__valencedVoiceTranscriptBridge = undefined
			setRuntime(undefined)
		})

		if (instance.startedLate) instance.requireReload()
	},
	stop({ plugin: instance }) {
		instance.requireReload()
	},
	SettingsComponent: withStats(manifest, SettingsComponent),
})
