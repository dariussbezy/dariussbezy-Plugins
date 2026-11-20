export interface Settings {
	/** Seconds a toast stays on screen. */
	seconds: number
	/** Close the toast on screen when another one opens. */
	replace: boolean
	/** Show long toast text over several lines instead of cutting it. Needs a reload. */
	full: boolean
	/** Copy the toast text when the toast is tapped. Needs a reload. */
	copy: boolean
	/** Longer messages stay longer. */
	byLength: boolean
	/** Keep the last toasts to read again in the settings. */
	history: boolean
	/** A short vibration when an error toast appears. */
	haptic: boolean
	/** Holding a finger on a toast stops its timer. Needs a reload. */
	pause: boolean
	/** Swipe a toast to dismiss it. Needs a reload. */
	swipe: boolean
}

export const DefaultSettings: Settings = {
	seconds: 3,
	replace: true,
	full: false,
	copy: false,
	byLength: true,
	history: true,
	haptic: true,
	pause: false,
	swipe: false,
}
