export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const hinted = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
    ?.platform;
  return /mac|iphone|ipad|ipod/i.test(hinted || navigator.platform || navigator.userAgent);
}
