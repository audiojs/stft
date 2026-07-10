// Internal — Hann window (via @audio/window) + stream ring buffers + OLA normalization.

import window from '@audio/window'

export const PI2 = Math.PI * 2


let _hannCache = new Map()
export function hannWindow(N) {
  let w = _hannCache.get(N)
  if (w) return w
  w = window('hann', N, { periodic: true })
  _hannCache.set(N, w)
  return w
}

export function makeStreamBufs(N, nf = 0) {
  return {
    N, nf,
    ib: new Float32Array(N * 4), il: 0,
    ob: new Float32Array(N * 8), nb: new Float32Array(N * 8),
    pos: 0, oread: 0, hi: 0
  }
}

export function appendIn(st, chunk) {
  let need = st.il + chunk.length
  if (need > st.ib.length) {
    let b = new Float32Array(Math.max(need * 2, st.ib.length * 2))
    b.set(st.ib.subarray(0, st.il)); st.ib = b
  }
  st.ib.set(chunk, st.il); st.il += chunk.length
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

export function take(st, upTo) {
  upTo = Math.min(upTo, st.pos)
  if (upTo <= st.oread) return new Float32Array(0)
  let len = Math.floor(upTo - st.oread)
  let out = new Float32Array(len)
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
