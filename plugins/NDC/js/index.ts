import { ActionSheetActionCreators } from '@valenced/discord/actions'
import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import SettingsComponent from './settings'
import type { ReactElement } from 'react'

interface Intl {
	intl: { string(message: unknown): string }
	t: Record<string, unknown>
	getAvailableLocales: unknown
}

interface AlertOptions {
	title?: unknown
	body?: unknown
	children?: unknown
	onConfirm?: unknown
}

interface Alerts {
	show(options: AlertOptions): unknown
	openLazy: unknown
	closeAll: unknown
}

interface AlertStore {
	openAlert(key: unknown, alert: unknown, ...rest: unknown[]): unknown
	dismissAlert: unknown
	dismissAlerts: unknown
}

type Element = ReactElement<{
	title?: unknown
	content?: unknown
	extraContent?: unknown
	actions?: ReactElement<{ children?: unknown }>
	onPress?: unknown
}>

// The title ("Delete Message") and body of the alert Discord shows before deleting a message.
const TITLE_KEY = 'MWMcg7'
const BODY_KEY = 'AMvpS4'
/** Used when the translations cannot be read. */
const FALLBACK_TITLE = 'Delete Message'
/** Keys Discord gives the alerts it builds from `show`. */
const LEGACY_ALERT = 'legacy-alert-'

export default plugin({
	SettingsComponent,
	start({ cleanup, logger }) {
		let intl: Intl | undefined
		// `t` is a lazy proxy, so a message is read directly instead of checked with `in`.
		const text = (key: string) => {
			try {
				const message = intl?.t[key]
				return message == null ? undefined : intl?.intl.string(message)
			} catch {
				return undefined
			}
		}

		// The delete alert previews the message being deleted.
		const previewsMessage = (children: unknown) => {
			const props = (children as { props?: { message?: { id?: unknown } } })
				?.props
			return typeof props?.message?.id === 'string'
		}

		const isDeleteConfirmation = (
			title: unknown,
			body: unknown,
			preview: unknown,
		) => {
			if (typeof title !== 'string' || !previewsMessage(preview)) return false
			return (
				title === text(TITLE_KEY) ||
				body === text(BODY_KEY) ||
				title === FALLBACK_TITLE
			)
		}

		const skip = (confirm: () => void) => {
			try {
				ActionSheetActionCreators.hideActionSheet()
			} catch {}
			confirm()
		}

		/** The "Yes" button of an alert built by `show`. */
		const confirmButton = (alert: Element) => {
			const children = alert.props.actions?.props.children
			const first = (Array.isArray(children) ? children[0] : children) as
				| Element
				| undefined
			const onPress = first?.props?.onPress
			return typeof onPress === 'function' ? (onPress as () => void) : null
		}

		cleanup(
			getModules(
				// intl/index.native.tsx
				withProps<Intl>('intl', 't', 'getAvailableLocales'),
				exports => {
					intl = exports
				},
			),
			getModules(
				// actions/native/AlertActionCreators.tsx
				withProps<Alerts>('show', 'openLazy', 'closeAll'),
				alerts => {
					cleanup(
						instead(alerts, 'show', (args, show) => {
							const [options] = args
							try {
								if (
									options &&
									typeof options.onConfirm === 'function' &&
									isDeleteConfirmation(
										options.title,
										options.body,
										options.children,
									)
								) {
									skip(options.onConfirm as () => void)
									return
								}
							} catch (error) {
								logger.error('No Delete Confirmation failed:', error)
							}
							return Reflect.apply(show, alerts, args)
						}),
					)
				},
			),
			getModules(
				// design/components/AlertModal/native/useAlertStore.native.tsx: `show` opens its alerts here.
				withProps<AlertStore>('openAlert', 'dismissAlert', 'dismissAlerts'),
				store => {
					cleanup(
						instead(store, 'openAlert', (args, openAlert) => {
							const [key, alert] = args
							try {
								if (
									typeof key === 'string' &&
									key.startsWith(LEGACY_ALERT) &&
									alert
								) {
									const { props } = alert as Element
									const confirm = confirmButton(alert as Element)
									if (
										confirm &&
										isDeleteConfirmation(
											props.title,
											props.content,
											props.extraContent,
										)
									) {
										skip(confirm)
										return
									}
								}
							} catch (error) {
								logger.error('No Delete Confirmation failed:', error)
							}
							return Reflect.apply(openAlert, store, args)
						}),
					)
				},
			),
		)
	},
})
