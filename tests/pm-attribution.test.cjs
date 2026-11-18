const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const source = path.join(__dirname, '../plugins/PM/js')

// The monitor keeps its numbers on the global object; start from nothing.
for (const name of ['state', 'recording'])
	delete globalThis[Symbol.for(`dariuss.performance-monitor.${name}`)]

/** Compiles a Performance Monitor source file to CommonJS and runs it with the given module stubs. */
function load(file, modules) {
	const code = ts.transpileModule(fs.readFileSync(path.join(source, file), 'utf8'), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	}).outputText
	const module = { exports: {} }
	new Function('exports', 'require', 'module', code)(
		module.exports,
		name => {
			if (!(name in modules)) throw new Error(`unexpected import ${name}`)
			return modules[name]
		},
		module,
	)
	return module.exports
}

const recording = load('recording.ts', {})
const manifest = { default: { id: 'dariuss.performance-monitor', name: 'Performance Monitor', version: '0' } }
const monitor = load('monitor.ts', { '../manifest.json': manifest, './recording': recording })
const runs = load('runs.ts', { './monitor': monitor })

const spin = ms => {
	const end = performance.now() + ms
	while (performance.now() < end);
}

let lastHook

/** Registers a hook as if it came from the given plugin: its id is read from the call stack. */
function register(api, id, fn) {
	const code = "(function (api, fn) { api.patcher.after({ name: 'Target' }, 'run', fn) })"
	vm.runInThisContext(code, { filename: `Valenced:Plugin:${id}` })(api, fn)
	return lastHook
}

function fakeApi() {
	const dispatcher = {
		dispatch() {
			spin(40)
		},
	}
	return {
		patcher: {
			before: () => () => {},
			after: (_target, _key, hook) => {
				lastHook = hook
				return () => {}
			},
			instead: () => () => {},
		},
		react: { jsxRuntime: { beforeJSX() {}, afterJSX() {}, insteadJSX() {} } },
		discord: { flux: {}, common: { flux: { Dispatcher: dispatcher } } },
		modules: { finders: { getModules() {}, waitForModules() {} } },
	}
}

const api = fakeApi()
// No real timers in the test: a check of the thread in the middle of a case would reset its counters.
const realSetInterval = globalThis.setInterval
globalThis.setInterval = () => 0
const undo = monitor.install(api)
globalThis.setInterval = realSetInterval

test('a stall is split by plugin hooks, Discord Flux and the rest, and names the plugin that led it', () => {
	const heavy = register(api, 'alpha', () => spin(60))
	const light = register(api, 'beta', () => spin(2))
	monitor.reset()
	heavy()
	light()
	api.discord.common.flux.Dispatcher.dispatch()
	monitor.onTick(200, Date.now())
	const stall = monitor.thread.last
	assert.ok(stall, 'a stall of 200 ms is recorded')
	assert.equal(stall.top[0].id, 'alpha')
	assert.ok(stall.hookMs >= 58 && stall.hookMs <= 90, `hook time ${stall.hookMs}`)
	assert.ok(stall.fluxMs >= 35 && stall.fluxMs <= 60, `flux time ${stall.fluxMs}`)
	assert.ok(
		Math.abs(stall.hookMs + stall.fluxMs + stall.otherMs - 200) < 0.01,
		'the parts add up to the stall',
	)
	assert.equal(stall.slowest.id, 'alpha')
	assert.equal(monitor.culprits.get('alpha').stalls, 1, 'alpha led the stall')
	assert.equal(monitor.culprits.get('beta').stalls, 0, 'beta did not')
})

test('a stall with no plugin work is left unexplained instead of blamed on a plugin', () => {
	monitor.reset()
	monitor.onTick(200, Date.now())
	const stall = monitor.thread.last
	assert.equal(stall.hookMs, 0)
	assert.equal(stall.fluxMs, 0)
	assert.equal(stall.otherMs, 200)
	assert.equal(stall.top.length, 0)
})

test('a check that is very late means the app was suspended, not a stall', () => {
	monitor.reset()
	monitor.onTick(8000, Date.now())
	assert.equal(monitor.thread.stallCount, 0)
	assert.ok(monitor.state.pausedMs >= 8000)
})

test('the parts of a stall never add up to more than the stall', () => {
	const slow = register(api, 'gamma', () => spin(30))
	monitor.reset()
	slow()
	slow()
	slow()
	monitor.onTick(100, Date.now())
	const stall = monitor.thread.last
	assert.ok(stall.hookMs <= 100)
	assert.ok(stall.hookMs + stall.fluxMs + stall.otherMs <= 100.01)
})

test('percentiles come from the duration classes and never exceed the longest call', () => {
	const fast = new Float64Array(22)
	fast[1] = 99
	fast[10] = 1
	assert.equal(monitor.percentile([fast], 0.95, 100), 0.04)
	assert.equal(monitor.percentile([fast], 1, 100), 20.48)
	assert.equal(monitor.percentile([fast], 1, 5), 5, 'capped at the longest call')
	assert.equal(monitor.percentile([new Float64Array(22)], 0.95, 5), 0)
})

test('light mode times about one call in ten and scales the totals back up', () => {
	const cheap = register(api, 'delta', () => {})
	monitor.reset()
	monitor.state.sampleEvery = 10
	for (let i = 0; i < 20000; i++) cheap()
	monitor.state.sampleEvery = 1
	const entry = monitor.stats.get('delta')
	assert.ok(entry.calls > 14000 && entry.calls < 26000, `estimated calls ${entry.calls}`)
})

test('hooks are summed per hooked function across plugins', () => {
	monitor.reset()
	register(api, 'one', () => spin(1))()
	register(api, 'two', () => spin(1))()
	const total = monitor.hookedFunctions().find(item => item.label.includes('Target'))
	assert.equal(total.plugins, 2)
	assert.ok(monitor.hookKinds().some(kind => kind.label === 'Patches'))
})

test('the monitor estimates its own cost per timed call', () => {
	assert.ok(monitor.overhead.perCallMs >= 0 && monitor.overhead.perCallMs < 1)
	assert.ok(monitor.monitorCostMs() >= 0)
})

test('comparing a baseline with a run with plugins shows what the plugins add', () => {
	const base = {
		id: '1', at: 1000, activity: 'scrolling', seconds: 120, otherPlugins: 0, lightMode: false,
		stalls: { count: 2, ms: 400, max: 250 }, hookPercent: 0,
		split: { hooks: 0, flux: 10, other: 90 }, top: [],
	}
	const loaded = {
		id: '2', at: 2000, activity: 'scrolling', seconds: 120, otherPlugins: 9, lightMode: false,
		stalls: { count: 12, ms: 3000, max: 600 }, hookPercent: 4.2,
		split: { hooks: 60, flux: 10, other: 30 }, top: [{ id: 'a', name: 'Alpha', percent: 3.1 }],
	}
	const lines = runs.compareRuns(base, loaded)
	const text = lines.join('\n')
	assert.match(text, /Stalls per minute: 1 → 6 \(\+5\)/)
	assert.match(text, /baseline/)
	assert.match(text, /Alpha: 0% → 3.1%/)
	assert.match(text, /A is a baseline/)
})

test('JS frames are counted by a single loop, even when counting is started twice or after a restart', () => {
	const queue = []
	globalThis.requestAnimationFrame = callback => queue.push(callback)
	try {
		monitor.reset()
		const first = monitor.countFrames()
		const second = monitor.countFrames()
		assert.equal(queue.length, 1, 'one loop for two users')
		// A restart of the plugin forgets the loop it started: a new one must replace it, not join it.
		monitor.frames.running = false
		const third = monitor.countFrames()
		assert.equal(queue.length, 2)
		const stale = queue.shift()
		const current = queue.shift()
		stale(0)
		assert.equal(queue.length, 0, 'the older loop stops by itself')
		current(100)
		current(116)
		assert.equal(queue.length, 2)
		for (const release of [first, second, third]) release()
	} finally {
		delete globalThis.requestAnimationFrame
	}
})

test.after(() => undo())
