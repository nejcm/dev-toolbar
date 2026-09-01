import type { DevToolbarExtension, ExtensionDiagnostics } from "./contract";

/**
 * The diagnostics aggregation — the P3 counterpart of `commands.ts`.
 *
 * Core collects and renders nothing, exactly as with commands: it produces the
 * roster and `/ext/diagnostics` decides what to do with it. The two differences
 * from `collectCommands` are both consequences of what a snapshot is *for*.
 *
 * **Every present, non-hidden extension appears**, including the ones that
 * declare no `diagnostics()`. A bug-report snapshot is read by somebody who was
 * not there, and "this extension had nothing to say" and "this extension blew
 * up" are the two things they must be able to tell apart. Dropping either from
 * the output turns an incomplete snapshot into an apparently complete one,
 * which is the worse of the two failures.
 *
 * **A throw is data, not a log line.** `resolveExtensionCommands` warns once and
 * contributes nothing, because a palette missing a row is a nuisance. Here the
 * failure *is* diagnostic information — an extension whose `diagnostics()` throws
 * is very often the extension the bug is about — so the message travels in the
 * entry rather than only to a console the reader will never see.
 */

/**
 * Reentrancy guard, for the same reason `collectCommands` has one: an extension
 * could call `api.getDiagnostics()` from inside its own `diagnostics()` and
 * recurse until the stack ends. The nested call yields the empty roster.
 */
let aggregating = false;

let warnedReentrant = false;

/** Test seam: the reentrancy warning is per process and would leak between cases. */
export function resetDiagnosticsWarnings(): void {
  warnedReentrant = false;
}

/**
 * Splits a thrown value into its name and its message, **unjoined**.
 *
 * The joining is the reader's job, and that is not a stylistic preference — it
 * is a leak this package shipped and had to fix. An earlier version returned
 * `` `${error.name}: ${error.message}` `` from here, and the reader then ran its
 * anchored redaction pass over the result. `redact()`'s value matching is
 * anchored: it masks a string that **is** a credential-carrying URL, not one
 * that contains one. Behind a `"Error: "` prefix the anchor never fires — so
 * `new Error("https://api.test/refresh?refresh_token=…")`, which is what fetch,
 * undici and axios all throw, arrived in the ticket verbatim.
 *
 * The distinction that matters: `"Error: <message>"` is a join **this package
 * performs**, so it does not fall under the documented mid-sentence limit. A
 * credential the *consumer* buried in prose is genuinely beyond an anchored
 * matcher; one this package hid behind its own prefix never was.
 *
 * Core cannot redact — it may not import `/runtime` (§2) — so it does the one
 * thing that keeps redaction possible downstream: it hands over the parts.
 */
function describe(error: unknown): { name?: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  try {
    return { message: String(error) };
  } catch {
    // A thrown object with a hostile `toString`. Saying so beats throwing from
    // the error path of an error path.
    return { message: "threw a value that could not be described" };
  }
}

/**
 * One entry per present, non-hidden extension, in extension order.
 *
 * `hidden` contributes nothing for the same reason it contributes no commands:
 * it means *this extension does not exist for this actor*, and a snapshot that
 * listed it — even as `absent` — would leak the fact of its existence into a
 * document headed off the machine.
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
