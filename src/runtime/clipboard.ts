/**
 * Write text to the clipboard, honestly. [dev-toolbar/runtime]
 *
 * Centralises what several extensions used to hand-roll: feature-detect
 * `navigator.clipboard.writeText`, call it, map the outcome to a status.
 *
 * - A missing API and a rejected write are the same answer to the caller —
 *   `navigator.clipboard` is undefined on an insecure origin and in tests,
 *   and `writeText` rejects when unfocused or permission is denied; either
 *   way nothing reached the clipboard.
 * - It never throws: these run from click handlers, where a synchronous
 *   throw would break the panel rather than just fail the copy.
 * - It resolves `false` rather than pretending — a "Copied" badge over an
 *   empty clipboard is a lie.
 *
 * No fallback to `document.execCommand("copy")`: it needs a live selection
 * in a temporary node (mutating the host document) and is deprecated
 * everywhere it still works. Reporting "clipboard unavailable" is the
 * honest degradation.
 */

interface ClipboardLike {
  writeText?: (text: string) => Promise<void>;
}

/**
 * The command-shaped wrapper.
 *
 * A panel button has somewhere to show "clipboard unavailable"; an
 * aggregated `ToolbarCommand` doesn't (it returns `void`), and the command
 * palette reports failure by catching a throw. So this throws deliberately,
 * rather than silently resolving while the palette closes as if it worked.
 */
export async function writeClipboardTextOrThrow(
  text: string,
  hint = "Copy it from the panel by hand.",
): Promise<void> {
  if (await writeClipboardText(text)) return;
  throw new Error(`The clipboard is unavailable. ${hint}`);
}

/**
 * @returns `true` only when the write actually completed.
 */
export async function writeClipboardText(text: string): Promise<boolean> {
  let clipboard: ClipboardLike | undefined;
  try {
    // Reading `navigator.clipboard` can itself throw in a sandboxed frame.
    clipboard = (globalThis as { navigator?: { clipboard?: ClipboardLike } }).navigator?.clipboard;
  } catch {
    return false;
  }
  if (typeof clipboard?.writeText !== "function") return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
