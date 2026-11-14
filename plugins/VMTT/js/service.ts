import {
	DefaultServer,
	GroqBase,
	Languages,
	modelFor,
	Providers,
} from './shared'
import type { Settings } from './shared'

const Timeout = 90_000

export interface ServiceResult {
	text: string
	language: string
}

interface Response {
	ok: boolean
	status: number
	body: string
}

interface TranscriptionBody {
	text?: string
	language?: string
	detected_language?: string
	detectedLanguage?: string
	error?: string | { message?: string }
}

/** Fetch with a timeout and external cancellation; the body is read before the timer stops. */
async function send(
	url: string,
	init: RequestInit,
	cancel: AbortSignal,
): Promise<Response> {
	const controller = new AbortController()
	const abort = () => controller.abort()
	cancel.addEventListener('abort', abort)
	const timer = setTimeout(abort, Timeout)
	try {
		const response = await fetch(url, { ...init, signal: controller.signal })
		return {
			ok: response.ok,
			status: response.status,
			body: await response.text(),
		}
	} finally {
		clearTimeout(timer)
		cancel.removeEventListener('abort', abort)
	}
}

function parse(body: string): TranscriptionBody | undefined {
	try {
		return JSON.parse(body)
	} catch {}
}

function explain({ status, body }: Response, server: boolean) {
	if (status === 401 || status === 403)
		return server
			? 'The server rejected the request (check the token)'
			: 'The API key was rejected'
	if (status === 413) return 'This voice message is too large for the service'
	if (status === 429) return 'Rate limit reached, try again in a moment'
	if (status >= 500) return 'The service is unavailable right now'
	const error = parse(body)?.error
	const detail = typeof error === 'string' ? error : error?.message
	return detail
		? detail.slice(0, 140)
		: `The service could not read this audio (${status})`
}

export function errorText(error: unknown) {
	if (error instanceof Error)
		return error.name === 'AbortError' ? 'The request timed out' : error.message
	return 'unknown error'
}

const serverEndpoint = (settings: Settings) =>
	settings.serverUrl.trim() || DefaultServer

function languageName(data: TranscriptionBody, settings: Settings) {
	const raw = (
		data.language ??
		data.detected_language ??
		data.detectedLanguage ??
		(settings.language === 'auto' ? '' : settings.language)
	)
		.trim()
		.toLowerCase()
	const known = Languages.find(
		({ value, label }) =>
			value !== 'auto' && (value === raw || label.toLowerCase() === raw),
	)
	return known?.label ?? (raw && raw !== 'auto' ? raw : 'Unknown language')
}

/** Sends the audio URL (never the file or any Discord credential) to the selected service. */
export async function transcribe(
	audioUrl: string,
	settings: Settings,
	cancel: AbortSignal,
): Promise<ServiceResult> {
	const server = settings.provider === 'server'
	const language = settings.language === 'auto' ? undefined : settings.language
	let response: Response

	if (server) {
		response = await send(
			serverEndpoint(settings),
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					url: audioUrl,
					language,
					response_format: 'verbose_json',
				}),
			},
			cancel,
		)
	} else {
		const key = settings.apiKey.trim()
		if (!key) throw new Error('Add your API key in the plugin settings first')
		const form = new FormData()
		form.append('model', modelFor(settings))
		form.append('response_format', 'verbose_json')
		if (language) form.append('language', language)
		form.append('url', audioUrl)
		response = await send(
			`${GroqBase}/audio/transcriptions`,
			{
				method: 'POST',
				headers: { Authorization: `Bearer ${key}` },
				body: form,
			},
			cancel,
		)
	}

	if (!response.ok) throw new Error(explain(response, server))
	const data = parse(response.body)
	const text = data?.text?.trim()
	if (!data || !text)
		throw new Error('No speech was found in this voice message')
	return { text, language: languageName(data, settings) }
}

/** Returns a message for the user describing whether the service is reachable. */
export async function checkConnection(settings: Settings, cancel: AbortSignal) {
	const server = settings.provider === 'server'
	const key = settings.apiKey.trim()
	if (!server && !key) return 'Paste your API key first'
	const response = server
		? await send(serverEndpoint(settings), {}, cancel)
		: await send(
				`${GroqBase}/models`,
				{ headers: { Authorization: `Bearer ${key}` } },
				cancel,
			)
	return response.ok ? 'Connection works' : explain(response, server)
}

export const providerName = (settings: Settings) =>
	Providers[settings.provider].name
