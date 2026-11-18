# @audio/stft

Try it in the browser: [Spectrogram](https://audiojs.dev/util/spectrogram/). Runs on this package, nothing is uploaded.

> Canonical STFT for the `@audio` ecosystem — batch / stream / analyse, stream ≡ batch under any chunking.

Hann analysis + synthesis windows with correctly normalized overlap-add. Frames run on the hop grid from the one that starts N − hop before the input to the last sample, so every sample, the first and the last included, has the full overlap: an identity process returns the input exactly. Before the input, frames see its mirror image (numpy's `reflect`), so a process that learns from the first frames meets the signal's level. `ctx.pos` gives each frame's first input sample (negative for those early frames). Extracted verbatim from `@audio/denoise-core` (differential-tested there since wave 1), including the shared stream ring-compaction fix.

```js
import { stftBatch, stftStream, stftAnalyse } from '@audio/stft'

// process(mag, phase, state, ctx) → { mag, phase }, called per frame
const identity = (mag, phase) => ({ mag, phase })

// batch — whole signal in, Float32Array out
let out = stftBatch(input, identity, { fs: 44100, frameSize: 2048, hopSize: 512 })

// stream — real-time chunks; identical output to batch for any chunk sizes
let s = stftStream(identity, { fs: 44100 })
let piece = s.write(chunk)   // returns processed samples as they become available
let tail = s.flush()

// analyse — visit magnitude/phase frames without resynthesis
stftAnalyse(input, (mag, phase, ctx) => { /* inspect */ }, { fs: 44100 })
```

A process may also edit `mag` and `phase` in place and return nothing.

**Complex bins.** With `complex: true`, `process(re, im, state, ctx)` gets the bins themselves and edits them in place (or returns `{ re, im }`): no polar round trip, the `sqrt`, `atan2`, `cos` and `sin` of every bin of every frame. `magnitude(re, im, out)` gives |X|, the expression the polar form's `mag` is, so a gain computed from it is the polar form's gain to the bit. With a Wiener-like gain from |X|, the complex stream takes 0.47 of the polar stream's time at N = 2048 and 0.46 at N = 512 (31 interleaved pairs, thread CPU time, Node 25, Apple M4 Max). Its samples are the polar form's but for a rare one a float32 step off: the round trip's rounding is about 1e-16 of a frame in float64 (none differed in 34.6 million samples compared, 48 kHz, N = 512 to 2048).

```js
const mag = new Float64Array(1025)   // noise: the noise power of each bin
const wiener = (re, im, state, ctx) => {
  magnitude(re, im, mag)
  for (let k = 0; k < re.length; k++) { let s = mag[k] ** 2 / noise[k], g = s / (1 + s); re[k] *= g; im[k] *= g }
}
let s = stftStream(wiener, { fs: 48000, frameSize: 2048, complex: true })
```

**Real time, nothing allocated.** `write(chunk, out, length)` writes the samples now final into `out` from its start instead of returning a new array, and returns how many; `flush(out)` likewise: into a `Float32Array` and with a whole `hopSize`, the same bits as the arrays, call for call (a `Float64Array` takes each sample before its rounding to float32). `out` takes as many as it holds, the rest waits for the next call. `length`: the samples taken from the chunk's start, when the chunk is a longer array. `maxChunk` (default `frameSize`) is the longest chunk: the stream's memory is made for it when the stream is made, so a loop of such chunks allocates nothing (a longer chunk grows it once, and costs the engine a recompile: 12 MB on Node 25; frames of 16384 and up allocate 2 bytes a call on Node 20). A write gives at most `maxChunk + hopSize − 1` samples and a flush at most `frameSize − 1`: an `out` of the larger holds every call.

```js
let s = stftStream(process, { fs: 48000, frameSize: 2048, hopSize: 512, maxChunk: 128 })
let out = new Float32Array(Math.max(128 + 512 - 1, 2048 - 1))
let n = s.write(block, out)   // out[0..n): the samples now final
```

Also exports `wrapPhase`, `hannWindow` (periodic Hann, from [`window-function`](https://github.com/scijs/window-function)), `normFloor`, `magnitude`, `PI2`.

## See also

- [`@audio/window`](https://github.com/audiojs/window) — audio-facing window kit (fills, apply, COLA check)
- [`fourier-transform`](https://github.com/scijs/fourier-transform) — the FFT underneath (scijs layer)

## License

MIT
