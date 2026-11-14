export type ProviderId = 'server' | 'groq'
export type AutoMode = 'off' | 'dms' | 'all'

export interface Settings {
	provider: ProviderId
	apiKey: string
	serverUrl: string
	model: string
	language: string
	inline: boolean
	card: boolean
	auto: AutoMode
	saveTranscripts: boolean
}

export interface Transcript {
	id: string
	channelId: string
	text: string
	language: string
	at: number
	/** Voice message length in seconds. */
	dur: number
	/** Display name of the service that produced it. */
	by: string
}

export interface Option<T extends string = string> {
	value: T
	label: string
}

export const DefaultSettings: Settings = {
	provider: 'server',
	apiKey: '',
	serverUrl: '',
	model: 'whisper-large-v3-turbo',
	language: 'auto',
	inline: true,
	card: false,
	auto: 'off',
	saveTranscripts: true,
}

export const DefaultServer = 'https://small-bread-a3d3.dariussbezy.workers.dev'
export const GroqBase = 'https://api.groq.com/openai/v1'
export const MaxTranscripts = 200

export const Providers: Record<ProviderId, { name: string; models: Option[] }> =
	{
		server: {
			name: 'Free server (no key)',
			models: [
				{ value: 'whisper-large-v3-turbo', label: 'Whisper large v3 turbo' },
			],
		},
		groq: {
			name: 'Groq',
			models: [
				{
					value: 'whisper-large-v3-turbo',
					label: 'Whisper large v3 turbo (fast)',
				},
				{ value: 'whisper-large-v3', label: 'Whisper large v3 (accurate)' },
			],
		},
	}

export const ProviderOptions = (Object.keys(Providers) as ProviderId[]).map(
	value => ({ value, label: Providers[value].name }),
)

const languages: [string, string][] = [
	['en', 'English'],
	['ro', 'Romanian'],
	['es', 'Spanish'],
	['fr', 'French'],
	['de', 'German'],
	['it', 'Italian'],
	['pt', 'Portuguese'],
	['ru', 'Russian'],
	['uk', 'Ukrainian'],
	['pl', 'Polish'],
	['nl', 'Dutch'],
	['tr', 'Turkish'],
	['ar', 'Arabic'],
	['he', 'Hebrew'],
	['hi', 'Hindi'],
	['ja', 'Japanese'],
	['ko', 'Korean'],
	['zh', 'Chinese'],
	['cs', 'Czech'],
	['sv', 'Swedish'],
	['hu', 'Hungarian'],
	['el', 'Greek'],
	['bg', 'Bulgarian'],
	['id', 'Indonesian'],
	['vi', 'Vietnamese'],
	['th', 'Thai'],
]

export const Languages: Option[] = [
	{ value: 'auto', label: 'Auto-detect' },
	...languages.map(([value, label]) => ({ value, label })),
]

export const AutoModes: Option<AutoMode>[] = [
	{ value: 'off', label: 'Off' },
	{ value: 'dms', label: 'Direct messages only' },
	{ value: 'all', label: 'All chats' },
]

export const labelOf = (options: Option[], value: string) =>
	options.find(option => option.value === value)?.label ?? value

/** Models offered by the provider, falling back to its first one for stale stored values. */
export function modelFor(settings: Settings) {
	const { models } = Providers[settings.provider]
	return models.some(m => m.value === settings.model)
		? settings.model
		: models[0].value
}

export function formatDuration(seconds: number) {
	const total = Math.max(0, Math.round(seconds))
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
