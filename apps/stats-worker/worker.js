// Plugin statistics: plugins POST a small report, the owner reads them on a password page.
// Cloudflare Worker with a D1 database bound as DB and a secret DASH_PASSWORD.

const MAX_BODY = 8 * 1024
const SCHEMA = `CREATE TABLE IF NOT EXISTS reports (
	plugin TEXT NOT NULL,
	user_id TEXT NOT NULL,
	username TEXT,
	plugin_version TEXT,
	platform TEXT,
	os_version TEXT,
	discord_version TEXT,
	valenced_version TEXT,
	settings TEXT,
	first_seen INTEGER NOT NULL,
	last_seen INTEGER NOT NULL,
	PRIMARY KEY (plugin, user_id)
)`

const text = (value, max = 64) =>
	typeof value === 'string' ? value.slice(0, max) : value == null ? null : String(value).slice(0, max)

async function report(request, env) {
	const raw = await request.text()
	if (raw.length > MAX_BODY) return new Response('too large', { status: 413 })
	let body
	try {
		body = JSON.parse(raw)
	} catch {
		return new Response('bad json', { status: 400 })
	}
	const plugin = text(body.plugin, 80)
	const userId = text(body.userId, 24)
	if (!plugin || !/^[\w.-]+$/.test(plugin) || !userId || !/^\d{5,24}$/.test(userId))
		return new Response('bad report', { status: 400 })
	const now = Date.now()
	await env.DB.exec(SCHEMA.replace(/\s+/g, ' '))
	await env.DB.prepare(
		`INSERT INTO reports VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
		ON CONFLICT(plugin, user_id) DO UPDATE SET username = ?3, plugin_version = ?4,
		platform = ?5, os_version = ?6, discord_version = ?7, valenced_version = ?8,
		settings = ?9, last_seen = ?10`,
	)
		.bind(
			plugin,
			userId,
			text(body.username),
			text(body.pluginVersion, 24),
			text(body.platform, 16),
			text(body.osVersion, 32),
			text(body.discordVersion, 32),
			text(body.valencedVersion, 32),
			JSON.stringify(body.settings ?? {}).slice(0, 4000),
			now,
		)
		.run()
	return new Response('ok')
}

const escape = value =>
	String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** "deletedHighlightColor" -> "Deleted highlight color". */
const humanize = key =>
	key
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/^./, c => c.toUpperCase())
		.replace(/ ([A-Z])(?=[a-z])/g, (_, c) => ` ${c.toLowerCase()}`)

/** One line per setting: on/off as a check, colors as a swatch, the rest as text. */
function settingsList(raw) {
	let settings
	try {
		settings = JSON.parse(raw ?? '{}')
	} catch {
		return escape(raw)
	}
	const lines = Object.entries(settings)
		.sort(([a, x], [b, y]) => (typeof x === typeof y ? a.localeCompare(b) : typeof x === 'boolean' ? -1 : 1))
		.map(([key, value]) => {
			let shown
			if (value === true) shown = '<span class="on">✓</span>'
			else if (value === false) shown = '<span class="off">✗</span>'
			else if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value))
				shown = `<span class="swatch" style="background:${value}"></span>${escape(value)}`
			else shown = escape(value === '' ? '(empty)' : value)
			return `<div class="setting"><span>${escape(humanize(key))}</span><b>${shown}</b></div>`
		})
	return lines.length ? `<details><summary>${lines.length} settings</summary>${lines.join('')}</details>` : '-'
}

const authorized = (request, env) =>
	!!env.DASH_PASSWORD &&
	(request.headers.get('authorization') ?? '') === `Basic ${btoa(`owner:${env.DASH_PASSWORD}`)}`

const loginRequired = () =>
	new Response('Login required', {
		status: 401,
		headers: { 'www-authenticate': 'Basic realm="Plugin stats"' },
	})

/** Deletes the reports of one plugin, or all of them, then goes back to the dashboard. */
async function reset(request, env) {
	if (!authorized(request, env)) return loginRequired()
	// Only the dashboard's own form may reset: another site cannot post here with the saved login.
	if (request.headers.get('origin') !== new URL(request.url).origin)
		return new Response('forbidden', { status: 403 })
	const form = await request.formData()
	if (form.get('confirm') !== 'RESET') return new Response('type RESET to confirm', { status: 400 })
	const plugin = String(form.get('plugin') ?? '')
	await env.DB.exec(SCHEMA.replace(/\s+/g, ' '))
	if (plugin) await env.DB.prepare('DELETE FROM reports WHERE plugin = ?1').bind(plugin).run()
	else await env.DB.prepare('DELETE FROM reports').run()
	return new Response(null, { status: 303, headers: { location: '/' } })
}

async function dashboard(request, env) {
	if (!authorized(request, env)) return loginRequired()
	await env.DB.exec(SCHEMA.replace(/\s+/g, ' '))
	const { results } = await env.DB.prepare(
		'SELECT * FROM reports ORDER BY last_seen DESC LIMIT 2000',
	).all()
	const plugins = {}
	for (const row of results) plugins[row.plugin] = (plugins[row.plugin] ?? 0) + 1
	const date = ms => new Date(ms).toISOString().slice(0, 10)
	const rows = results
		.map(
			r => `<tr><td>${escape(r.plugin)}</td><td>${escape(r.username)}<br><small>${escape(r.user_id)}</small></td>
<td>${escape(r.plugin_version)}</td><td>${escape(r.platform)} ${escape(r.os_version)}</td>
<td>${escape(r.discord_version)}</td><td>${escape(r.valenced_version)}</td>
<td>${settingsList(r.settings)}</td><td>${date(r.first_seen)}</td><td>${date(r.last_seen)}</td></tr>`,
		)
		.join('')
	const options = Object.keys(plugins)
		.sort()
		.map(name => `<option value="${escape(name)}">${escape(name)}</option>`)
		.join('')
	const summary = Object.entries(plugins)
		.map(([name, count]) => `<li>${escape(name)}: ${count}</li>`)
		.join('')
	return new Response(
		`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Plugin stats</title><style>body{font:14px system-ui;margin:16px;background:#111;color:#ddd}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #333;padding:6px;vertical-align:top}
th{background:#222;position:sticky;top:0}small{color:#999;word-break:break-all}
.setting{display:flex;justify-content:space-between;gap:12px;padding:2px 0;border-bottom:1px solid #222}
.setting b{font-weight:600;white-space:nowrap}.on{color:#3ba55c}.off{color:#ed4245}
.swatch{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:4px;vertical-align:-2px}
summary{cursor:pointer;color:#8ab4f8}td:nth-child(7){min-width:260px}
form{margin:12px 0;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
select,input,button{font:inherit;padding:6px 8px;background:#222;color:#ddd;border:1px solid #444;border-radius:6px}
button{background:#5c2226;border-color:#ed4245;cursor:pointer}</style>
<h1>Plugin stats</h1><ul>${summary}</ul>
<form method="post" action="/reset" onsubmit="return confirm('Delete these reports? This cannot be undone.')">
<select name="plugin"><option value="">All plugins</option>${options}</select>
<input name="confirm" placeholder="Type RESET" autocomplete="off" required>
<button>Reset reports</button></form><table><tr><th>Plugin</th><th>User</th><th>Version</th>
<th>Device</th><th>Discord</th><th>Valenced</th><th>Settings</th><th>First seen</th><th>Last seen</th></tr>${rows}</table>`,
		{ headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
	)
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url)
		if (request.method === 'POST' && url.pathname === '/report') return report(request, env)
		if (request.method === 'GET' && url.pathname === '/') return dashboard(request, env)
		if (request.method === 'POST' && url.pathname === '/reset') return reset(request, env)
		return new Response('not found', { status: 404 })
	},
}
