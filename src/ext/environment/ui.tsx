import type { ReactNode } from "react";
import {
  Action,
  Banner,
  Chip,
  EmptyState,
  Note,
  Row,
  Rows,
  Tag,
  useCopyStatus,
  useExtensionSurface,
} from "@nejcm/dev-toolbar/kit";
import { ensureEnvironmentStyles } from "./css";
import { GROUP_LABELS } from "./types";
import type { EnvironmentFieldView, EnvironmentGroup, EnvironmentSnapshot } from "./types";
import type { EnvironmentRuntime } from "./runtime";

/**
 * The rendered surface. [dev-toolbar/ext/environment]
 *
 * Everything rendered comes from the snapshot, which is already redacted —
 * these components have no access to the raw context.
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
    <Chip
      label="env"
      value={kind}
      severity={snapshot.severity}
      data-dtb-part="env-chip"
      data-dtb-severity={snapshot.severity}
      dotProps={{ "data-dtb-part": "env-dot" }}
      labelProps={{ "data-dtb-part": "env-label", "data-dtb-kind": "label" }}
      valueProps={{ "data-dtb-part": "env-value", "data-dtb-env": kind }}
    >
      {snapshot.impersonating ? <span data-dtb-part="env-alert">impersonating</span> : null}
    </Chip>
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
  const groups: EnvironmentGroup[] = ["build", "session", "client"];
  const anythingSupplied = snapshot.fields.some((field) => field.source === "supplied");
  const { status: copyStatus, copy } = useCopyStatus();

  return (
    <div
      data-dtb-part="env-panel"
      data-dtb-severity={snapshot.severity}
      data-dtb-impersonating={snapshot.impersonating ? "true" : "false"}
    >
      {snapshot.impersonating ? (
        <Banner data-dtb-part="env-banner" role="alert">
          Impersonation is active. Everything you do here happens as somebody else.
        </Banner>
      ) : null}

      <div data-dtb-part="env-body" data-dtb-bleed="">
        {anythingSupplied ? null : (
          <EmptyState data-dtb-part="env-empty">
            <Note data-dtb-part="env-note">
              No environment context was supplied, so this environment is <strong>unknown</strong> —
              not "local". Nothing here is guessed from the hostname, and nothing is read from{" "}
              <code>process.env</code>.
            </Note>
            <Note data-dtb-part="env-note">
              Pass what you know:{" "}
              <code>
                {'environment({ context: { environment: "staging", release: __RELEASE__ } })'}
              </code>
              , or a function for values that change.
            </Note>
          </EmptyState>
        )}

        {groups.map((group) => {
          const fields = snapshot.fields.filter((field) => field.group === group);
          if (fields.length === 0) return null;
          return (
            <section key={group} data-dtb-part="env-group" data-dtb-group={group}>
              <h3 data-dtb-part="env-group-title" data-dtb-legend="">
                {GROUP_LABELS[group]}
              </h3>
              <Rows data-dtb-part="env-rows">
                {fields.map((field) => (
                  <FieldRow key={field.id} field={field} />
                ))}
              </Rows>
            </section>
          );
        })}
      </div>

      <div data-dtb-part="env-actions" data-dtb-bleed="">
        <Action
          data-dtb-part="env-action"
          data-dtb-action="copy"
          onClick={() => copy(runtime.snapshotText())}
        >
          Copy summary
        </Action>
        <Action
          data-dtb-part="env-action"
          data-dtb-action="copy-json"
          onClick={() => copy(JSON.stringify(runtime.diagnostics(), null, 2))}
        >
          Copy JSON
        </Action>
        <Note as="span" data-dtb-part="env-note" role="status">
          {copyStatus === "failed"
            ? "Clipboard unavailable."
            : copyStatus === "ok"
              ? `Copied — ${snapshot.maskedCount} value${snapshot.maskedCount === 1 ? "" : "s"} masked.`
              : `Credential-shaped values and email addresses are masked before anything is copied${snapshot.maskedCount > 0 ? ` (${snapshot.maskedCount} here)` : ""}. Read it before you paste it.`}
        </Note>
      </div>
    </div>
  );
}

function FieldRow({ field }: { field: EnvironmentFieldView }): ReactNode {
  return (
    <Row
      label={field.label}
      labelProps={{ "data-dtb-part": "env-row-label" }}
      valueProps={{
        "data-dtb-part": "env-row-value",
        "data-dtb-field": field.id,
        "data-dtb-source": field.source,
        "data-dtb-masked": field.masked ? "true" : "false",
        "data-dtb-alarming": field.alarming ? "true" : "false",
      }}
    >
      {field.source === "missing" ? (
        <span data-dtb-part="env-missing">not supplied</span>
      ) : (
        field.value
      )}
      {field.masked ? (
        <Tag
          data-dtb-part="env-tag"
          data-dtb-tag="masked"
          title="This value was masked before it was rendered or copied."
        >
          masked
        </Tag>
      ) : null}
      {field.source === "detected" ? (
        <Tag
          data-dtb-part="env-tag"
          data-dtb-tag="detected"
          title="Read from this browser, not from the deployment."
        >
          detected
        </Tag>
      ) : null}
    </Row>
  );
}
