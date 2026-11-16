import { ToastActionCreators } from '@valenced/discord/actions'
import { FileModule } from '@valenced/discord/native'
import { lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { Platform, Share } from 'react-native'

export interface Attachment {
	id?: string
	filename?: string
	url?: string
	proxy_url?: string
	content_type?: string
}

interface EmbedMedia {
	url?: string
	proxyURL?: string
	proxy_url?: string
	contentType?: string
	content_type?: string
}

interface Embed {
	type?: string
	url?: string
	video?: EmbedMedia
	thumbnail?: EmbedMedia
	image?: EmbedMedia
	images?: EmbedMedia[]
}

export interface Message {
	id?: string
	attachments?: Attachment[]
	embeds?: Embed[]
}

/** Discord's media manager, the module behind the native "Save" action of a single attachment. */
export interface MediaManager {
	downloadMediaAsset(url: string, type: number): unknown
	/** Android only: names the saved file by its real type, so non-media files keep their extension. */
	downloadMediaAssetWithContentType?(
		url: string,
		type: number,
		contentType: string | null,
	): unknown
}

/** Media types Discord passes to `downloadMediaAsset`. Android detects the type itself, iOS picks the album by it. */
const MediaType = { image: 0, gif: 1, video: 2 } as const

const ImageExtension = /\.(png|jpe?g|webp|heic|heif|bmp|avif)$/i
const VideoExtension = /\.(mp4|mov|webm|m4v|mkv)$/i

const urlOf = (attachment: Attachment) =>
	(attachment.url ?? attachment.proxy_url) as string

/** The media type of a photo, GIF or video; null for any other file. */
function mediaType({ content_type, filename, url }: Attachment) {
	const type = content_type?.toLowerCase() ?? ''
	const name = (filename ?? url ?? '').split('?')[0]
	if (type === 'image/gif' || /\.gif$/i.test(name)) return MediaType.gif
	if (type.startsWith('video/') || VideoExtension.test(name))
		return MediaType.video
	if (type.startsWith('image/') || ImageExtension.test(name))
		return MediaType.image
	return null
}

/** Tenor serves the GIF of a video at the same path with "AC" in place of the last two id characters. */
function tenorGif(url: string) {
	const path = url.split('?')[0].split('/')
	const at = path.findIndex(part => part.endsWith('.tenor.com'))
	if (at < 0) return
	const [host, id, file] = path.slice(at, at + 3)
	if (!host || !id || !file) return
	return `https://${host}/${id.slice(0, -2)}AC/${file.split('.')[0]}.gif`
}

const GifHost = /(^|[./])(tenor|giphy|klipy)\.com\//i
const GifFile = /\.gif(\?|$)/i
const VideoFile = /\.(mp4|webm|mov)(\?|$)/i

/** Every http(s) URL in an embed, whatever its field names, since the mobile record shape is not documented. */
function urlsOf(value: unknown, depth = 0): string[] {
	if (typeof value === 'string')
		return /^https?:\/\//.test(value) ? [value] : []
	if (!value || typeof value !== 'object' || depth > 2) return []
	return Object.values(value).flatMap(child => urlsOf(child, depth + 1))
}

/** GIF embeds (Tenor, Giphy, Klipy...) play as videos; Tenor ones are saved as the real GIF. */
function gifOf(embed: Embed): Attachment | undefined {
	if (!embed || typeof embed !== 'object') return
	// Records may expose fields as getters, which Object.values misses, so the known ones are read too.
	const urls = [
		...new Set([
			...urlsOf([
				embed.url,
				embed.video?.url,
				embed.video?.proxyURL,
				embed.video?.proxy_url,
				embed.thumbnail?.url,
				embed.thumbnail?.proxyURL,
				embed.image?.url,
			]),
			...urlsOf(embed),
		]),
	]
	const looksLikeGif =
		/gif/i.test(String(embed.type ?? '')) ||
		urls.some(url => GifHost.test(url) || GifFile.test(url))
	if (!looksLikeGif) return
	const gif =
		urls.map(tenorGif).find(Boolean) ?? urls.find(url => GifFile.test(url))
	if (gif) return { url: gif, content_type: 'image/gif' }
	const video = urls.find(url => VideoFile.test(url))
	if (video) return { url: video, content_type: 'video/mp4' }
}

/** The same picture can come as an attachment and in an embed, or twice in an X post. */
const keyOf = (url: string) => url.split('?')[0]

const isUrl = (value: unknown): value is string =>
	typeof value === 'string' && /^https?:\/\//.test(value)

/**
 * A photo or video shown in an embed (X posts, link previews...). Discord's proxy copy is preferred,
 * since it is what the client shows and it stays reachable; a video is kept only when it is a file,
 * not a player page like YouTube's.
 */
function mediaOf(
	media: EmbedMedia | undefined,
	kind: 'image' | 'video',
): Attachment | undefined {
	if (!media) return
	const original = isUrl(media.url) ? media.url : undefined
	const proxy = [media.proxyURL, media.proxy_url].find(isUrl)
	const url = proxy ?? original
	if (!url) return
	const type = media.contentType ?? media.content_type
	if (
		kind === 'video' &&
		!type?.startsWith('video/') &&
		!proxy &&
		!VideoFile.test(url)
	)
		return
	// Without a known type the extension decides; links like X's "?format=jpg" have none, so the kind does.
	const named = /\.(png|jpe?g|webp|gif|heic|avif|mp4|mov|webm|m4v)$/i.test(
		keyOf(url),
	)
	return {
		url,
		content_type:
			type ??
			(named ? undefined : kind === 'video' ? 'video/mp4' : 'image/jpeg'),
	}
}

/** Every photo and video of an embed; the thumbnail only counts when the embed shows nothing bigger. */
function embedMedia(embed: Embed): Attachment[] {
	if (!embed || typeof embed !== 'object') return []
	const gif = gifOf(embed)
	if (gif) return [gif]
	const found = [
		mediaOf(embed.video, 'video'),
		mediaOf(embed.image, 'image'),
		...(Array.isArray(embed.images)
			? embed.images.map(image => mediaOf(image, 'image'))
			: []),
	].filter((item): item is Attachment => !!item)
	if (found.length) return found
	const thumbnail = mediaOf(embed.thumbnail, 'image')
	return thumbnail ? [thumbnail] : []
}

export function downloadable(message: Message | undefined): Attachment[] {
	const seen = new Set<string>()
	return [
		...(message?.attachments ?? []).filter(attachment =>
			isUrl(attachment.url ?? attachment.proxy_url),
		),
		...(message?.embeds ?? []).flatMap(embedMedia),
	].filter(item => {
		const key = keyOf(urlOf(item))
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
}

let toastCount = 0
const toast = (text: string, variant?: 'success' | 'critical') =>
	ToastActionCreators.open(`dariuss.bulk-downloads.${++toastCount}`, {
		text,
		...(variant ? { variant } : {}),
	})

const fileNameOf = (attachment: Attachment, index: number) =>
	(attachment.filename ?? urlOf(attachment).split('?')[0].split('/').pop())
		?.replace(/[\\/:*?"<>|]/g, '_')
		.trim() || `attachment-${index + 1}`

/** Downloads a file as base64: Discord's asset reader first, then fetch, since iOS's reader refuses CDN URLs. */
async function base64Of(url: string) {
	try {
		return await FileModule.readAsset(url, 'base64')
	} catch {
		const response = await fetch(url)
		if (!response.ok) throw new Error(`Download failed (${response.status})`)
		const blob = await response.blob()
		const dataUrl = await new Promise<string>((resolve, reject) => {
			const reader = new FileReader()
			reader.onload = () => resolve(String(reader.result))
			reader.onerror = () => reject(new Error('Could not read the download'))
			reader.readAsDataURL(blob)
		})
		return dataUrl.slice(dataUrl.indexOf(',') + 1)
	}
}

/**
 * iOS saves media to Photos only, so any other file is copied to Discord's cache and handed
 * to the share sheet, where "Save to Files" keeps it. Resolves false when the sheet is dismissed.
 */
async function shareFile(attachment: Attachment, index: number) {
	const data = await base64Of(urlOf(attachment))
	const path = await FileModule.writeFile(
		'cache',
		`bulk-downloads/${fileNameOf(attachment, index)}`,
		data,
		'base64',
	)
	const result = await Share.share({
		url: path.startsWith('file://') ? path : `file://${path}`,
	})
	return result.action === Share.sharedAction
}

interface Http {
	post(request: { url: string; body: unknown }): Promise<{
		body?: { refreshed_urls?: { original: string; refreshed: string }[] }
	}>
}

const AttachmentLink =
	/^https:\/\/(cdn|media)\.discordapp\.(com|net)\/(ephemeral-)?attachments\//

/**
 * Attachment links are signed and expire, and CDN answers 404 once they do. Discord's own client
 * asks for fresh links the same way before it opens an old attachment.
 */
async function refreshLinks(attachments: Attachment[]) {
	const links = attachments.map(urlOf).filter(url => AttachmentLink.test(url))
	if (!links.length) return attachments
	const [module] = lookupModule(withProps<{ HTTP: Http }>('HTTP'))
	if (!module?.HTTP) return attachments
	const response = await module.HTTP.post({
		url: '/attachments/refresh-urls',
		body: { attachment_urls: links },
	})
	const fresh = new Map(
		(response.body?.refreshed_urls ?? []).map(item => [
			item.original,
			item.refreshed,
		]),
	)
	return attachments.map(attachment => {
		const url = fresh.get(urlOf(attachment))
		return url ? { ...attachment, url } : attachment
	})
}

/** Types to try in order: iOS's numbering is not documented, so a refused type falls back to the others. */
const typesFor = (type: number) =>
	type === MediaType.gif
		? [MediaType.gif, MediaType.image, MediaType.video]
		: type === MediaType.video
			? [MediaType.video, MediaType.gif, MediaType.image]
			: [MediaType.image]

/** Saves a photo, GIF or video with Discord's media manager; on iOS the share sheet is the last resort. */
async function saveMedia(
	manager: MediaManager,
	attachment: Attachment,
	type: number,
	index: number,
) {
	let lastError: unknown
	// Android ignores the type, so a retry there would only save the file twice.
	for (const candidate of Platform.OS === 'ios' ? typesFor(type) : [type])
		try {
			await (typeof manager.downloadMediaAssetWithContentType === 'function'
				? manager.downloadMediaAssetWithContentType(
						urlOf(attachment),
						candidate,
						attachment.content_type ?? null,
					)
				: manager.downloadMediaAsset(urlOf(attachment), candidate))
			return true
		} catch (error) {
			lastError = error
		}
	if (Platform.OS === 'ios') return shareFile(attachment, index)
	throw lastError
}

/** Saves the attachments one after another through Discord's own media manager. */
export async function downloadAll(
	manager: MediaManager | undefined,
	attachments: Attachment[],
	onError: (error: unknown) => void,
) {
	const total = attachments.length
	if (!manager) {
		toast('Could not find Discord’s download module', 'critical')
		return
	}
	toast(total === 1 ? 'Saving attachment…' : `Saving ${total} attachments…`)
	try {
		attachments = await refreshLinks(attachments)
	} catch (error) {
		onError(error)
	}
	let saved = 0
	let failure: string | undefined
	for (const [index, attachment] of attachments.entries()) {
		try {
			const type = mediaType(attachment)
			if (type === null && Platform.OS === 'ios') {
				if (await shareFile(attachment, index)) saved++
			} else {
				if (
					await saveMedia(manager, attachment, type ?? MediaType.image, index)
				)
					saved++
			}
		} catch (error) {
			failure ??= error instanceof Error ? error.message : String(error)
			onError(error)
		}
		if (index < total - 1 && total > 3 && (index + 1) % 3 === 0)
			toast(`Saved ${saved} of ${total}…`)
	}
	toast(
		failure
			? `Saved ${saved} of ${total}: ${failure}`
			: `Saved ${saved} of ${total}`,
		saved === total ? 'success' : saved ? undefined : 'critical',
	)
}
