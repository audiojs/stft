import test, { almost, ok, is } from 'tst'
import { stftBatch, stftStream, stftAnalyse, hannWindow } from '@audio/stft'
import window, { apply, cola, hann } from '@audio/window'
import * as bq from '@audio/biquad'
import { lowpass as dfLowpass, highpass as dfHighpass, peaking as dfPeaking } from 'digital-filter/iir/biquad.js'

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
	ok(maxDiff(x, y, 2048, x.length - 2048) < 1e-6, 'batch roundtrip')
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
	ok(maxDiff(batch, cat, 2048, batch.length - 2048) < 1e-6, 'stream matches batch')
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

test('window — periodic hann COLA at N/2 and N/4 hops; symmetric differs', () => {
	let w = window('hann', 1024)
	ok(cola(w, 512).ok, 'hop N/2 COLA')
	ok(cola(w, 256).ok, 'hop N/4 COLA')
	let sym = window('hann', 1024, { periodic: false })
	ok(!cola(sym, 512).ok, 'symmetric hann is not COLA at N/2')
	almost(w[0], 0, 1e-12)
	ok(Math.abs(sym[0] - sym[1023]) < 1e-12, 'symmetric endpoints match')
	// consistency with the ecosystem's internal hannWindow
	let hw = hannWindow(1024)
	ok(maxDiff(w, hw) < 1e-12, 'matches @audio/stft hannWindow')
})

test('window — apply, unknown name throws, re-exports window-function', () => {
	let d = Float64Array.from([1, 1, 1, 1])
	apply(d, Float64Array.from([0.5, 1, 0.5, 1]))
	almost(d[0], 0.5, 1e-12)
	let threw = false
	try { window('nosuch', 64) } catch { threw = true }
	ok(threw)
	is(typeof hann, 'function')
})

test('biquad — differential vs digital-filter (scijs reference) <1e-9', () => {
	for (let [mine, ref, args] of [
		[bq.lowpass, dfLowpass, [1000, 0.707, fs]],
		[bq.highpass, dfHighpass, [500, 1.2, fs]],
	]) {
		let a = mine(...args), b = ref(...args)
		for (let k of ['b0', 'b1', 'b2', 'a1', 'a2']) almost(a[k], b[k], 1e-9, `${k}`)
	}
	let p = bq.peaking(2000, 1, fs, 6), pr = dfPeaking(2000, 1, fs, 6)
	for (let k of ['b0', 'b1', 'b2', 'a1', 'a2']) almost(p[k], pr[k], 1e-9)
})

test('biquad — magnitude responses honor the spec', () => {
	let lp = bq.lowpass(1000, Math.SQRT1_2, fs)
	almost(bq.magnitude(lp, 1000, fs), Math.SQRT1_2, 0.01, '−3 dB at cutoff')
	ok(bq.magnitude(lp, 100, fs) > 0.99, 'passband flat')
	ok(bq.magnitude(lp, 10000, fs) < 0.02, 'stopband −34 dB+')
	let pk = bq.peaking(2000, 1, fs, 6)
	almost(20 * Math.log10(bq.magnitude(pk, 2000, fs)), 6, 0.05, '+6 dB at center')
	let ap = bq.allpass(3000, 0.707, fs)
	almost(bq.magnitude(ap, 500, fs), 1, 1e-6)
	almost(bq.magnitude(ap, 8000, fs), 1, 1e-6)
})

test('biquad — stateful chunked processing ≡ one pass', () => {
	let c = bq.lowpass(2000, 0.707, fs)
	let x = sine(440, 8192)
	let whole = bq.process(Float32Array.from(x), c)
	let chunked = Float32Array.from(x)
	let s = bq.state()
	for (let pos = 0; pos < chunked.length; pos += 555) bq.process(chunked.subarray(pos, Math.min(pos + 555, chunked.length)), c, s)
	ok(maxDiff(whole, chunked) < 1e-12, 'state carries across chunks')
})
