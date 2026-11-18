// Internal — Hann window + stream ring buffers + OLA normalization; |X| of complex bins.

import hann from 'window-function/hann'

export const PI2 = Math.PI * 2


// Periodic (DFT-even) Hann: the N+1-point window without its last point. The one window, not the whole kit.
let _hannCache = new Map()
export function hannWindow(N) {
  let w = _hannCache.get(N)
  if (w) return w
  w = new Float64Array(N)
  for (let i = 0; i < N; i++) w[i] = hann(i, N + 1)
  _hannCache.set(N, w)
  return w
}

// Sized for chunks up to maxChunk, so a write never grows them: the input kept is under 3N before a chunk (frames
// wait for N, the buffer moves down past 2N), and the output from the last sample taken (moved down past 8N) reaches
// a chunk's frames plus one frame past that; a flush adds N. A longer chunk grows them once
export function makeStreamBufs(N, nf = 0, maxChunk = N) {
  let L = Math.max(N, maxChunk)
  return {
    N, nf,
    ib: new Float32Array(3 * N + L), il: 0,
    ob: new Float32Array(9 * N + L), nb: new Float32Array(9 * N + L),
    pos: 0, oread: 0, hi: 0
  }
}

// `len` samples of chunk (all of it by default) after the input
export function appendIn(st, chunk, len = chunk.length) {
  let need = st.il + len
  if (need > st.ib.length) {
    let b = new Float32Array(Math.max(need * 2, st.ib.length * 2))
    b.set(st.ib.subarray(0, st.il)); st.ib = b
  }
  if (len === chunk.length) st.ib.set(chunk, st.il)
  else for (let i = 0; i < len; i++) st.ib[st.il + i] = chunk[i]   // a loop: a subarray to set from is an allocation
  st.il += len
}

// n zeros after the input (a flush's padding), in place of a chunk of them made for it
export function appendZeros(st, n) {
  if (st.il + n > st.ib.length) appendIn(st, new Float32Array(n))
  else { st.ib.fill(0, st.il, st.il + n); st.il += n }
}

export function growOut(st, need) {
  if (need <= st.ob.length) return
  let len = Math.max(need * 2, st.ob.length * 2)
  let o = new Float32Array(len), n = new Float32Array(len)
  o.set(st.ob); n.set(st.nb); st.ob = o; st.nb = n
}

export function compactIn(st, trim) {
  if (trim <= 0) return
  st.ib.copyWithin(0, trim, st.il); st.il -= trim
}

// The final samples up to upTo, in a new array
export function take(st, upTo) {
  upTo = Math.min(upTo, st.pos)
  if (upTo <= st.oread) return new Float32Array(0)
  let out = new Float32Array(Math.floor(upTo - st.oread))
  read(st, out, out.length)
  return out
}

// The final samples up to upTo into out from its start, as many as it holds: how many (the rest waits for the next)
export function takeInto(st, upTo, out) {
  upTo = Math.min(upTo, st.pos)
  let len = upTo > st.oread ? Math.min(Math.floor(upTo - st.oread), out.length) : 0
  read(st, out, len)
  return len
}

function read(st, out, len) {
  for (let i = 0; i < len; i++) {
    let j = st.oread + i, n = st.nf > 0 ? Math.max(st.nb[j], st.nf) : st.nb[j]
    out[i] = n > 1e-8 ? st.ob[j] / n : 0
  }
  st.oread += len
  if (st.oread > st.N * 8) {
    // shift left; zero only past the high-water mark — frames extend N−hop beyond
    // pos, so zeroing from pos would erase the last frame's partial overlap-add tail
    st.ob.copyWithin(0, st.oread); st.nb.copyWithin(0, st.oread)
    st.pos -= st.oread; st.hi = Math.max(0, st.hi - st.oread); st.oread = 0
    st.ob.fill(0, st.hi); st.nb.fill(0, st.hi)
  }
}

// Each bin's magnitude |X| into out (a new array when omitted): the expression the polar form's mag is, so a gain
// computed from it is the polar form's gain to the bit
export function magnitude(re, im, out = new Float64Array(re.length)) {
  for (let k = 0; k < re.length; k++) out[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k])
  return out
}

export function normFloor(win, hop) {
  let N = win.length, min = Infinity
  for (let i = 0; i < hop; i++) {
    let s = 0
    for (let j = i; j < N; j += hop) s += win[j] * win[j]
    if (s > 0 && s < min) min = s
  }
  return min === Infinity ? 0 : min
}
