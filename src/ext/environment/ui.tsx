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
  renderCompact,
  renderCompactParts,
  resolveAccessibleName,
  resolveCompactControl,
  useCopyStatus,
  useExtensionSurface,
} from "@nejcm/dev-toolbar/kit";
import type {
  CompactDefaults,
  CompactParts,
  ResolvedCompactPresentation,
} from "@nejcm/dev-toolbar/kit";
import { ensureEnvironmentStyles } from "./css";
import { GROUP_LABELS, kindLabel } from "./types";
import type { EnvironmentFieldView, EnvironmentGroup, EnvironmentSnapshot } from "./types";
import type { EnvironmentRuntime } from "./runtime";

/**
 * The rendered surface. [dev-toolbar/ext/environment]
 *
 * Everything rendered comes from the snapshot, which is already redacted —
 * these components have no access to the raw context.
 *
 * `presentation` arrives already resolved and is read through `/kit`'s
 * `resolveCompactControl` and `renderCompact`. A consumer's `render` supplies
 * only the chip's children; `Chip` still owns the dot and the state
 * attributes. The `impersonating` marker renders after those children under
 * every preset and under `render` alike — it is state, not presentation
 * (`plans/bar-presentation-icons-v1.md`, invariant 2).
 */

/**
 * The short bar word. Presets operate on this; `label` stays the
 * accessible-name identity (`plans/bar-presentation-icons-v1.md`,
 * "Which text").
 */
const SHORT_LABEL = "env";

/**
 * Today's tree, expressed as parts — what `resolveCompactControl` falls back
 * to under `"default"`. Environment is the one Group A chip whose overflow
 * row isn't a different tree: it has always painted `"env"` in both places,
 * so `overflow.text` is `"short"` here where the other four say `"full"`. A
 * preset still forces `"full"` in the menu; only `"default"` is pinned to
 * what shipped. The `impersonating` child is not in here: it's state the
 * extension paints after the parts under every preset.
 */
const DEFAULTS: CompactDefaults = {
  bar: { icon: false, text: "short", value: true },
  overflow: { icon: false, text: "short", value: true },
};

/**
 * The icon and text as the chip's children, not `Chip`'s `icon`/`label`/
 * `value` slots (`docs/adr/ADR-004-per-extension-bar-presentation.md`).
 *
 * Unlike the other chips, this text span also carries `data-dtb-kind="label"`
 * — environment already passed `labelProps` before this feature, so it's
 * today's bytes. That attribute is what the kit sheet's
 * `[data-dtb-kind="label"]` rule tints; dropping it here would be a
 * regression, and adding it to the others would recolour them.
 */
function iconAndText(label: string, parts: CompactParts, icon: ReactNode): ReactNode {
  return renderCompactParts({
    parts,
    icon,
    iconProps: { "data-dtb-part": "env-icon" },
    short: SHORT_LABEL,
    full: label,
    textProps: { "data-dtb-part": "env-label", "data-dtb-kind": "label" },
  });
}

export interface ChipProps {
  runtime: EnvironmentRuntime;
  label: string;
  /** Already through `resolvePresentation`, in the factory closure. */
  presentation: ResolvedCompactPresentation<EnvironmentSnapshot>;
  isOverflowed: boolean;
  isPanelOpen: boolean;
  injectStyles: boolean;
  styleNonce?: string;
  onToggle(): void;
}

/**
 * The one Group A chip with two button wrappers. The `⋮` row is a different
 * element (`data-dtb-part="env-overflow"`, no `aria-expanded`) but shares the
 * same children, `aria-label` and `title` — the fork is about the element,
 * never the presentation, so `inner` is built once above it.
 */
export function EnvironmentChip({
  runtime,
  label,
  presentation,
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
  // The chip paints "env" plus the kind, so without a name of its own the
  // button is announced as its own readout. `title` explains; it does not name.
  const accessibleLabel = [label, kind, snapshot.impersonating ? "impersonating" : null]
    .filter((part) => part !== null)
    .join(", ");
  // `presentation.name` overrides it; a whitespace-only override is ignored.
  const accessibleName = resolveAccessibleName(presentation.name, snapshot, accessibleLabel);

  const control = resolveCompactControl(presentation, snapshot, {
    isOverflowed,
    defaults: DEFAULTS,
  });
  const fallback = (
    <>
      {iconAndText(label, control.parts, control.icon)}
      {control.parts.value ? (
        <span
          data-dtb-kind="value"
          data-dtb-severity={snapshot.severity}
          data-dtb-part="env-value"
          data-dtb-env={kind}
        >
          {kind}
        </span>
      ) : null}
    </>
  );

  const inner = (
    <Chip
      severity={snapshot.severity}
      data-dtb-part="env-chip"
      data-dtb-severity={snapshot.severity}
      dotProps={{ "data-dtb-part": "env-dot" }}
    >
      {renderCompact(
        presentation,
        snapshot,
        { icon: control.icon, isOverflowed, isPanelOpen },
        fallback,
      )}
      {/* Invariant 2: acting as somebody else is state, not presentation — it
          sits outside both the preset and `render`, after the contents, under
          every preset. */}
      {snapshot.impersonating ? <span data-dtb-part="env-alert">impersonating</span> : null}
    </Chip>
  );

  if (isOverflowed) {
    return (
      <button
        type="button"
        data-dtb-part="env-overflow"
        aria-label={accessibleName}
        onClick={onToggle}
        title={title}
      >
        {inner}
      </button>
    );
  }

  return (
    <button
      type="button"
      data-dtb-part="trigger"
      aria-expanded={isPanelOpen}
      aria-label={accessibleName}
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
