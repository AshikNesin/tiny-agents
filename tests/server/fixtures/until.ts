/**
 * Poll until `check` yields something truthy (returned), or fail after `ms`
 * naming `what`. For the real runtime's asynchronous replies and settles.
 */
export async function until<T>(
  check: () => T | false | undefined | null | Promise<T | false | undefined | null>,
  what = "the condition",
  ms = 8_000,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}
