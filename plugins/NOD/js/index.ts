import { getModuleWithImportedPath } from '@valenced/discord/utils/modules/finders'
import { after } from '@valenced/patcher'
import SettingsComponent from './settings'

/** Discord's server onboarding screens, found by their source path. */
const SCREENS = [
	'modules/guild_onboarding/native/GuildOnboardingModal.tsx',
	'modules/guild_onboarding/native/GuildOnboardingManager.tsx',
	'modules/guild_onboarding/native/GuildOnboardingPrompts.tsx',
	'modules/guild_onboarding/native/GuildOnboardingPrompt.tsx',
	'modules/guild_onboarding/native/GuildOnboardingConnectionPrompt.tsx',
	'modules/guild_onboarding/native/CustomizeCommunity.tsx',
	'modules/guild_onboarding/native/GuildOnboardingCompleted.tsx',
	'modules/guild_onboarding_home/native/GuildOnboardingHomePage.tsx',
	'modules/guild_onboarding_home/native/GuildOnboardingNewMemberActions.tsx',
	'modules/guild_onboarding_home/native/HomeWelcomeMessage.tsx',
	'modules/welcome_screen/native/GuildWelcomeActionSheet.tsx',
]

/** A timer set this soon after an onboarding screen rendered belongs to it. */
const RECENT_MS = 500
/** Only waits of this length are skipped: shorter ones are debounces and frame work, longer ones are network timeouts. */
const MIN_WAIT_MS = 150
const MAX_WAIT_MS = 5000

type Render = Record<string, (...args: never[]) => unknown>

export default plugin({
	SettingsComponent,
	start({ cleanup, logger }) {
		let lastRender = 0
		const patched = new WeakSet<object>()

		const apply = (namespace: unknown) => {
			try {
				const ns = namespace as Record<string, unknown> | undefined
				const inner = (ns?.default ?? ns) as Record<string, unknown> | undefined
				const hasType = typeof inner?.type === 'function'
				const hasRender = typeof inner?.render === 'function'
				const target = (hasType || hasRender ? inner : ns) as Render | undefined
				const key = hasType ? 'type' : hasRender ? 'render' : 'default'
				if (!target || typeof target[key] !== 'function' || patched.has(target))
					return
				patched.add(target)
				cleanup(
					after(target as Record<typeof key, Render[string]>, key, rendered => {
						lastRender = Date.now()
						return rendered
					}),
				)
			} catch (error) {
				logger.error('Could not patch an onboarding screen', error)
			}
		}
		for (const path of SCREENS) cleanup(getModuleWithImportedPath(path, apply))

		// Waits are skipped where they are set: once a screen has rendered, its next timers run at once.
		const original = globalThis.setTimeout
		const skipping = ((
			handler: (...args: unknown[]) => void,
			ms?: number,
			...args: unknown[]
		) => {
			const wait =
				typeof ms === 'number' &&
				ms >= MIN_WAIT_MS &&
				ms <= MAX_WAIT_MS &&
				Date.now() - lastRender < RECENT_MS
					? 0
					: ms
			return original(handler, wait, ...args)
		}) as typeof setTimeout
		globalThis.setTimeout = skipping
		cleanup(() => {
			if (globalThis.setTimeout === skipping) globalThis.setTimeout = original
		})
	},
})
