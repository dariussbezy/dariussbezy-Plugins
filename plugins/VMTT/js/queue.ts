const Concurrency = 2
const MaxWaiting = 20

interface Job {
	work: () => Promise<void>
	cancel: () => void
}

/** Runs at most two jobs at once. Manual jobs jump ahead of automatic ones. */
export function createQueue() {
	const waiting: Job[] = []
	let running = 0

	function drain() {
		while (running < Concurrency && waiting.length) {
			const job = waiting.shift() as Job
			running++
			job.work().finally(() => {
				running--
				drain()
			})
		}
	}

	return {
		run<T>(work: () => Promise<T>, automatic: boolean) {
			if (running >= Concurrency && waiting.length >= MaxWaiting)
				return Promise.reject(
					new Error('Too many pending transcriptions; try again shortly'),
				)
			return new Promise<T | undefined>((resolve, reject) => {
				const job: Job = {
					work: () => work().then(resolve, reject),
					// Cancelled jobs resolve empty so callers simply stop.
					cancel: () => resolve(undefined),
				}
				if (automatic) waiting.push(job)
				else waiting.unshift(job)
				drain()
			})
		},
		clear() {
			for (const job of waiting.splice(0)) job.cancel()
		},
	}
}
