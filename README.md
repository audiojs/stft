# @audio/primitives

> Shared primitives `@audio/stft`, `@audio/window`, `@audio/biquad` — published.

Today each family carries its own copy (deliberately, until these publish):

| Primitive | Current copies (dedupe sources) |
|---|---|
| `@audio/stft` | `denoise/packages/denoise-core/stft.js` (canonical: batch/stream/analyse), `shift`/`stretch` core STFTs |
| `@audio/window` | `window-function` (scijs — stays), `denoise-core/util.js` hannWindow |
| `@audio/biquad` | `dynamics-core/biquad.js`, `@audio/filter-biquad`, `digital-filter/iir/biquad` (scijs — stays) |

Family cores can now swap their local copies for these — behind differential tests, per the audio-module migration plan (`@audio/biquad` is differential-tested against digital-filter; `@audio/stft` is the denoise-core implementation verbatim, including the ring-compaction fix both share).
