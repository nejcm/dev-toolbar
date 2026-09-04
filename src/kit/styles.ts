import { ensureStyleSheet } from "../runtime";
import { KIT_CSS } from "./css";

/** Create a document-aware, nonce-aware stylesheet injector for one entry. */
export function createStyleInjector(
  entry: string,
  css: string,
): (doc?: Document, nonce?: string) => HTMLStyleElement | null {
  return (doc, nonce) => ensureStyleSheet(entry, css, doc, nonce);
}

export const ensureKitStyles = createStyleInjector("kit", KIT_CSS);
