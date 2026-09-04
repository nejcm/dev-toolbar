/**
 * Resolve the nonce for an extension surface. The factory option wins, while
 * an empty option defers to the host slot so it cannot blank the host's nonce.
 */
export function resolveStyleNonce(
  option: string | undefined,
  slot: string | undefined,
): string | undefined {
  return option || slot;
}
