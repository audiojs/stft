import test, { ok } from 'tst'
import { stftBatch, stftStream, stftAnalyse } from './index.js'

const fs = 44100
const identity = (mag, phase) => ({ mag, phase })

function sine (f, n) {
	let d = new Float32Array(n)
	for (let i = 0; i < n; i++) d[i] = Math.sin(2 * Math.PI * f * i / fs)
	return d
}
function maxDiff (a, b, from = 0, to = Math.min(a.length, b.length)) {
	let m = 0
	for (let i = from; i < to; i++) m = Math.max(m, Math.abs(a[i] - b[i]))
	return m
}

test('stft — identity roundtrip is transparent', () => {
	let x = sine(440, fs)
	let y = stftBatch(x, identity, { fs })
	ok(maxDiff(x, y) < 1e-6, 'batch roundtrip, first to last sample')
})

// Head fix regression: frames start on the hop grid N − hop before the input, so the first samples keep the
// steady-state overlap count too. From sample 0 alone, they fell under the normalization floor: a fade-in of
// -52 dB over the first 5 ms, -8 dB at 10–20 ms (N = 2048). Reference: the input itself (identity process).
test('stft: the head is reconstructed at full amplitude, no fade-in, batch and stream, any frame size', () => {
	let seed = 1, x = new Float32Array(8192).map(() => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5)
	for (let N of [512, 1024, 2048, 4096]) for (let hop of [N >> 1, N >> 2]) {
		let y = stftBatch(x, identity, { fs, frameSize: N, hopSize: hop })
		let s = stftStream(identity, { fs, frameSize: N, hopSize: hop }), parts = []
		for (let i = 0; i < x.length; i += 100) parts.push(s.write(x.subarray(i, i + 100)))
		parts.push(s.flush())
		let z = new Float32Array(parts.reduce((a, p) => a + p.length, 0)), o = 0
		for (let p of parts) { z.set(p, o); o += p.length }
		ok(maxDiff(x, y, 0, N) < 1e-6 && maxDiff(x, z, 0, N) < 1e-6, `N ${N}, hop ${hop}: first frame transparent (batch ${maxDiff(x, y, 0, N).toExponential(0)}, stream ${maxDiff(x, z, 0, N).toExponential(0)})`)
	}
})

test('stft: ctx.pos is each frame\'s first input sample, from hop − N, batch and stream alike', () => {
	let x = sine(440, 10000), N = 2048, hop = 512
	let seen = mode => { let p = []; return [p, (mag, phase, state, ctx) => { p.push(ctx.pos); return { mag, phase } }] }
	let [pb, fb] = seen(), [ps, fs_] = seen()
	stftBatch(x, fb, { fs, frameSize: N, hopSize: hop })
	let s = stftStream(fs_, { fs, frameSize: N, hopSize: hop })
	for (let i = 0; i < x.length; i += 777) s.write(x.subarray(i, i + 777))
	s.flush()
	ok(pb[0] === hop - N && pb.every((p, i) => p === hop - N + i * hop) && pb[pb.length - 1] < x.length, `batch: ${pb[0]}, then every ${hop}, to ${pb[pb.length - 1]}`)
	ok(ps.slice(0, pb.length).every((p, i) => p === pb[i]), 'stream: the same positions')
})

// Before the input, frames see its mirror image (x[-k] = x[k], numpy's 'reflect'): a process that learns from
// the first frames (a noise profile) meets the signal's own level. Over silence, the first frame of steady noise
// read 7 dB low, and a Wiener denoiser's profile with it: VoiceBank+DEMAND SI-SDR gain +2.1 dB against +6.0.
test('stft: frames that start before the input carry its level (mirrored, not silent)', () => {
	let seed = 5, x = new Float32Array(20000).map(() => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5)
	let levels = [], rec = (mag, phase) => { let e = 0; for (let k = 0; k < mag.length; k++) e += mag[k] * mag[k]; levels.push(e); return { mag, phase } }
	stftBatch(x, rec, { fs })
	let steady = levels.slice(8, 20).reduce((a, b) => a + b) / 12
	ok(levels.slice(0, 3).every(e => Math.abs(10 * Math.log10(e / steady)) < 1.5), 'first frames within 1.5 dB of the steady level: ' + levels.slice(0, 3).map(e => (10 * Math.log10(e / steady)).toFixed(1)).join(', '))
})

test('stft — stream ≡ batch across arbitrary chunking', () => {
	let x = sine(330, fs)
	let batch = stftBatch(x, identity, { fs })
	let s = stftStream(identity, { fs })
	let parts = []
	for (let pos = 0, sizes = [64, 1000, 3, 2048, 777]; pos < x.length;) {
		let n = Math.min(sizes[pos % sizes.length] || 512, x.length - pos)
		parts.push(s.write(x.subarray(pos, pos + n))); pos += n
	}
	parts.push(s.flush())
	let cat = new Float32Array(parts.reduce((a, p) => a + p.length, 0)), o = 0
	for (let p of parts) { cat.set(p, o); o += p.length }
	ok(maxDiff(batch, cat) < 1e-6, 'stream matches batch')
})

test('stft — stream holds back under one frame and ends where the input ends', () => {
	// A sample is final once no later frame covers it: the stream emits it then, so a
	// fixed-block host needs at most N − 1 samples of delay, and flush() pads no extra tail
	let x = sine(330, 12345), N = 2048
	let batch = stftBatch(x, identity, { fs })
	let s = stftStream(identity, { fs }), parts = [], out = 0, held = 0
	for (let i = 0; i < x.length; i++) {
		let p = s.write(x.subarray(i, i + 1)); parts.push(p); out += p.length
		held = Math.max(held, i + 1 - out)
	}
	parts.push(s.flush())
	let cat = new Float32Array(parts.reduce((a, p) => a + p.length, 0)), o = 0
	for (let p of parts) { cat.set(p, o); o += p.length }
	ok(held === N - 1, `hold-back ${held} = N − 1`)
	ok(cat.length === x.length, `stream length ${cat.length} = input ${x.length}`)
	ok(maxDiff(batch, cat) < 1e-6, 'stream ≡ batch over the whole signal')
})

// Tail fix regression: frames start at every hop through the last sample, so the
// final N−hop samples keep the steady-state overlap count instead of dying early.
test('stft — tail is reconstructed at full amplitude (OLA tail fix)', () => {
	let x = sine(440, 8192)
	let y = stftBatch(x, identity, { fs })
	ok(maxDiff(x, y, x.length - 1024, x.length) < 1e-4, 'last 1024 samples transparent, got ' + maxDiff(x, y, x.length - 1024, x.length))
})

test('stft: input shorter than one frame comes out whole (was silence, then window-attenuated)', () => {
	let x = sine(440, 700) // < default frameSize 2048
	let y = stftBatch(x, identity, { fs })
	ok(y.length === x.length, 'same length out')
	ok(maxDiff(x, y) < 1e-6, 'sub-frame input transparent, max |Δ| ' + maxDiff(x, y).toExponential(1))
})

test('stft — analyse visits every frame with correct peak bin', () => {
	let x = sine(1000, fs)
	let frames = 0, peakOk = true
	stftAnalyse(x, (mag) => {
		frames++
		let k = mag.indexOf(Math.max(...mag))
		if (Math.abs(k * fs / 2048 - 1000) > fs / 2048) peakOk = false
	}, { fs, frameSize: 2048 })
	ok(frames > 80, `${frames} frames`)
	ok(peakOk, 'peak at 1 kHz per frame')
})


// --- Writing into memory the caller holds: write(chunk, out, length), flush(out) ---

let seeded = s => () => (s = (s * 16807) % 2147483647) / 2147483647
let sameBits = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
let gain = (mag, phase, st, ctx) => { for (let k = 0; k < mag.length; k++) mag[k] *= 0.6 + 0.4 * Math.cos(k / 7 + ctx.pos / 900); return { mag, phase } }
// a floor learnt from the first frames, arrays of its own returned
let learn = (mag, phase, st) => {
	if (!st.n) { st.n = new Float64Array(mag.length); st.m = new Float64Array(mag.length); st.f = 0 }
	if (st.f++ < 4) for (let k = 0; k < mag.length; k++) st.n[k] += mag[k] / 4
	for (let k = 0; k < mag.length; k++) st.m[k] = Math.max(0, mag[k] - 1.5 * st.n[k])
	return { mag: st.m, phase }
}
let cgain = (re, im, st, ctx) => { for (let k = 0; k < re.length; k++) { let g = 0.6 + 0.4 * Math.cos(k / 7 + ctx.pos / 900); re[k] *= g; im[k] *= g } }

// The arrays write(chunk) returns are the reference: 40 frames' signal moves the input down past 2N and the output past
// 8N many times
test('stft: write(chunk, out, length) and flush(out) give the samples write(chunk) and flush() return, call for call, bit for bit', () => {
	let rnd = seeded(11), calls = 0, bad = []
	for (let N of [512, 2048]) for (let hop of [N >> 1, N >> 2, N >> 3, Math.round(N * 0.3)]) for (let [process, complex] of [[gain], [learn], [cgain, true]]) {
		let n = 40 * N + 77, x = Float32Array.from({ length: n }, (_, i) => Math.sin(i * 0.013) + 0.3 * (rnd() - 0.5))
		for (let sizes of [[n], Array.from({ length: 200 }, () => 1 + Math.floor(rnd() * 3000)), Array.from({ length: 300 }, () => 1 + Math.floor(rnd() * 9))]) {
			let opts = { fs, frameSize: N, hopSize: hop, complex }, a = stftStream(process, opts), ref = [], t = 0
			for (let k of sizes) { if (t >= n) break; k = Math.min(k, n - t); ref.push([k, a.write(x.subarray(t, t + k))]); t += k }
			ref.push(['flush', a.flush()], ['flush', a.flush()])
			// the same into an out, every other chunk inside a longer array with its length
			let b = stftStream(process, { ...opts, maxChunk: 3000 }), out = new Float32Array(n + 2 * N), inside = new Float32Array(3100).fill(NaN)
			t = 0
			ref.forEach(([k, want], i) => {
				let got
				if (k === 'flush') got = b.flush(out)
				else if (i % 2) { inside.set(x.subarray(t, t + k)); got = b.write(inside, out, k); t += k }
				else { got = b.write(x.subarray(t, t + k), out); t += k }
				if (got !== want.length || !sameBits(out.subarray(0, got), want)) bad.push(`N ${N} hop ${hop}${complex ? ' complex' : ''}, call ${i}: ${got} samples against ${want.length}`)
				calls++
			})
		}
	}
	ok(!bad.length && calls > 5000, `${calls} calls compared${bad.length ? '; ' + bad.slice(0, 3).join('; ') : ''}`)
})

test('stft: an out too short gives what it holds, the rest waits; flush(out) until 0 gives the tail', () => {
	let rnd = seeded(5), x = Float32Array.from({ length: 30000 }, () => rnd() - 0.5)
	for (let hop of [1024, 512]) {
		let a = stftStream(learn, { fs, hopSize: hop }), b = stftStream(learn, { fs, hopSize: hop }), out = new Float32Array(37), want = [], got = [], over = 0
		for (let t = 0; t < x.length; t += 700) {
			want.push(...a.write(x.subarray(t, t + 700)))
			let k = b.write(x.subarray(t, t + 700), out); if (k > 37) over++
			got.push(...out.subarray(0, k))
		}
		want.push(...a.flush())
		for (let k, g = 0; (k = b.flush(out)) && g < 1e5; g++) got.push(...out.subarray(0, k))
		ok(!over && sameBits(got, want), `hop ${hop}: ${got.length} samples, the arrays' ${want.length}, the same bits`)
	}
})

test('stft: a process may edit mag in place and return nothing, the bits of returning it', () => {
	let x = sine(330, 20000), scale = mag => { for (let k = 0; k < mag.length; k++) mag[k] *= 0.5 + 0.5 * Math.cos(k / 5) }
	let ret = (mag, phase) => (scale(mag), { mag, phase }), none = mag => { scale(mag) }
	let s1 = stftStream(ret, { fs }), s2 = stftStream(none, { fs })
	ok(sameBits(stftBatch(x, ret, { fs }), stftBatch(x, none, { fs })), 'batch')
	ok(sameBits([...s1.write(x), ...s1.flush()], [...s2.write(x), ...s2.flush()]), 'stream')
})

// --- The complex form: the bins themselves, no polar round trip ---

test('stft complex: process edits re, im in place; the stream is the batch under any chunking; an identity returns the input', () => {
	let rnd = seeded(9), x = Float32Array.from({ length: 30000 }, (_, i) => 0.7 * Math.sin(i * 0.02) + 0.2 * (rnd() - 0.5))
	for (let N of [512, 2048]) {
		let opts = { fs, frameSize: N, complex: true }, batch = stftBatch(x, cgain, opts)
		for (let size of [1, 100, 777, 4096]) {
			let s = stftStream(cgain, opts), out = new Float32Array(size + N), got = []
			for (let t = 0; t < x.length; t += size) got.push(...out.subarray(0, s.write(x.subarray(t, t + size), out)))
			got.push(...out.subarray(0, s.flush(out)))
			ok(sameBits(got, batch), `N ${N}, chunks of ${size}: stream = batch`)
		}
		let id = stftBatch(x, () => {}, opts)
		ok(maxDiff(x, id) < 1e-6, `N ${N}: an identity process returns the input, max |Δ| ${maxDiff(x, id).toExponential(1)}`)
	}
})

// The reference is the polar form: magnitude() gives the mag it hands its process, to the bit, so a gain computed from it
// is the same gain; the samples then differ only by the polar round trip (sqrt, atan2, cos, sin), about 1e-16 of a frame
// in float64, which moves a float32 rounding of the output rarely: at most a float32 step or two of the sample
test('stft complex: magnitude(re, im) is the polar form\'s mag to the bit; a gain from it gives the polar form\'s samples within two float32 steps', async () => {
	let { magnitude } = await import('./index.js')
	let rnd = seeded(13), x = Float32Array.from({ length: 40000 }, (_, i) => 0.6 * Math.sin(i * 0.031) + 0.3 * Math.sin(i * 0.17) + 0.1 * (rnd() - 0.5))
	let floor = 0.8, g = m => { let s = m * m / (floor * floor); return s / (1 + s) }
	let mags = [], cmags = []
	let polar = mag => { mags.push(Float64Array.from(mag)); for (let k = 0; k < mag.length; k++) mag[k] *= g(mag[k]) }
	let complex = (re, im) => { let m = magnitude(re, im); cmags.push(m); for (let k = 0; k < re.length; k++) { let gk = g(m[k]); re[k] *= gk; im[k] *= gk } }
	let a = stftBatch(x, polar, { fs }), b = stftBatch(x, complex, { fs, complex: true })
	ok(mags.length === cmags.length && mags.every((m, i) => sameBits(m, cmags[i])), `${mags.length} frames: the same magnitudes`)
	let worst = 0
	for (let i = 0; i < a.length; i++) { let step = 2 ** (Math.floor(Math.log2(Math.max(Math.abs(a[i]), 2 ** -126))) - 23); worst = Math.max(worst, Math.abs(a[i] - b[i]) / step) }
	ok(worst <= 2, `the largest difference ${worst} float32 steps of its sample`)
})

// The validator's measure (@audio/compile tools/verify.js, `young`): in a child Node with its flags, a case a child as it runs a
// processor a child, the bytes V8's young generation takes in over 2^15 warm calls, read in two forced minor collections,
// the lesser of two runs
let ALLOC_CHILD = `
import v8 from 'node:v8'
let { stftStream } = await import(${JSON.stringify(new URL('./index.js', import.meta.url).href)})
let minor = { type: 'minor' }, young = s => s.reduce((a, x) => x.spaceName === 'new_space' || x.spaceName === 'new_large_object_space' ? a + x.spaceUsedSize : a, 0)
let count = f => { let p = new v8.GCProfiler(); p.start(); gc(minor); f(); gc(minor); let g = p.stop().statistics, y = 0; for (let i = 1; i < g.length; i++) y += young(g[i].beforeGC.heapSpaceStatistics) - young(g[i - 1].afterGC.heapSpaceStatistics); return y }
let N = 1024, half = N >> 1, F = 64, CALLS = 1 << 15, gain = Float64Array.from({ length: half + 1 }, (_, k) => 0.5 + 0.5 * Math.cos(k / 9))
// callbacks that allocate nothing: a result made once, its fields set; in place
let res = { mag: null, phase: null }
let polar = (mag, phase) => { for (let k = 0; k <= half; k++) mag[k] *= gain[k]; res.mag = mag; res.phase = phase; return res }
let complex = (re, im) => { for (let k = 0; k <= half; k++) { re[k] *= gain[k]; im[k] *= gain[k] } }
let x = Float32Array.from({ length: 64 * F }, (_, i) => Math.sin(i * 0.01) + 0.1 * Math.sin(i * 1.3))
let chunks = Array.from({ length: 64 }, (_, k) => x.subarray(k * F, k * F + F)), out = new Float32Array(F + N)
let per = make => { let w = make(), run = n => { for (let i = 0; i < n; i++) w(chunks[i & 63]) }; run(1 << 13); run(1 << 13); return Math.min(count(() => run(CALLS)), count(() => run(CALLS))) / CALLS }
let one = (process, opts) => { let s = stftStream(process, { frameSize: N, maxChunk: F, ...opts }); return c => s.write(c, out) }
let cases = {
	'polar': () => per(() => one(polar, {})),
	'complex': () => per(() => one(complex, { complex: true })),
	// eight streams of the code, as a manifest keeps one a channel
	'eight streams': () => per(() => { let s = Array.from({ length: 8 }, () => one(polar, {})); return c => { for (let k = 0; k < 8; k++) s[k](c) } }),
	// frame and hop as a caller's arithmetic leaves them, heap numbers (2 ** k, N / 4: denoise's frame(fs) is 2 ** k)
	'frame and hop as heap numbers': () => per(() => { let H = 2 ** Math.round(Math.log2(N)); return one(polar, { frameSize: H, hopSize: H / 4 }) }),
	'control, write(chunk): new arrays': () => per(() => { let s = stftStream(polar, { frameSize: N }); return c => s.write(c) }),
}
let name = process.argv[1]
console.log(JSON.stringify(name ? cases[name]() : Object.keys(cases)))
`
test('stft: write(chunk, out) allocates nothing a call in the steady state, polar, complex, eight streams, sizes given as heap numbers', async () => {
	let { default: v8 } = await import('node:v8')
	if (!v8.GCProfiler) return console.warn(`skipped: Node ${process.version} has no v8.GCProfiler to count with (18.15 and later have it)`)
	let { execFileSync } = await import('node:child_process')
	let child = (...a) => JSON.parse(execFileSync(process.execPath, ['--expose-gc', '--no-concurrent-recompilation', '--no-allocation-site-pretenuring', '--input-type=module', '-e', ALLOC_CHILD, ...a], { encoding: 'utf8' }))
	for (let k of child()) {
		let b = child(k)
		ok(k.startsWith('control') ? b > 1 : b <= 1 / 16, `${k}: ${+b.toPrecision(3)} bytes a call${k.startsWith('control') ? ' (the measure sees the arrays)' : ' (at most 1/16)'}`)
	}
})
