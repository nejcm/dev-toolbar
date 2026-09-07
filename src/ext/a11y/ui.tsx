import type { CSSProperties, ReactNode } from "react";
import {
  Action,
  Banner,
  Chip,
  EmptyState,
  Note,
  Row,
  Rows,
  Tag,
  useExtensionSurface,
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

export interface ChipProps {
  runtime: A11yRuntime;
  label: string;
  isOverflowed: boolean;
  isPanelOpen: boolean;
  injectStyles: boolean;
  styleNonce?: string;
  onToggle(): void;
}

export function A11yChip({
  runtime,
  label,
  isOverflowed,
  isPanelOpen,
  injectStyles,
  styleNonce,
  onToggle,
}: ChipProps): ReactNode {
  const { report } = useExtensionSurface(runtime.store, injectStyles, ensureA11yStyles, styleNonce);
  const accessibleLabel =
    report.status === "ok"
      ? `${label}, ${report.total} violation${report.total === 1 ? "" : "s"}`
      : `${label}, ${report.status}`;

  return (
    <button
      type="button"
      data-dtb-part="trigger"
      aria-expanded={isPanelOpen}
      aria-label={accessibleLabel}
      onClick={onToggle}
      title={
        report.status === "unsupported"
          ? `${label}: axe-core is not installed`
          : `${label}: click to scan this page`
      }
    >
      <Chip
        label={isOverflowed ? label : "a11y"}
        value={chipValue(report)}
        severity={chipSeverity(report)}
        data-dtb-part="a11y-chip"
        data-dtb-status={report.status}
        dotProps={{ "data-dtb-part": "a11y-dot" }}
        valueProps={{ "data-dtb-part": "a11y-value" }}
      />
    </button>
  );
}

export interface PanelProps {
  runtime: A11yRuntime;
  label: string;
  injectStyles: boolean;
  styleNonce?: string;
}

export function A11yPanel({ runtime, label, injectStyles, styleNonce }: PanelProps): ReactNode {
  const { report } = useExtensionSurface(runtime.store, injectStyles, ensureA11yStyles, styleNonce);
  const unsupported = report.status === "unsupported";

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
