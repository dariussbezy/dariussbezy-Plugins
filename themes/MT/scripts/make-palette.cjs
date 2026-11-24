// Fills js/palette.json with every semantic color Discord mobile uses (scripts/mobile-tokens.json,
// read from the decompiled app), mapped to the roles of the desktop Midnight theme
// (midnight-auto-v2_theme.css): text-0..5, bg-1..4, hover/active, accent-1..3 and the status colors.
// Colors already in the palette were tuned by hand and are kept. Run: node themes/MT/scripts/make-palette.cjs
const fs = require('node:fs')
const path = require('node:path')

const base = path.resolve(__dirname, '..')
const file = path.join(base, 'js/palette.json')
const palette = JSON.parse(fs.readFileSync(file, 'utf8'))
const tokens = JSON.parse(fs.readFileSync(path.join(__dirname, 'mobile-tokens.json'), 'utf8'))

function hsl(h, s, l) {
	s /= 100
	l /= 100
	const f = n => {
		const k = (n + h / 30) % 12
		const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
		return Math.round(c * 255).toString(16).padStart(2, '0').toUpperCase()
	}
	return `#${f(0)}${f(8)}${f(4)}`
}

/** The desktop theme's roles, as the palette already resolves them. */
const roles = {
	dark: {
		text0: '#0D152B',
		text1: '#EFF4FB',
		text2: '#B3C8E6',
		text3: '#91A6CA',
		text4: '#566C9F',
		text5: '#39456A',
		bg1: '#222F59',
		bg2: '#192548',
		bg3: '#131D39',
		bg4: '#0D152B',
		floating: '#101932',
		tint: '#6787E4',
		accent1: '#65BDFF',
		accent2: '#44A5FF',
		accent3: '#2389FF',
		red: '#DA7D9B',
		green: '#4AB494',
		yellow: '#C9AB56',
		blue: '#46AEC5',
		border: '#FFFFFF1A',
	},
	light: {
		text0: '#0B0C0F',
		text1: '#0B0C0F',
		text2: hsl(220, 15, 10),
		text3: '#2B303B',
		text4: '#576175',
		text5: hsl(220, 20, 60),
		bg1: '#C0CADD',
		bg2: '#CAD2E2',
		bg3: '#D4DBE8',
		bg4: '#DEE3ED',
		floating: '#D4DBE8',
		tint: '#5973A6',
		accent1: '#339EB5',
		accent2: '#44A5FF',
		accent3: '#2389FF',
		red: '#DA7D9B',
		green: '#4AB494',
		yellow: '#C9AB56',
		blue: '#46AEC5',
		border: '#0000001A',
	},
}

/** Same color with an alpha, as #RRGGBBAA. */
const alpha = (color, value) =>
	`${color.slice(0, 7)}${Math.round(value * 255).toString(16).padStart(2, '0').toUpperCase()}`

/**
 * Rules in order; the first match wins. A rule returns a color, or null to keep Discord's own
 * (brand gradients, Nitro, profile themes, overlays drawn on photos, and the chat and tab bar
 * backgrounds, which must stay see-through over the wallpaper).
 */
const rules = [
	[/GRADIENT|HEXAGON|TENURE|PREMIUM|NITRO|STEAM_REVIEW|BADGE_(EPIC|MYTHIC|RARE)|^BLACK$|OVERLAY_(DARK|LIGHT)|TEXT_OVERLAY|ICON_TRANSPARENT|OVERLAY_BACKDROP|CONTEXT_MENU_BACKDROP|SCRIM$|STANDALONE_CHANNEL_CONTENT|TAB_BAR_BACKGROUND|SCRIM_OPAQUE/, () => null],
	// Blur stand-ins: the floating surface, slightly see-through.
	[/BLUR_FALLBACK|BLUR_OVERLAY/, r => alpha(r.floating, 0.92)],
	// Status: red, green, yellow and blue of the desktop theme.
	[/^TOAST_(CRITICAL|SUCCESS)_BACKGROUND$|^MOBILE_TOAST_BACKGROUND/, r => r.floating],
	[/TOAST_CRITICAL_BORDER|INLINENOTICE_BORDER_CRITICAL|BORDER_VOICE_MUTED|TOGGLEBUTTON_CRITICAL_BORDER/, r => r.red],
	[/TOAST_SUCCESS_BORDER|INLINENOTICE_BORDER_POSITIVE|BORDER_FEEDBACK_POSITIVE/, r => r.green],
	[/INLINENOTICE_BORDER_WARNING|BORDER_FEEDBACK_WARNING/, r => r.yellow],
	[/INLINENOTICE_BORDER_INFO|BORDER_FEEDBACK_INFO/, r => r.blue],
	[/BACKGROUND_VOICE_MUTED|TOGGLEBUTTON_CRITICAL_BACKGROUND|MESSAGE_AUTOMOD_BACKGROUND_DEFAULT/, r => alpha(r.red, 0.16)],
	[/MESSAGE_AUTOMOD_BACKGROUND_HOVER/, r => alpha(r.red, 0.1)],
	[/BUTTON_DANGER_BACKGROUND_DISABLED/, r => alpha(r.red, 0.4)],
	[/TOGGLEBUTTON_CRITICAL_ICON|BADGE_CRITICAL_BACKGROUND|BADGE_CRITICAL_BORDER|ICON_VOICE_DISCONNECTED|TEXT_VOICE_DISCONNECTED/, r => r.red],
	[/STATUS_WARNING_BACKGROUND/, r => alpha(r.yellow, 0.2)],
	[/STATUS_WARNING_TEXT|BADGE_WARNING_BACKGROUND|BADGE_WARNING_BORDER/, r => r.yellow],
	[/STATUS_POSITIVE_TEXT|BADGE_SUCCESS_BACKGROUND|BADGE_SUCCESS_BORDER|VOICE_CONNECTED|VOICE_SPEAKING|REDESIGN_ACTIVITY_CARD_BADGE_ICON|CONTROL_CONNECTED_BORDER/, r => r.green],
	[/CONTROL_CONNECTED_BACKGROUND/, r => alpha(r.green, 0.2)],
	[/CONTROL_CONNECTED_TEXT/, r => r.text1],
	// Badges: colored ones carry dark text, like accent elements on desktop.
	[/BADGE_(PRIMARY|EXPRESSIVE)_(BACKGROUND|BORDER)/, r => r.accent2],
	[/BADGE_NOTIFICATION_BORDER/, r => r.bg4],
	[/BADGE_(SECONDARY|COMMON)_(BACKGROUND|BORDER)/, r => r.bg1],
	[/BADGE_(SECONDARY|COMMON)_TEXT/, r => r.text2],
	[/BADGE_INVERTED_(BACKGROUND|BORDER)/, r => r.text1],
	[/BADGE_.*_TEXT/, r => r.text0],
	// Mentions and highlights: the accent at 10% (5% when pressed), as desktop's mention gradient.
	[/MESSAGE_MENTIONED_BACKGROUND_DEFAULT|MESSAGE_HIGHLIGHT_BACKGROUND_DEFAULT|BUTTON_OUTLINE_BRAND_BACKGROUND_HOVER/, r => alpha(r.accent2, 0.1)],
	[/MESSAGE_MENTIONED_BACKGROUND_HOVER|MESSAGE_HIGHLIGHT_BACKGROUND_HOVER/, r => alpha(r.accent2, 0.05)],
	[/KEYWORD_HIGHLIGHT_BACKGROUND/, r => alpha(r.accent2, 0.2)],
	[/MOBILE_CHAT_NEW_MESSAGE|ICON_FEEDBACK_NOTIFICATION|ACTIVITY_TIMEBAR|CONTROL_BRAND_FOREGROUND|VOICE_MESSAGE_RECORDING_SPINNER|BUTTON_OUTLINE_BRAND_BORDER/, r => r.accent2],
	[/SEND_BUTTON_ACTIVE_BACKGROUND|VOICE_MESSAGE_RECORDING_LOCK_BACKGROUND_ACTIVE|REDESIGN_INPUT_CONTROL_SELECTED|SWITCH_THUMB_ICON_ACTIVE/, r => r.accent3],
	[/SEND_BUTTON_ICON_ACTIVE|VOICE_MESSAGE_RECORDING_LOCK_ICON_ACTIVE/, r => r.text0],
	// Selection and pressed states: desktop's hover (14%), active (24%) and active-2 (34%) tints.
	[/TOGGLEBUTTON_BACKGROUND_SELECTED_ACTIVE|INTERACTIVE_ACCENT_BACKGROUND_ACTIVE/, r => alpha(r.tint, 0.34)],
	[/TOGGLEBUTTON_BACKGROUND_SELECTED|CHANNEL_ITEM_BACKGROUND_SELECTED|INTERACTIVE_ACCENT_BACKGROUND_SELECTED|REDESIGN_IMAGE_BUTTON_PRESSED|REDESIGN_INPUT_CONTROL_ACTIVE|DATEPICKER_RANGE_BACKGROUND_HOVER/, r => alpha(r.tint, 0.24)],
	[/INTERACTIVE_ACCENT_BACKGROUND_DEFAULT|DATEPICKER_RANGE_BACKGROUND_DEFAULT|ANDROID_BUTTON_BACKGROUND_RIPPLE|SPOILER_REVEALED/, r => alpha(r.tint, 0.14)],
	[/TOGGLEBUTTON_BORDER|MOBILE_CHATINPUT_BORDER_ACTIVE/, r => alpha(r.tint, 0.24)],
	[/BORDER|DIVIDER|THREAD_CHANNEL_SPINE/, r => alpha(r.tint, 0.14)],
	// Text and icons.
	[/TOGGLEBUTTON_ICON(_ONLY_ICON)?_(SELECTED|ACTIVE)|TAB_LABEL_TEXT_FOCUSED|CHAT_INPUT_ACTION_ICON_ACTIVE|REDESIGN_BUTTON_TERTIARY(_PRESSED)?_TEXT|MOBILE_LEGACY_BUTTON_SECONDARY_TEXT|SWITCH_THUMB_BACKGROUND/, r => r.text1],
	[/MOBILE_TEXT_HEADING_PRIMARY|ABOUT_ME_HEADING|TEXT_CODE/, r => r.text2],
	[/TOGGLEBUTTON_ICON(_ONLY_ICON)?_HOVER|VOICE_CHANNEL_USER_LIMIT_(ICON|TEXT)|VOICE_MESSAGE_RECORDING_LOCK_ICON_DEFAULT|NAVIGATOR_HEADER_TINT|MOBILE_HEADER_ICON/, r => r.text3],
	[/TOGGLEBUTTON_ICON|TAB_LABEL_TEXT_DEFAULT|ICON_DEFAULT|_TINT$|ICON_COLOR_DEFAULT|SWITCH_THUMB_ICON|CHANNEL_NAME_TEXT|CHANNEL_TEXT_DEFAULT|WAVEFORM_BAR/, r => r.text4],
	[/CHANNEL_NAME_MUTED/, r => r.text5],
	// Surfaces: floating panels, then bg-1 (pressed), bg-2 (controls), bg-3 (cards), bg-4 (base).
	[/ACTIONSHEET|ALERT_BACKGROUND|EXPRESSION_PICKER|KEYBOARD_PANEL|KEYBOARD_GAP|COACHMARK_BACKGROUND|VOICE_PANEL_BACKGROUND|COMMAND_BAR_BACKGROUND|COMMAND_CATEGORIES|FLOATING_ACCESSORY_BACKGROUND|USER_PROFILE_CONTAINER/, r => r.floating],
	[/PRESSED|SEGMENTED_CONTROL_INDICATOR|STAGE_CARD_PILL|SPOILER_HIDDEN|PILL_BACKGROUND|VOICE_PANEL_BADGE|USER_LIMIT_ACCENT/, r => r.bg1],
	[/CHATINPUT_BACKGROUND|CHAT_INPUT_BACKGROUND|CHAT_INPUT_ACTION_BUTTON_BACKGROUND|EMOJI_BUTTON|GUILDBAR_ICON_BACKGROUND|GUILD_FOLDER|CUSTOM_STATUS_BUBBLE|POLLS_NORMAL_IMAGE|LEGACY_BUTTON_SECONDARY_BACKGROUND|REDESIGN_BUTTON_TERTIARY_BACKGROUND|VOICE_MESSAGE_RECORDING_LOCK_BACKGROUND|USER_LIMIT_BACKGROUND|FLOATINGBAR_BACKGROUND_NAMEPLATE|BANNER_BACKGROUND|APP_LAUNCHER_ROW|SEGMENTED_CONTROL_BACKGROUND/, r => r.bg2],
	[/EMBED_BACKGROUND|CHAT_BANNER|TABLEROW_BACKGROUND|CARD_SECONDARY_BACKGROUND|TAB_BAR_BACKGROUND|VIDEO_TILE_BACKGROUND|APP_LAUNCHER_CARD|CARD_MUTED_BG/, r => r.bg3],
	[/NAVIGATION_BAR_BACKGROUND|SCRIM_OPAQUE|TYPING_INDICATOR_BACKGROUND|STANDALONE_CHANNEL_CONTENT/, r => r.bg4],
]

const unmatched = new Set()
let added = 0
for (const [scheme, colors] of Object.entries(palette.semantic)) {
	const role = roles[scheme === 'light' ? 'light' : 'dark']
	for (const token of tokens) {
		if (colors[token]) continue
		const rule = rules.find(([pattern]) => pattern.test(token))
		if (!rule) {
			unmatched.add(token)
			continue
		}
		const color = rule[1](role)
		if (color) {
			colors[token] = color
			added++
		}
	}
	palette.semantic[scheme] = Object.fromEntries(
		Object.entries(colors).sort(([a], [b]) => a.localeCompare(b)),
	)
}
fs.writeFileSync(file, `${JSON.stringify(palette, null, '\t')}\n`)
console.log(`added ${added} colors over ${Object.keys(palette.semantic).length} appearances`)
if (unmatched.size) console.log(`kept Discord's own for: ${[...unmatched].join(', ')}`)
