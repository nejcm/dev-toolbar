import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Action,
  Banner,
  Chip,
  EmptyState,
  Note,
  renderCompact,
  renderCompactParts,
  resolveAccessibleName,
  resolveCompactControl,
  useExtensionSurface,
} from "@nejcm/dev-toolbar/kit";
import type {
  CompactDefaults,
  CompactParts,
  ResolvedCompactPresentation,
} from "@nejcm/dev-toolbar/kit";
import { ensureDiagnosticsStyles } from "./css";
import { SNAPSHOT_FORMATS } from "./types";
import type { DiagnosticsBarView, SnapshotFormat } from "./types";
import type { DiagnosticsRuntime } from "./runtime";

/**
 * The rendered surface. [dev-toolbar/ext/diagnostics]
 *
 * The panel shows the snapshot in full before anything can be sent anywhere —
 * the preview holds exactly the text the copy/download buttons produce, not a
 * summary of it. Everything rendered comes from the already-redacted
 * snapshot, so no component here has access to a raw value to print one
 * (same construction as `/ext/environment` and `/ext/flags`).
 *
 * `presentation` arrives already resolved and is read through `/kit`'s
 * `resolveCompactControl` and `renderCompact`. A consumer's `render` supplies
 * only the chip's children; `Chip` still owns the dot and the state
 * attributes. The error/warning badge renders after those children under
 * every preset and under `render` alike — it is live state, not presentation
 * (`plans/bar-presentation-icons-v1.md`, invariant 2).
 */

const FORMAT_LABEL: Record<SnapshotFormat, string> = {
  markdown: "Markdown",
  json: "JSON",
};

/* -------------------------------------------------------------------------- */
/* Bar chip                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The short bar word. Presets operate on this; `label` stays the overflow
 * and accessible-name identity (`plans/bar-presentation-icons-v1.md`,
 * "Which text").
 */
const SHORT_LABEL = "diagnostics";

/**
 * Today's tree, expressed as parts — what `resolveCompactControl` falls back
 * to under `"default"`. Diagnostics' default is exactly expressible as parts
 * (short word plus value in the bar, full label plus value in the `⋮` menu,
 * no icon in either), which is what makes "default output is byte-identical"
 * structural rather than asserted. The badge is not in here: it's state the
 * extension paints after the parts under every preset.
 */
const DEFAULTS: CompactDefaults = {
  bar: { icon: false, text: "short", value: true },
  overflow: { icon: false, text: "full", value: true },
};

/**
 * The icon and text as the chip's children, not `Chip`'s `icon`/`label`/
 * `value` slots (`docs/adr/ADR-004-per-extension-bar-presentation.md`).
 */
function iconAndText(label: string, parts: CompactParts, icon: ReactNode): ReactNode {
  return renderCompactParts({
    parts,
    icon,
    iconProps: { "data-dtb-part": "diag-icon" },
    short: SHORT_LABEL,
    full: label,
    // `data-dtb-part` only. The kit's `[data-dtb-kind="label"]` rule tints a
    // labelled span with `--dtb-muted`; this chip has never been tinted, and
    // whether it should be is a visual decision, not a side effect of naming
    // the span.
    textProps: { "data-dtb-part": "diag-label" },
  });
}

export interface ChipProps {
  runtime: DiagnosticsRuntime;
  label: string;
  /** Already through `resolvePresentation`, in the factory closure. */
  presentation: ResolvedCompactPresentation<DiagnosticsBarView>;
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
  presentation,
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
  // §1B's badge. Live — it counts events as they happen, not as of the last
  // capture, so the chip is the first place you learn something is on fire.
  const { errors, warnings } = state;
  const caught = errors + warnings;
  const caughtText =
    errors > 0
      ? `${errors} error${errors === 1 ? "" : "s"}${warnings > 0 ? `, ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}`
      : `${warnings} warning${warnings === 1 ? "" : "s"}`;
  const accessibleLabel = [
    label,
    omissions > 0 ? `${omissions} missing` : null,
    caught > 0 ? caughtText : null,
  ]
    .filter((part) => part !== null)
    .join(", ");

  // See `DiagnosticsBarView`.
  const view: DiagnosticsBarView = { captured, omissions, errors, warnings };
  const control = resolveCompactControl(presentation, view, { isOverflowed, defaults: DEFAULTS });
  const fallback = (
    <>
      {iconAndText(label, control.parts, control.icon)}
      {control.parts.value ? (
        <span data-dtb-kind="value" data-dtb-part="diag-value">
          {captured ? (omissions === 0 ? "ready" : `${omissions} missing`) : "capture"}
        </span>
      ) : null}
    </>
  );

  return (
    <button
      type="button"
      data-dtb-part="trigger"
      aria-expanded={isPanelOpen}
      // `presentation.name` overrides it; a whitespace-only override is ignored.
      aria-label={resolveAccessibleName(presentation.name, view, accessibleLabel)}
      onClick={onToggle}
      title={
        (captured
          ? `${label}: snapshot taken${omissions === 0 ? ", complete" : `, ${omissions} omission${omissions === 1 ? "" : "s"}`} — click to review, copy or download it`
          : `${label}: click to capture a snapshot for a bug report`) +
        (caught > 0 ? `\n${caughtText} captured since load; the snapshot lists them.` : "")
      }
    >
      <Chip
        data-dtb-part="diag-chip"
        data-dtb-incomplete={omissions > 0 ? "true" : "false"}
        dotProps={{ "data-dtb-part": "diag-dot" }}
      >
        {renderCompact(
          presentation,
          view,
          { icon: control.icon, isOverflowed, isPanelOpen },
          fallback,
        )}
        {/* Invariant 2: the badge is state, not presentation — it sits outside
            both the preset and `render`, after the contents, under every
            preset. */}
        {caught > 0 ? (
          <span
            data-dtb-part="diag-errors"
            data-dtb-tone={errors > 0 ? "error" : "warn"}
            data-dtb-errors={String(errors)}
            data-dtb-warnings={String(warnings)}
            // The accessible name above already carries the same words; the
            // badge itself is a duplicate to a screen reader.
            aria-hidden="true"
          >
            {caught}
          </span>
        ) : null}
      </Chip>
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
      <div data-dtb-part="diag-toolbar" data-dtb-kind="toolbar" data-dtb-bleed="">
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
        <Action data-dtb-part="diag-action" data-dtb-action="capture" onClick={recapture}>
          Capture again
        </Action>
        <Action
          data-dtb-part="diag-action"
          data-dtb-action="copy"
          disabled={snapshot === null}
          onClick={copy}
        >
          Copy
        </Action>
        <Action
          data-dtb-part="diag-action"
          data-dtb-action="download"
          disabled={snapshot === null}
          onClick={download}
        >
          Download
        </Action>
        <Note as="span" data-dtb-part="diag-note" role="status">
          {status ??
            (snapshot === null
              ? "Capturing…"
              : `Nothing has been sent anywhere. Read this, then copy or download it. ${
                  masked === 0
                    ? "No values matched the mask."
                    : `${masked} value${masked === 1 ? "" : "s"} masked.`
                }`)}
        </Note>
      </div>

      {snapshot !== null && snapshot.omissions.length > 0 ? (
        <Banner as="div" data-dtb-part="diag-omissions" role="alert">
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
        </Banner>
      ) : null}

      {snapshot === null ? (
        <EmptyState as="p" data-dtb-part="diag-empty">
          No snapshot yet.
        </EmptyState>
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
