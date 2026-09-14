export interface StftOptions { frameSize?: number; hopSize?: number; fs?: number }
export interface StftContext {
  hop: number; half: number; N: number; fs: number
  /** Radians per bin, 2π/N. */
  freqPerBin: number
}
export interface Spectrum { mag: ArrayLike<number>; phase: ArrayLike<number> }
/** State starts empty and persists for the duration of one batch/stream. */
export type SpectralProcessor = (mag: Float64Array, phase: Float64Array, state: Record<string, unknown>, ctx: StftContext) => Spectrum
export function stftBatch(data: ArrayLike<number>, process: SpectralProcessor, options?: StftOptions): Float32Array
export function stftStream(process: SpectralProcessor, options?: StftOptions): {
  write(chunk: ArrayLike<number>): Float32Array
  flush(): Float32Array
}
/** Visits complete frames only; pos is the frame's sample offset. */
export function stftAnalyse(data: ArrayLike<number>, visit: (mag: Float64Array, phase: Float64Array, pos: number) => void, options?: StftOptions): void
export function wrapPhase(phase: number): number
/** Returns a cached periodic Hann window. */
export function hannWindow(length: number): Float64Array
export function normFloor(win: ArrayLike<number>, hop: number): number
export const PI2: number
