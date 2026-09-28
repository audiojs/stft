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

