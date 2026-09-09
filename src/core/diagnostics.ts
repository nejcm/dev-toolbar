import type { DevToolbarExtension, ExtensionDiagnostics } from "./contract";

/**
 * The diagnostics aggregation — the P3 counterpart of `commands.ts`. Core
 * collects and renders nothing; it produces the roster and `/ext/diagnostics`
 * decides what to do with it. Two differences from `collectCommands`, both
 * consequences of what a snapshot is *for*:
 *
 * **Every present, non-hidden extension appears**, including ones with no
 * `diagnostics()` — a bug-report reader must be able to tell "had nothing to
 * say" apart from "blew up," and dropping either makes an incomplete snapshot
 * look complete.
 *
 * **A throw is data, not a log line.** Unlike `resolveExtensionCommands`
 * (which just warns), a `diagnostics()` throw is itself diagnostic
 * information, so the message travels in the entry, not only to a console.
 */

/**
 * Reentrancy guard: an extension calling `api.getDiagnostics()` from inside
 * its own `diagnostics()` would otherwise recurse until the stack ends. The
 * nested call yields the empty roster.
 */
let aggregating = false;

let warnedReentrant = false;

/** Test seam: the reentrancy warning is per process and would leak between cases. */
export function resetDiagnosticsWarnings(): void {
  warnedReentrant = false;
}

/**
 * Splits a thrown value into its name and message, **unjoined** — joining is
 * the reader's job, after masking each half (`ExtensionDiagnostics.error` in
 * `contract.ts` has the rule). Core cannot redact (may not import `/runtime`),
 * so it hands over the parts; `/runtime`'s `describeError()` is the shared
 * describer for everything outside core, and this stays only because of that
 * import rule.
 */
function describe(error: unknown): { name?: string; message: string } {
  try {
    if (error instanceof Error) {
      return { name: String(error.name), message: String(error.message) };
    }
    return { message: String(error) };
  } catch {
    // Getters and string coercion can throw while describing a thrown value.
    return { message: "threw a value that could not be described" };
  }
}

/**
 * One entry per present, non-hidden extension, in extension order.
 *
 * `hidden` means *this extension does not exist for this actor*, so a
 * snapshot that listed it — even as `absent` — would leak its existence into
 * a document headed off the machine.
 */
export function collectDiagnostics(
  extensions: readonly DevToolbarExtension[],
): ExtensionDiagnostics[] {
  if (aggregating) {
    if (!warnedReentrant) {
      warnedReentrant = true;
      // eslint-disable-next-line no-console
      console.error(
        "[dev-toolbar] getDiagnostics() was called from inside a diagnostics() " +
          "enumeration. The nested call returns nothing rather than recursing.",
      );
    }
    return [];
  }
  aggregating = true;
  try {
    const seen = new Set<string>();
    const entries: ExtensionDiagnostics[] = [];
    for (const extension of extensions) {
      if (extension.hidden === true) continue;
      if (seen.has(extension.id)) continue;
      seen.add(extension.id);
      const label = extension.label ?? extension.id;
      if (typeof extension.diagnostics !== "function") {
        entries.push({ id: extension.id, label, status: "absent" });
        continue;
      }
      try {
        entries.push({
          id: extension.id,
          label,
          status: "ok",
          data: extension.diagnostics(),
        });
      } catch (error) {
        const { name, message } = describe(error);
        entries.push({
          id: extension.id,
          label,
          status: "failed",
          error: message,
          ...(name === undefined ? {} : { errorName: name }),
        });
      }
    }
    return entries;
  } finally {
    aggregating = false;
  }
}
