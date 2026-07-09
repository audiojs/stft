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

