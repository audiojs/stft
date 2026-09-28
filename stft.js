// One canonical STFT for the @audio ecosystem — batch / stream / analyse.
// process(mag, phase, state, ctx) → { mag, phase } per frame; Hann analysis+synthesis
// windows, correctly normalized overlap-add, stream ≡ batch under any chunking.
// ctx.pos: the frame's first sample in the input, hop − N for the first frame (which reads the input's
// mirror image before its start), then every hop.
// Extracted verbatim from @audio/denoise-core (differential-tested there since wave 1).
//
// Two flavours:
//   stftBatch — process whole signal, return Float32Array
//   stftStream — write(chunk) / write() pull-based wrapper for real-time

import { fft, ifft } from 'fourier-transform'
import { hannWindow, makeStreamBufs, appendIn, growOut, compactIn, take, normFloor, PI2 } from './util.js'

export function wrapPhase(p) { return p - Math.floor(p / PI2 + 0.5) * PI2 }  // floor(x + 0.5) rounds like Math.round here, several times faster in V8 (hot: per bin per frame)

function frame(data, pos, win, half, process, state, ctx, sc) {
  let N = win.length, f = sc.f
  // before the input, its mirror image (x[-k] = x[k], numpy's 'reflect'): frames that start early carry the
  // signal's own level and spectrum, so processes that learn from the first frames (a noise profile) learn the
  // signal, not silence
  for (let i = 0; i < N; i++) { let j = pos + i; f[i] = (data[j < 0 ? -j : j] || 0) * win[i] }

  let [re, im] = fft(f)
  let mag = sc.mag, phase = sc.phase
  for (let k = 0; k <= half; k++) {
    mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k])
    phase[k] = Math.atan2(im[k], re[k])
  }

  let r = process(mag, phase, state, ctx)
  let r2 = sc.r2, i2 = sc.i2
  for (let k = 0; k <= half; k++) {
    r2[k] = r.mag[k] * Math.cos(r.phase[k])
    i2[k] = r.mag[k] * Math.sin(r.phase[k])
  }
  return ifft(r2, i2)
}

function scratch(N, half) {
  return {
    f: new Float64Array(N),
    mag: new Float64Array(half + 1),
    phase: new Float64Array(half + 1),
    r2: new Float64Array(half + 1),
    i2: new Float64Array(half + 1)
  }
}

export function stftBatch(data, process, opts) {
  let N = opts?.frameSize || 2048
  let hop = opts?.hopSize || (N >> 2)
  let half = N >> 1
  let win = hannWindow(N)
  let ctx = { hop, half, N, fs: opts?.fs || 44100, freqPerBin: PI2 / N }

  let outLen = data.length
  let out = new Float32Array(outLen)
  let norm = new Float32Array(outLen)
  let state = {}
  let sc = scratch(N, half)
  // Frames on the hop grid from the first one that reaches sample 0 (it starts N − hop before it, over the
  // input's mirror image) to the last sample: every sample keeps the steady-state overlap count at both ends. Starting at
  // 0, the first N − hop samples had fewer frames under the normalization floor: a fade-in, -52 dB over the
  // first 5 ms at N = 2048, -8 dB still at 10–20 ms. The tail likewise: bounding by `pos + N <= outLen`
  // stopped N − hop samples early and dropped inputs shorter than N.
  let pos = hop - N

  while (pos < outLen) {
    ctx.pos = pos
    let sf = frame(data, pos, win, half, process, state, ctx, sc)
    for (let i = Math.max(0, -pos); i < N && pos + i < outLen; i++) {
      out[pos + i] += sf[i] * win[i]
      norm[pos + i] += win[i] * win[i]
    }
    pos += hop
  }

  let nf = normFloor(win, hop)
  for (let i = 0; i < outLen; i++) {
    let n = Math.max(norm[i], nf)
    if (n > 1e-8) out[i] /= n
  }
  return out
}

export function stftStream(process, opts) {
  let N = opts?.frameSize || 2048
  let hop = opts?.hopSize || (N >> 2)
  let half = N >> 1
  let win = hannWindow(N)
  let ctx = { hop, half, N, fs: opts?.fs || 44100, freqPerBin: PI2 / N }
  let state = {}, sc = scratch(N, half)
  let nf = normFloor(win, hop)

  // the first frame starts N − hop before the input, as in stftBatch: the input buffer starts with those
  // N − hop samples, the input's mirror image (written once N − hop + 1 samples have come, frames wait for it),
  // and the output skips them; the grid stays on the hop, so the hold-back stays under a frame
  let P = N - hop, st = makeStreamBufs(N, nf)
  st.il = st.oread = P
  let aPos = 0, flushed = false, fed = 0, sent = 0, mirrored = false
  ctx.pos = hop - N

  function mirror() {
    for (let k = 1; k <= P; k++) st.ib[P - k] = P + k < st.il ? st.ib[P + k] : 0
    mirrored = true
  }

  function run() {
    if (!mirrored) { if (fed <= P && !flushed) return; mirror() }
    while (aPos + N <= st.il) {
      let sf = frame(st.ib, aPos, win, half, process, state, ctx, sc)
      ctx.pos += hop
      growOut(st, st.pos + N)
      let ob = st.ob, nb = st.nb, base = st.pos
      for (let i = 0; i < N; i++) {
        ob[base + i] += sf[i] * win[i]
        nb[base + i] += win[i] * win[i]
      }
      st.hi = Math.max(st.hi, st.pos + N)
      aPos += hop
      st.pos += hop
    }
    if (aPos > N * 2) { compactIn(st, aPos - N); aPos -= aPos - N }
  }

  return {
    write(chunk) {
      appendIn(st, chunk); fed += chunk.length; run()
      // samples below pos are final: every later frame starts at pos or beyond, so
      // emitting them now bounds the hold-back at N − 1 (a frame must fill first)
      let out = take(st, st.pos)
      sent += out.length
      return out
    },
    flush() {
      if (!flushed) { if (!mirrored) mirror(); appendIn(st, new Float32Array(N)); flushed = true }
      run()
      // the padding frames run past the input by up to a hop: stop where the input
      // stopped, so the stream's total length equals the batch's
      let out = take(st, st.pos).subarray(0, Math.max(0, fed - sent))
      sent += out.length
      return out
    }
  }
}

// Analysis-only sweep — visit every frame's magnitude+phase but produce no output.
// Used by VAD, noise-profile estimators, dereverb late-tail estimation.
export function stftAnalyse(data, visit, opts) {
  let N = opts?.frameSize || 2048
  let hop = opts?.hopSize || (N >> 2)
  let half = N >> 1
  let win = hannWindow(N)
  let f = new Float64Array(N)
  let mag = new Float64Array(half + 1), phase = new Float64Array(half + 1)

  for (let pos = 0; pos + N <= data.length; pos += hop) {
    for (let i = 0; i < N; i++) f[i] = data[pos + i] * win[i]
    let [re, im] = fft(f)
    for (let k = 0; k <= half; k++) {
      mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k])
      phase[k] = Math.atan2(im[k], re[k])
    }
    visit(mag, phase, pos)
  }
}
