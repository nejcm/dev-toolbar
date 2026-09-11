/**
 * Write text to the clipboard, honestly. [dev-toolbar/runtime]
 *
 * Feature-detects `navigator.clipboard.writeText`, calls it, and maps the
 * outcome to a status — never throws (these run from click handlers) and
 * resolves `false` rather than showing a "Copied" badge over an empty
 * clipboard. No `document.execCommand("copy")` fallback: it needs a live
 * selection in a temporary node and is deprecated everywhere it still works.
 */

interface ClipboardLike {
  writeText?: (text: string) => Promise<void>;
}

/**
 * The command-shaped wrapper: throws deliberately, since an aggregated
 * `ToolbarCommand` returns `void` and the command palette reports failure by
 * catching a throw — resolving silently would close the palette as if the
 * copy had worked.
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
