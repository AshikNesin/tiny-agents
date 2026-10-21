/**
 * Chrome will not draw a window narrower than this many CSS pixels. A viewer
 * narrower than that (a small panel, a phone) would show the window cropped
 * on the right.
 */
export const MIN_REMOTE_WIDTH = 500;

/**
 * The size, in CSS pixels, of the remote window for a viewer box. A box that
 * is wide enough gets its own size. A narrower one gets a window of the
 * minimum width and the same shape, which the viewer scales down to fit.
 */
export function remoteWindowSize(width: number, height: number): { width: number; height: number } {
  if (!(width > 0 && height > 0) || width >= MIN_REMOTE_WIDTH) return { width, height };
  return { width: MIN_REMOTE_WIDTH, height: height * (MIN_REMOTE_WIDTH / width) };
}
