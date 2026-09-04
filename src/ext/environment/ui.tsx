import { useState } from "react";
import type { ReactNode } from "react";
import { writeClipboardText } from "../../runtime";
import { useExtensionSurface } from "../shared/hooks";
import { ensureEnvironmentStyles } from "./css";
import { GROUP_LABELS } from "./types";
import type { EnvironmentFieldView, EnvironmentGroup, EnvironmentSnapshot } from "./types";
import type { EnvironmentRuntime } from "./runtime";

/**
 * The rendered surface. [dev-toolbar/ext/environment]
 *
 * Slot functions must be cheap, so they return these components and the
 * components subscribe to the extension's own store. Everything they render
 * comes from the snapshot, which is redacted before it is built — the panel has
 * no access to the raw context and cannot accidentally print it.
 */

const kindLabel = (snapshot: EnvironmentSnapshot): string =>
  snapshot.supplied && snapshot.kind !== "unknown" ? String(snapshot.kind) : "unknown";

export interface ChipProps {
  runtime: EnvironmentRuntime;
  label: string;
  isOverflowed: boolean;
  isPanelOpen: boolean;
  injectStyles: boolean;
  styleNonce?: string;
  onToggle(): void;
}

export function EnvironmentChip({
  runtime,
  label,
  isOverflowed,
  isPanelOpen,
  injectStyles,
  styleNonce,
  onToggle,
}: ChipProps): ReactNode {
  const snapshot = useExtensionSurface(
    runtime.store,
    injectStyles,
    ensureEnvironmentStyles,
    styleNonce,
  );
  const kind = kindLabel(snapshot);
  const title = snapshot.supplied
    ? `${label}: ${kind} — click for the full context`
    : `${label}: unknown — no context supplied to environment()`;

  const inner = (
    <span data-dtb-part="env-chip" data-dtb-severity={snapshot.severity}>
      <span data-dtb-part="env-dot" aria-hidden="true" />
      <span data-dtb-part="env-label">env</span>
      <span data-dtb-part="env-value" data-dtb-env={kind}>
        {kind}
      </span>
      {snapshot.impersonating ? <span data-dtb-part="env-alert">impersonating</span> : null}
    </span>
  );

  if (isOverflowed) {
    return (
      <button type="button" data-dtb-part="env-overflow" onClick={onToggle} title={title}>
        {inner}
      </button>
    );
  }

  return (
    <button
      type="button"
      data-dtb-part="trigger"
      aria-expanded={isPanelOpen}
      onClick={onToggle}
      title={title}
    >
      {inner}
    </button>
  );
}

export interface PanelProps {
  runtime: EnvironmentRuntime;
  injectStyles: boolean;
  styleNonce?: string;
}

export function EnvironmentPanel({ runtime, injectStyles, styleNonce }: PanelProps): ReactNode {
  const snapshot = useExtensionSurface(
    runtime.store,
    injectStyles,
    ensureEnvironmentStyles,
    styleNonce,
  );
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");

  // `/runtime`'s shared writer, not a hand-rolled one: a missing clipboard API
  // and a rejected write are the same answer to this panel, and four copies of
  // that judgement is three too many. See `runtime/clipboard.ts`.
  const copy = (text: string) => {
    void writeClipboardText(text).then((ok) => setCopied(ok ? "ok" : "failed"));
  };

  const groups: EnvironmentGroup[] = ["build", "session", "client"];
  const anythingSupplied = snapshot.fields.some((field) => field.source === "supplied");

  return (
    <div
      data-dtb-part="env-panel"
      data-dtb-severity={snapshot.severity}
      data-dtb-impersonating={snapshot.impersonating ? "true" : "false"}
    >
      {snapshot.impersonating ? (
        <p data-dtb-part="env-banner" role="alert">
          Impersonation is active. Everything you do here happens as somebody else.
        </p>
      ) : null}

      <div data-dtb-part="env-body" data-dtb-bleed="">
        {anythingSupplied ? null : (
          <div data-dtb-part="env-empty">
            <p data-dtb-part="env-note">
              No environment context was supplied, so this environment is <strong>unknown</strong> —
              not "local". Nothing here is guessed from the hostname, and nothing is read from{" "}
              <code>process.env</code>.
            </p>
            <p data-dtb-part="env-note">
              Pass what you know:{" "}
              <code>
                {'environment({ context: { environment: "staging", release: __RELEASE__ } })'}
              </code>
              , or a function for values that change.
            </p>
          </div>
        )}

        {groups.map((group) => {
          const fields = snapshot.fields.filter((field) => field.group === group);
          if (fields.length === 0) return null;
          return (
            <section key={group} data-dtb-part="env-group" data-dtb-group={group}>
              <h3 data-dtb-part="env-group-title" data-dtb-legend="">
                {GROUP_LABELS[group]}
              </h3>
              <dl data-dtb-part="env-rows">
                {fields.map((field) => (
                  <Row key={field.id} field={field} />
                ))}
              </dl>
            </section>
          );
        })}
      </div>

      <div data-dtb-part="env-actions" data-dtb-bleed="">
        <button
          type="button"
          data-dtb-part="env-action"
          data-dtb-action="copy"
          onClick={() => copy(runtime.snapshotText())}
        >
          Copy summary
        </button>
        <button
          type="button"
          data-dtb-part="env-action"
          data-dtb-action="copy-json"
          onClick={() => copy(JSON.stringify(runtime.diagnostics(), null, 2))}
        >
          Copy JSON
        </button>
        <span data-dtb-part="env-note" role="status">
          {copied === "failed"
            ? "Clipboard unavailable."
            : copied === "ok"
              ? `Copied — ${snapshot.maskedCount} value${snapshot.maskedCount === 1 ? "" : "s"} masked.`
              : `Credential-shaped values and email addresses are masked before anything is copied${snapshot.maskedCount > 0 ? ` (${snapshot.maskedCount} here)` : ""}. Read it before you paste it.`}
        </span>
      </div>
    </div>
  );
}

function Row({ field }: { field: EnvironmentFieldView }): ReactNode {
  return (
    <>
      <dt data-dtb-part="env-row-label">{field.label}</dt>
      <dd
        data-dtb-part="env-row-value"
        data-dtb-field={field.id}
        data-dtb-source={field.source}
        data-dtb-masked={field.masked ? "true" : "false"}
        data-dtb-alarming={field.alarming ? "true" : "false"}
      >
        {field.source === "missing" ? (
          <span data-dtb-part="env-missing">not supplied</span>
        ) : (
          field.value
        )}
        {field.masked ? (
          <span
            data-dtb-part="env-tag"
            data-dtb-tag="masked"
            title="This value was masked before it was rendered or copied."
          >
            masked
          </span>
        ) : null}
        {field.source === "detected" ? (
          <span
            data-dtb-part="env-tag"
            data-dtb-tag="detected"
            title="Read from this browser, not from the deployment."
          >
            detected
          </span>
        ) : null}
      </dd>
    </>
  );
}
