import type { ExtensionDiagnostics, ExtensionRuntimeApi } from "../core/contract";
import { formatError, redact, redactProse } from "../runtime";
import type { RedactOptions } from "../runtime";

/** One roster entry after masking: `error`/`errorName` masked, `data` redacted and JSON-safe. */
export type MaskedDiagnostics =
  | { id: string; label: string; status: "ok"; data: unknown }
  | { id: string; label: string; status: "absent" }
  | { id: string; label: string; status: "failed"; error: string; errorName?: string }
  | { id: string; label: string; status: "unserialisable"; error: string };

/** `gathered: false` means no `getDiagnostics` on this api, or it threw (`error` masked). */
export type DiagnosticsRosterRead =
  | { gathered: true; entries: MaskedDiagnostics[] }
  | { gathered: false; error?: string };

/** What `redactForExport` makes of one value. */
export type ExportedValue =
  | { status: "ok"; value: unknown }
  | { status: "absent" }
  | { status: "unserialisable"; error: string };

/** One foreign value on its way out: redact, then prove it serialises. Never throws. */
export function redactForExport(value: unknown, options?: RedactOptions): ExportedValue {
  const redacted = redact(value, options);
  if (redacted === undefined) return { status: "absent" };
  try {
    // A BigInt survives redact() and throws here.
    JSON.stringify(redacted);
  } catch (error) {
    return { status: "unserialisable", error: formatError(error, options) };
  }
  return { status: "ok", value: redacted };
}

/** Reads, masks and proves core's diagnostics roster serialisable. Never throws. */
export function readDiagnosticsRoster(
  api: Partial<Pick<ExtensionRuntimeApi, "getDiagnostics">> | null | undefined,
  options?: RedactOptions,
): DiagnosticsRosterRead {
  if (typeof api?.getDiagnostics !== "function") return { gathered: false };
  let roster: unknown;
  try {
    roster = api.getDiagnostics();
  } catch (error) {
    return { gathered: false, error: formatError(error, options) };
  }
  if (!Array.isArray(roster)) return { gathered: false };

  const entries: MaskedDiagnostics[] = [];
  for (const entry of roster as readonly ExtensionDiagnostics[]) {
    const { id, label } = entry;
    if (entry.status === "absent") {
      entries.push({ id, label, status: "absent" });
    } else if (entry.status === "failed") {
      const error = redactProse(entry.error ?? "diagnostics() threw.", options);
      entries.push(
        entry.errorName === undefined
          ? { id, label, status: "failed", error }
          : {
              id,
              label,
              status: "failed",
              error,
              errorName: redactProse(entry.errorName, options),
            },
      );
    } else {
      const exported = redactForExport(entry.data, options);
      entries.push(
        exported.status === "ok"
          ? { id, label, status: "ok", data: exported.value }
          : { id, label, ...exported },
      );
    }
  }
  return { gathered: true, entries };
}
