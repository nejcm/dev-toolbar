import { ensureStyleSheet } from "../runtime";

/** Create a document-aware, nonce-aware stylesheet injector for one entry. */
export function createStyleInjector(
  entry: string,
  css: string,
): (doc?: Document, nonce?: string) => HTMLStyleElement | null {
  return (doc, nonce) => ensureStyleSheet(entry, css, doc, nonce);
}
