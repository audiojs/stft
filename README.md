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

Also exports `wrapPhase`, `hannWindow` (periodic Hann, from [`window-function`](https://github.com/scijs/window-function)), `normFloor`, `PI2`.

## See also

- [`@audio/window`](https://github.com/audiojs/window) — audio-facing window kit (fills, apply, COLA check)
- [`fourier-transform`](https://github.com/scijs/fourier-transform) — the FFT underneath (scijs layer)

## License

MIT
