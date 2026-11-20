export function createId(): string {
  const time = Date.now().toString(36).padStart(9, "0").slice(-9);
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  let random = "";
  for (const byte of bytes) random += (byte % 36).toString(36);
  return `c${time}${random}`;
}
