import type { CSSProperties, ReactNode } from "react";
import {
  Action,
  Banner,
  Chip,
  EmptyState,
  Glyph,
  Note,
  Row,
  Rows,
  Tag,
  renderCompact,
  resolveAccessibleName,
  resolveCompactControl,
  useExtensionSurface,
} from "@nejcm/dev-toolbar/kit";
import type {
  CompactDefaults,
  CompactParts,
  ResolvedCompactPresentation,
} from "@nejcm/dev-toolbar/kit";
import { ensureA11yStyles } from "./css";
import { IMPACT_SEVERITY, selectionKey, worstImpact } from "./types";
import type { A11yHighlightView, A11yReport, RectLike } from "./types";
import type { A11yRuntime } from "./runtime";

/**
 * The rendered surfaces. [dev-toolbar/ext/a11y]
 *
 * Everything here reads `snapshot.report` — the same object `diagnostics()`
 * returns and the commands hand back, so the panel cannot show a fact an agent
 * cannot read, and neither can show an unmasked one.
 *
 * `presentation` arrives already resolved and is read through `/kit`'s
 * `resolveCompactControl` and `renderCompact`, so the `hasIcon` guard, the
 * `"default"` fallback, the `CompactRenderContext` and the `undefined`
 * fall-through live in one place for all nine extensions rather than nine.
 * What stays here is the DOM: a consumer's `render` supplies the children of
 * the chip carrying `data-dtb-status`, and `Chip` paints the dot before them,
 * so no callback can cost the control its state attributes or its dot.
 */

const box = (rect: RectLike): CSSProperties => ({
  left: `${rect.x}px`,
  top: `${rect.y}px`,
  width: `${Math.max(rect.width, 0)}px`,
  height: `${Math.max(rect.height, 0)}px`,
});

const chipValue = (report: A11yReport): string => {
  if (report.status === "unsupported") return "NA";
  if (report.running) return "…";
  if (report.status === "failed") return "error";
  if (report.status === "pending") return "scan";
  return String(report.total);
};

const chipSeverity = (report: A11yReport) => {
  if (report.status === "unsupported" || report.status === "pending") return "unknown";
  if (report.status === "failed") return "bad";
  const worst = worstImpact(report.counts);
  return worst === null ? "ok" : IMPACT_SEVERITY[worst];
};

/**
 * The short word the bar paints, and the reason there is one.
 *
 * `label` is the extension's identity — the error chip, the panel's accessible
 * name, the `⋮` row — and it is too long for the bar, so the bar has always
 * painted this instead. Presets operate on *this* word; `label` stays the
 * overflow and accessible-name identity, which is what makes the text axis
 * `"none" | "short" | "full"` rather than a boolean
 * (`plans/bar-presentation-icons-v1.md`, "Which text").
 */
const SHORT_LABEL = "a11y";

/**
 * Today's tree, expressed as parts.
 *
 * `resolveCompactControl` answers the preset's parts, or these when the preset
 * is `"default"` — handed in rather than known to kit, because `"default"`
 * means *whatever this extension renders today* and that differs across the
 * nine. a11y's default is exactly expressible as parts (short word plus value
 * in the bar, full label plus value in the `⋮` menu, no icon in either), so
 * "the default output is byte-identical" is a structural property rather than
 * a claim — and the hand-rolled `isOverflowed ? label : "a11y"` swing this
 * chip used to write by hand is now just `parts.text`.
 */
const DEFAULTS: CompactDefaults = {
  bar: { icon: false, text: "short", value: true },
  overflow: { icon: false, text: "full", value: true },
};

/**
 * The icon and the text.
 *
 * These are the chip's *children* rather than `Chip`'s `icon` / `label` /
 * `value` slots — the same call `/ext/metrics` made, and the reason, together
 * with what it means for those now-unimported slots, is recorded in
 * `docs/adr/ADR-004-per-extension-bar-presentation.md`. `Chip` renders its
 * children straight after the dot, in the slots' own position, so nothing
 * about today's output moves.
 */
function iconAndText(
  label: string,
  { icon: paintIcon, text }: CompactParts,
  icon: ReactNode,
): ReactNode {
  return (
    <>
      {paintIcon ? <Glyph data-dtb-part="a11y-icon">{icon}</Glyph> : null}
      {/* A bare `<span>`, which is what `Chip`'s `label` slot wrote before this
          moved into the chip's children — no `data-dtb-part`, because adding
          one would change today's bytes. */}
      {text === "none" ? null : <span>{text === "full" ? label : SHORT_LABEL}</span>}
    </>
  );
}

export interface ChipProps {
  runtime: A11yRuntime;
  label: string;
  /** Already through `resolvePresentation`, in the factory closure. */
  presentation: ResolvedCompactPresentation<A11yReport>;
  isOverflowed: boolean;
  isPanelOpen: boolean;
  injectStyles: boolean;
  styleNonce?: string;
  onToggle(): void;
}

export function A11yChip({
  runtime,
  label,
  presentation,
  isOverflowed,
  isPanelOpen,
  injectStyles,
  styleNonce,
  onToggle,
}: ChipProps): ReactNode {
  const { report } = useExtensionSurface(runtime.store, injectStyles, ensureA11yStyles, styleNonce);
  const severity = chipSeverity(report);
  const control = resolveCompactControl(presentation, report, { isOverflowed, defaults: DEFAULTS });
  const fallback = (
    <>
      {iconAndText(label, control.parts, control.icon)}
      {/* The order `Chip`'s own value slot wrote before this moved into the
          chip's children: kind, severity, then the site's props. */}
      {control.parts.value ? (
        <span data-dtb-kind="value" data-dtb-severity={severity} data-dtb-part="a11y-value">
          {chipValue(report)}
        </span>
      ) : null}
    </>
  );

  return (
    <button
      type="button"
      data-dtb-part="trigger"
      aria-expanded={isPanelOpen}
      // `presentation.name` overrides it, and a whitespace-only override is
      // ignored so no override can leave the trigger unnamed — which is what
      // this extension would flag on the toolbar's own bar. `title` explains;
      // it does not name, so it is not overridable.
      aria-label={resolveAccessibleName(
        presentation.name,
        report,
        report.status === "ok"
          ? `${label}, ${report.total} violation${report.total === 1 ? "" : "s"}`
          : `${label}, ${report.status}`,
      )}
      onClick={onToggle}
      title={
        report.status === "unsupported"
          ? `${label}: axe-core is not installed`
          : `${label}: click to scan this page`
      }
    >
      <Chip
        severity={severity}
        data-dtb-part="a11y-chip"
        data-dtb-status={report.status}
        dotProps={{ "data-dtb-part": "a11y-dot" }}
      >
        {renderCompact(
          presentation,
          report,
          { icon: control.icon, isOverflowed, isPanelOpen },
          fallback,
        )}
      </Chip>
    </button>
  );
}

export interface PanelProps {
  runtime: A11yRuntime;
  label: string;
  /** The runtime's `loadOn`; the panel words `pending` differently when axe is not fetched until a scan. */
  loadOn: "start" | "scan";
  injectStyles: boolean;
  styleNonce?: string;
}

export function A11yPanel({
  runtime,
  label,
  loadOn,
  injectStyles,
  styleNonce,
}: PanelProps): ReactNode {
  const { report, axeLoaded } = useExtensionSurface(
    runtime.store,
    injectStyles,
    ensureA11yStyles,
    styleNonce,
  );
  const unsupported = report.status === "unsupported";
  const unchecked = loadOn === "scan" && report.status === "pending" && !axeLoaded;

  return (
    <div data-dtb-part="a11y-panel" aria-label={label}>
      <div data-dtb-part="a11y-actions">
        <Action
          data-dtb-part="a11y-scan"
          disabled={unsupported || report.running}
          onClick={() => void runtime.scan()}
        >
          {report.running ? "Scanning…" : "Scan this page"}
        </Action>
        <Action
          data-dtb-part="a11y-clear"
          disabled={report.status !== "ok" && report.selected === null}
          onClick={() => runtime.clear()}
        >
          Clear
        </Action>
      </div>

      {unsupported ? (
        <Banner data-dtb-part="a11y-unsupported" severity="unknown" role="status">
          {report.unsupportedReason ?? "axe-core is not installed."}
        </Banner>
      ) : null}

      {unchecked ? (
        <Note as="p" data-dtb-part="a11y-unchecked">
          axe-core has not been checked yet. Scan this page to load it and run the accessibility
          check.
        </Note>
      ) : null}

      {report.error === null ? null : (
        <Banner data-dtb-part="a11y-error" severity="bad" role="alert">
          {report.error}
        </Banner>
      )}

      {report.status === "ok" ? (
        <Rows data-dtb-part="a11y-meta">
          <Row label="Elements">{String(report.nodeTotal)}</Row>
          <Row label="Passed rules">{report.passes === null ? "—" : String(report.passes)}</Row>
          <Row label="Needs review">
            {report.incomplete === null ? "—" : String(report.incomplete)}
          </Row>
          <Row label="Took">{report.durationMs === null ? "—" : `${report.durationMs} ms`}</Row>
          <Row label="axe">{report.axeVersion ?? "—"}</Row>
        </Rows>
      ) : null}

      {report.status === "ok" && report.total === 0 ? (
        <EmptyState data-dtb-part="a11y-empty">
          No violations from the rules that ran. axe checks what it can see in the DOM — it is a
          floor, not a verdict.
        </EmptyState>
      ) : null}

      <div data-dtb-part="a11y-groups">
        {report.groups.map((group) => (
          <section key={group.impact} data-dtb-part="a11y-group" data-dtb-impact={group.impact}>
            <h3 data-dtb-part="a11y-group-heading">
              {group.impact}
              <Tag data-dtb-part="a11y-group-count">{group.count}</Tag>
            </h3>
            {group.violations.map((violation) => (
              <article
                key={violation.rule}
                data-dtb-part="a11y-rule"
                data-dtb-rule={violation.rule}
                data-dtb-impact={violation.impact}
              >
                <div data-dtb-part="a11y-rule-head">
                  <span data-dtb-part="a11y-rule-id">{violation.rule}</span>
                  <Tag data-dtb-part="a11y-rule-nodes">
                    {violation.nodeCount} element{violation.nodeCount === 1 ? "" : "s"}
                  </Tag>
                  {violation.helpUrl === null ? null : (
                    <a href={violation.helpUrl} target="_blank" rel="noreferrer noopener">
                      why
                    </a>
                  )}
                </div>
                <p data-dtb-part="a11y-rule-help">{violation.help}</p>
                <ul data-dtb-part="a11y-nodes" data-dtb-kind="list">
                  {violation.nodes.map((node, index) => {
                    const key = selectionKey(violation.rule, index);
                    const selected = report.selected === key;
                    return (
                      <li
                        key={key}
                        data-dtb-part="a11y-node"
                        data-dtb-kind="row"
                        data-dtb-selected={selected ? "true" : "false"}
                      >
                        <Action
                          data-dtb-part="a11y-highlight"
                          aria-pressed={selected}
                          onClick={() => runtime.select(selected ? null : key)}
                        >
                          {selected ? "Hide" : "Highlight"}
                        </Action>
                        <code data-dtb-part="a11y-node-target">{node.target}</code>
                        <code data-dtb-part="a11y-node-html">{node.html}</code>
                        {node.summary === null ? null : (
                          <p data-dtb-part="a11y-node-summary">{node.summary}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {violation.truncated ? (
                  <Note data-dtb-part="a11y-truncated">
                    Showing {violation.nodes.length} of {violation.nodeCount} elements. The count is
                    exact; the list is capped.
                  </Note>
                ) : null}
              </article>
            ))}
          </section>
        ))}
      </div>

      <Note as="p" data-dtb-part="a11y-note">
        axe runs only when you ask. Element markup is masked before it reaches this panel, the
        clipboard or an agent — attribute values survive only for the attributes accessibility is
        about.
      </Note>
    </div>
  );
}

export interface SurfaceProps {
  runtime: A11yRuntime;
  injectStyles: boolean;
  styleNonce?: string;
}

/** Drawn from the `overlay` slot, so a collapsed chip does not take the highlight with it. */
export function A11ySurface({ runtime, injectStyles, styleNonce }: SurfaceProps): ReactNode {
  const { highlight } = useExtensionSurface(
    runtime.store,
    injectStyles,
    ensureA11yStyles,
    styleNonce,
  );
  if (highlight.length === 0) return null;

  return (
    <div data-dtb-part="a11y-surface" aria-hidden="true">
      {highlight.map((item) => (
        <Highlight key={item.key} item={item} />
      ))}
    </div>
  );
}

const BADGE_HEIGHT = 16;

function Highlight({ item }: { item: A11yHighlightView }): ReactNode {
  const above = item.rect.y >= BADGE_HEIGHT + 2;
  return (
    <>
      <div data-dtb-part="a11y-box" data-dtb-impact={item.impact} style={box(item.rect)} />
      <div
        data-dtb-part="a11y-badge"
        data-dtb-impact={item.impact}
        style={{
          left: `${Math.max(0, item.rect.x)}px`,
          top: above
            ? `${item.rect.y - BADGE_HEIGHT}px`
            : `${item.rect.y + item.rect.height + 2}px`,
        }}
      >
        {item.label}
      </div>
    </>
  );
}
