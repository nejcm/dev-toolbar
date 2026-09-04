import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useExtensionSurface } from "@nejcm/dev-toolbar/kit";
import { ensureDiagnosticsStyles } from "./css";
import { SNAPSHOT_FORMATS } from "./types";
import type { SnapshotFormat } from "./types";
import type { DiagnosticsRuntime } from "./runtime";

/**
 * The rendered surface. [dev-toolbar/ext/diagnostics]
 *
 * The panel shows the snapshot in full before anything can be sent anywhere —
 * the preview holds exactly the text the copy/download buttons produce, not a
 * summary of it. Everything rendered comes from the already-redacted
 * snapshot, so no component here has access to a raw value to print one
 * (same construction as `/ext/environment` and `/ext/flags`).
 */

const FORMAT_LABEL: Record<SnapshotFormat, string> = {
  markdown: "Markdown",
  json: "JSON",
};

/* -------------------------------------------------------------------------- */
/* Bar chip                                                                    */
/* -------------------------------------------------------------------------- */

export interface ChipProps {
  runtime: DiagnosticsRuntime;
  label: string;
  isOverflowed: boolean;
  isPanelOpen: boolean;
  injectStyles: boolean;
  styleNonce?: string;
  onToggle(): void;
}

/**
 * The chip deliberately does **not** capture — walking every extension's
 * `diagnostics()` on a timer would charge every consumer for a feature only
 * used when something's wrong. It just shows whether a snapshot exists and
 * was complete; the panel does the work.
 */
export function DiagnosticsChip({
  runtime,
  label,
  isOverflowed,
  isPanelOpen,
  injectStyles,
  styleNonce,
  onToggle,
}: ChipProps): ReactNode {
  const state = useExtensionSurface(
    runtime.store,
    injectStyles,
    ensureDiagnosticsStyles,
    styleNonce,
  );
  const omissions = state.snapshot?.omissions.length ?? 0;
  const captured = state.snapshot !== null;
  const accessibleLabel = omissions > 0 ? `${label}, ${omissions} missing` : label;

  return (
    <button
      type="button"
      data-dtb-part="trigger"
      aria-expanded={isPanelOpen}
      aria-label={accessibleLabel}
      onClick={onToggle}
      title={
        captured
          ? `${label}: snapshot taken${omissions === 0 ? ", complete" : `, ${omissions} omission${omissions === 1 ? "" : "s"}`} — click to review, copy or download it`
          : `${label}: click to capture a snapshot for a bug report`
      }
    >
      <span data-dtb-part="diag-chip" data-dtb-incomplete={omissions > 0 ? "true" : "false"}>
        <span data-dtb-part="diag-dot" aria-hidden="true" />
        <span>{isOverflowed ? label : "diagnostics"}</span>
        <span data-dtb-part="diag-value">
          {captured ? (omissions === 0 ? "ready" : `${omissions} missing`) : "capture"}
        </span>
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                       */
/* -------------------------------------------------------------------------- */

export interface PanelProps {
  runtime: DiagnosticsRuntime;
  label: string;
  injectStyles: boolean;
  styleNonce?: string;
}

export function DiagnosticsPanel({
  runtime,
  label,
  injectStyles,
  styleNonce,
}: PanelProps): ReactNode {
  const state = useExtensionSurface(
    runtime.store,
    injectStyles,
    ensureDiagnosticsStyles,
    styleNonce,
  );
  const [format, setFormat] = useState<SnapshotFormat>(() => runtime.readFormat());
  const [status, setStatus] = useState<string | null>(null);

  // In an effect, not during render, or it'd run twice under StrictMode and
  // walk every extension twice per panel open.
  useEffect(() => {
    if (runtime.latest() === null) runtime.capture();
  }, [runtime]);

  const snapshot = state.snapshot;
  // Mask count comes from the snapshot, not the rendered string — the Markdown
  // footer mentions the mask and would count itself. See `countMasked`.
  const view = useMemo(
    () =>
      snapshot === null
        ? { text: "", masked: 0 }
        : { text: runtime.render(format), masked: runtime.maskedCount() },
    // `state.revision` is the capture identity; `snapshot` is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runtime, format, state.revision, snapshot === null],
  );
  const { text, masked } = view;

  const choose = (next: SnapshotFormat) => {
    setFormat(next);
    runtime.writeFormat(next);
    setStatus(null);
  };

  const recapture = () => {
    runtime.capture();
    setStatus(null);
  };

  const copy = () => {
    void runtime.copy(format).then((ok) => {
      setStatus(
        ok
          ? `Copied ${FORMAT_LABEL[format]} to the clipboard.`
          : "Clipboard unavailable — select the text below and copy it by hand.",
      );
    });
  };

  const download = () => {
    const started = runtime.download(format);
    setStatus(
      started
        ? `Downloading ${runtime.filename(format)}.`
        : "Downloads are unavailable here — copy the text below instead.",
    );
  };

  return (
    <div data-dtb-part="diag-panel" aria-label={label}>
      <div data-dtb-part="diag-toolbar" data-dtb-bleed="">
        <div data-dtb-part="diag-formats" role="group" aria-label="Snapshot format">
          {SNAPSHOT_FORMATS.map((id) => (
            <button
              key={id}
              type="button"
              data-dtb-part="diag-format"
              data-dtb-format={id}
              aria-pressed={format === id}
              onClick={() => choose(id)}
            >
              {FORMAT_LABEL[id]}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-dtb-part="diag-action"
          data-dtb-action="capture"
          onClick={recapture}
        >
          Capture again
        </button>
        <button
          type="button"
          data-dtb-part="diag-action"
          data-dtb-action="copy"
          disabled={snapshot === null}
          onClick={copy}
        >
          Copy
        </button>
        <button
          type="button"
          data-dtb-part="diag-action"
          data-dtb-action="download"
          disabled={snapshot === null}
          onClick={download}
        >
          Download
        </button>
        <span data-dtb-part="diag-note" role="status">
          {status ??
            (snapshot === null
              ? "Capturing…"
              : `Nothing has been sent anywhere. Read this, then copy or download it. ${
                  masked === 0
                    ? "No values matched the mask."
                    : `${masked} value${masked === 1 ? "" : "s"} masked.`
                }`)}
        </span>
      </div>

      {snapshot !== null && snapshot.omissions.length > 0 ? (
        <div data-dtb-part="diag-omissions" role="alert">
          <strong>
            Incomplete — {snapshot.omissions.length} thing
            {snapshot.omissions.length === 1 ? "" : "s"} could not be included.
          </strong>{" "}
          They are listed in the snapshot itself as well, so whoever reads the ticket sees them too.
          <ul data-dtb-part="diag-omission-list">
            {snapshot.omissions.map((omission) => (
              <li key={omission.id} data-dtb-omission={omission.id}>
                <code>{omission.id}</code> ({omission.label}): {omission.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {snapshot === null ? (
        <p data-dtb-part="diag-empty">No snapshot yet.</p>
      ) : (
        <pre
          data-dtb-part="diag-preview"
          data-dtb-format={format}
          // Scrollable region must be keyboard-reachable; role+label make the tab stop meaningful.
          role="region"
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          aria-label={`${label} snapshot, ${FORMAT_LABEL[format]}`}
        >
          {text}
        </pre>
      )}
    </div>
  );
}
