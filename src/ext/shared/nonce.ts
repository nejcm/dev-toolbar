/**
 * The one CSP-nonce resolution rule the first-party extensions share.
 *
 * Internal, like the rest of `src/ext/shared`: not a published subpath, inlined
 * into every `dist/ext/*.cjs` by the non-code-splitting CJS build, so it stays
 * tiny, stateless and marker-free — see `./hooks.ts` for the full directory
 * rules and `src/core/__tests__/boundary.test.ts` for what enforces them.
 */

/**
 * Resolve the `styleNonce` an extension surface should inject with: the
 * factory option wins over the nonce core forwards on the slot prop, an empty
 * option string defers to the slot (so `styleNonce: ""` is not a way to blank
 * out the host's nonce), and the result is `undefined` when neither is set.
 * Every slot in all seven first-party factories states the policy by calling
 * this rather than repeating the expression.
 */
export function resolveStyleNonce(
  option: string | undefined,
  slot: string | undefined,
): string | undefined {
  return option || slot;
}
