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
 * `resolveCompactControl` and `renderCompact`, so the resolution rules live in
 * one place for all nine extensions. What stays here is the DOM: a consumer's
 * `render` supplies the children of the chip carrying `data-dtb-severity`, and
 * `Chip` paints the dot before them. The `impersonating` marker is rendered
 * *after* those children under every preset and under a `render` callback
 * alike — it is state, not presentation
 * (`plans/bar-presentation-icons-v1.md`, invariant 2).
 */

/**
 * The short word the bar paints, and the reason there is one.
 *
 * `label` is the extension's identity — the panel's accessible name, the `⋮`
 * row — and the bar has always painted this three-letter word instead, in the
 * bar *and* in the menu. Presets operate on *this* word; `label` stays the
 * accessible-name identity, which is what makes the text axis
 * `"none" | "short" | "full"` rather than a boolean
 * (`plans/bar-presentation-icons-v1.md`, "Which text").
 */
const SHORT_LABEL = "env";

/**
 * Today's tree, expressed as parts.
 *
 * `resolveCompactControl` answers the preset's parts, or these when the preset
 * is `"default"` — handed in rather than known to kit, because `"default"`
 * means *whatever this extension renders today* and that differs across the
 * nine. Environment is the one Group A chip whose overflow row is not a
 * *different* tree: it has always painted `"env"` in both places, so
 * `overflow.text` is `"short"` here where the other four say `"full"`. That is
 * the whole point of handing the defaults in — the byte-identity of the `⋮`
 * row is a property of this record, not of a rule kit could have guessed.
 * (A preset still forces `"full"` in the menu; only `"default"` is pinned to
 * what shipped.)
 *
 * The `impersonating` child is not in here, and cannot be: it is state the
 * extension paints after the parts under every preset.
 */
const DEFAULTS: CompactDefaults = {
  bar: { icon: false, text: "short", value: true },
  overflow: { icon: false, text: "short", value: true },
};

/**
 * The icon and the text.
 *
 * These are the chip's *children* rather than `Chip`'s `icon` / `label` /
 * `value` slots — the same call `/ext/a11y`, `/ext/diagnostics`,
 * `/ext/overlays` and `/ext/metrics` made, and the reason is recorded in
 * `docs/adr/ADR-004-per-extension-bar-presentation.md`. `Chip` renders its
 * children straight after the dot, in the slots' own position, so nothing
 * about the surrounding output moves. The fragment itself is kit's
 * `renderCompactParts` — six extensions wrote it identically, so it is one
 * function now, and `textProps` is what lets each keep its own attributes.
 *
 * One deliberate difference from the four chips that only carry a
 * `data-dtb-part`: this text span also carries `data-dtb-kind="label"`.
 * Environment already passed `labelProps` before any of this, so both are
 * today's bytes. `/ext/environment`'s own sheet selects on neither; what tints
 * the word is the kit sheet's
 * `[data-dtb-kind="label"] { color: var(--dtb-muted) }` (`src/kit/css.ts`).
 * Dropping the `kind` to match the others would be the regression, not the
 * cleanup — and adding it to the others would recolour four chips, which is
 * why they were named without it.
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
 * The one Group A chip with **two** button wrappers.
 *
 * The `⋮` row is a different element — `data-dtb-part="env-overflow"`, and
 * deliberately no `aria-expanded`, because that row is not the disclosure the
 * bar trigger is. Both wrappers take the same children, the same
 * `aria-label` — the override included — and the same `title`, so the fork is
 * about the *element*, never about the presentation. That is why `contents` is
 * built once above the fork rather than inside each branch: a second
 * construction is a second thing to keep in step.
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
  // `presentation.name` overrides it, and a whitespace-only override is
  // ignored so no override can leave either wrapper unnamed. Resolved once,
  // above the fork, because both wrappers carry it.
  const accessibleName = resolveAccessibleName(presentation.name, snapshot, accessibleLabel);

  const control = resolveCompactControl(presentation, snapshot, {
    isOverflowed,
    defaults: DEFAULTS,
  });
  const fallback = (
    <>
      {iconAndText(label, control.parts, control.icon)}
      {/* The order `Chip`'s own value slot wrote before this moved into the
          chip's children: kind, severity, then the site's props. */}
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
      {/* Invariant 2: acting as somebody else is state, not presentation. It
          sits outside both the preset and `render`, after the contents, under
          every preset including `"icon"` — a consumer restyling the chip
          cannot silence the one thing on it that says whose session this is. */}
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
