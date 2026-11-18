export interface StftOptions {
  frameSize?: number; hopSize?: number; fs?: number
  /** process(re, im, state, ctx) on the complex bins, edited in place: no polar round trip. */
  complex?: boolean
  /** The longest chunk write is given (default frameSize): the stream's memory is made for it up front, a longer chunk grows it once. */
  maxChunk?: number
}
export interface StftContext {
  hop: number; half: number; N: number; fs: number
  /** Radians per bin, 2π/N. */
  freqPerBin: number
  /** The frame's first sample in the input: hop − N for the first frame (before the input it reads the input's mirror image), then every hop. */
  pos: number
}
export interface Spectrum { mag: ArrayLike<number>; phase: ArrayLike<number> }
/** State starts empty and persists for the duration of one batch/stream. Returns nothing when it edited mag and phase in place. */
export type SpectralProcessor = (mag: Float64Array, phase: Float64Array, state: Record<string, unknown>, ctx: StftContext) => Spectrum | void
/** With complex: the bins themselves, edited in place (nothing returned), or arrays of its own returned. */
export type ComplexProcessor = (re: Float64Array, im: Float64Array, state: Record<string, unknown>, ctx: StftContext) => { re: ArrayLike<number>; im: ArrayLike<number> } | void
export interface StftStream {
  /** The samples now final, in a new array. */
  write(chunk: ArrayLike<number>): Float32Array
  /** The samples now final into out from its start, as many as it holds (the rest waits for the next call): how many. length: the samples taken from the chunk's start. */
  write(chunk: ArrayLike<number>, out: Float32Array | Float64Array, length?: number): number
  flush(): Float32Array
  flush(out: Float32Array | Float64Array): number
}
export function stftBatch(data: ArrayLike<number>, process: SpectralProcessor, options?: StftOptions & { complex?: false }): Float32Array
export function stftBatch(data: ArrayLike<number>, process: ComplexProcessor, options: StftOptions & { complex: true }): Float32Array
export function stftStream(process: SpectralProcessor, options?: StftOptions & { complex?: false }): StftStream
export function stftStream(process: ComplexProcessor, options: StftOptions & { complex: true }): StftStream
/** Visits complete frames only; pos is the frame's sample offset. */
export function stftAnalyse(data: ArrayLike<number>, visit: (mag: Float64Array, phase: Float64Array, pos: number) => void, options?: StftOptions): void
export function wrapPhase(phase: number): number
/** Returns a cached periodic Hann window. */
export function hannWindow(length: number): Float64Array
export function normFloor(win: ArrayLike<number>, hop: number): number
/** Each bin's |X| into out (a new array when omitted): the polar form's mag, to the bit. */
export function magnitude(re: ArrayLike<number>, im: ArrayLike<number>, out?: Float64Array): Float64Array
export const PI2: number
