# @audio/primitives

> Workspace for the shared primitives `@audio/stft`, `@audio/window`, `@audio/biquad`. All planned.

Today each family carries its own copy (deliberately, until these publish):

| Primitive | Current copies (dedupe sources) |
|---|---|
| `@audio/stft` | `denoise/packages/denoise-core/stft.js` (canonical: batch/stream/analyse), `shift`/`stretch` core STFTs |
| `@audio/window` | `window-function` (scijs — stays), `denoise-core/util.js` hannWindow |
| `@audio/biquad` | `dynamics-core/biquad.js`, `@audio/filter-biquad`, `digital-filter/iir/biquad` (scijs — stays) |

Once published, family cores swap their local copies for these — behind differential tests, per the audio-module migration plan.
