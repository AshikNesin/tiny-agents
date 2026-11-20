export const MIN_REMOTE_WIDTH = 500;

export function remoteWindowSize(width: number, height: number): { width: number; height: number } {
  if (!(width > 0 && height > 0) || width >= MIN_REMOTE_WIDTH) return { width, height };
  return { width: MIN_REMOTE_WIDTH, height: height * (MIN_REMOTE_WIDTH / width) };
}
