# stft

> Canonical STFT + window for the `@audio` ecosystem — [`@audio/stft`](packages/stft), [`@audio/window`](packages/window).

| Package | What |
|---|---|
| [`@audio/stft`](packages/stft) | Canonical STFT — batch / stream / analyse with normalized Hann OLA; stream ≡ batch under any chunking (includes the ring-compaction fix shared with `denoise-core`) |
| [`@audio/window`](packages/window) | Audio-facing window kit — typed periodic/symmetric fills, apply, COLA check over [`window-function`](https://github.com/scijs/window-function) (scijs — stays) |

Dedupe targets: `denoise/packages/denoise-core/stft.js` (canonical source, extracted verbatim), `shift`/`stretch` core STFTs, `denoise-core/util.js` hannWindow — family cores swap their local copies for these behind differential tests.

The biquad kernel lives with the filters: [`@audio/biquad`](https://github.com/audiojs/filter/tree/main/packages/biquad).

## License

MIT
