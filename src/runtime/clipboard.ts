/**
 * Write text to the clipboard, honestly. [dev-toolbar/runtime]
 *
 * `/ext/metrics`, `/ext/environment` and `/ext/flags` each hand-rolled the same
 * six lines — feature-detect `navigator.clipboard.writeText`, call it, map the
 * two outcomes onto an `"ok" | "failed"` status. The `/ext/environment` builder
 * flagged that a third copy would mean it belonged here, the way
 * `ensureStyleSheet` moved in §11.2. `/ext/diagnostics` is the fourth.
 *
 * The behaviour worth centralising is the *failure* half, not the success half:
 *
 * - **A missing API and a rejected write are the same answer to the caller.**
 *   `navigator.clipboard` is undefined on an insecure origin and in every test
 *   environment, and `writeText` rejects when the document is not focused or
 *   permission is denied. In all of those cases nothing reached the clipboard,
 *   which is the only thing the UI needs to know.
 * - **It never throws.** These are called from click handlers, and a synchronous
 *   throw out of a copy button is a broken panel rather than a failed copy.
 * - **It resolves `false` rather than pretending.** A "Copied" badge over an
 *   empty clipboard is the same class of lie as a "masked" badge over an
 *   unmasked value.
 *
 * No fallback to `document.execCommand("copy")`. It needs a live selection in a
 * temporary node, which means mutating the host document from a helper, and it
 * is deprecated everywhere it still works. Saying "clipboard unavailable" and
 * leaving the text on screen to select is the honest degradation.
 */

interface ClipboardLike {
  writeText?: (text: string) => Promise<void>;
}

/**
 * The command-shaped wrapper.
 *
 * A panel button has somewhere to put "clipboard unavailable" — a `role=status`
 * next to it. An aggregated `ToolbarCommand` does not: it returns `void`, and
 * §13.4 established that the palette reports a command that **throws** and
 * closes over one that resolves. So the five first-party copy commands were
 * silently doing nothing on an insecure origin or an unfocused document while
 * the palette closed as though they had worked — which is the same lie as a
 * "Copied" badge over an empty clipboard, just told by omission.
 *
 * Throwing is the correct signal here precisely because the palette catches it
 * and shows the message in place.
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
