import { useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Sparkline } from "./Sparkline";
import {
  Action,
  Chip,
  CopyButton,
  Note,
  Row,
  Rows,
  renderCompact,
  renderCompactParts,
  resolveAccessibleName,
  resolveCompactControl,
  resolveNameOverride,
  useExtensionSurface,
} from "@nejcm/dev-toolbar/kit";
import type {
  CompactDefaults,
  CompactParts,
  ResolvedCompactPresentation,
} from "@nejcm/dev-toolbar/kit";
import { ensureMetricsStyles } from "./css";
import { formatBytes, formatMs, shortenUrl } from "./format";
import type { MetricsRuntime } from "./runtime";
import { metricView } from "./types";
import type { CollectorId, MetricView, MetricsSnapshot } from "./types";

/**
 * The rendered surface. [dev-toolbar/ext/metrics]
 *
 * Slot functions must be cheap, so they just return these components, which
 * subscribe to the metrics store themselves and re-render only when it
 * publishes (at most `updateHz` times a second).
 *
 * `presentation` arrives already resolved and is read through `/kit`'s
 * `resolveCompactControl` and `renderCompact`, so the `hasIcon` guard, the
 * `"default"` fallback, the `CompactRenderContext` and the `undefined`
 * fall-through live in one place for all nine extensions rather than nine.
 * What stays here is the DOM: a consumer's `render` supplies the *chip's*
 * children in both places, so the element carrying that metric's
 * `data-dtb-metric` and `data-dtb-severity`, the chip and its severity dot all
 * sit outside the callback's reach — in the `⋮` menu exactly as in the bar and
 * in the five Group A chips. A preset changes text, not state, and neither does
 * a callback (ADR-004). The `⋮` row's value span keeps the *position* it has
 * always had, outside the chip — but not the painting: `render` owns icon, text
 * and value in both places, so the row drops the span when a callback painted,
 * exactly as the bar does by having the span inside the chip. Pinned in
 * `__tests__/presentation.test.tsx`.
 */

/**
 * Today's two trees, expressed as parts.
 *
 * `resolveCompactControl` answers the preset's parts, or these when the preset
 * is `"default"` — which is why they are handed in rather than known to kit:
 * `"default"` means *whatever this extension renders today*, and that differs
 * across the nine. Metrics' defaults happen to be exactly expressible as parts
 * — the bar paints the short label and the value, a `⋮` row the full title and
 * the value, and neither paints an icon — so the fork is a fallback rather than
 * a second tree, and "the default output is byte-identical" stays a structural
 * property rather than a claim.
 */
const DEFAULTS: CompactDefaults = {
  bar: { icon: false, text: "short", value: true },
  overflow: { icon: false, text: "full", value: true },
};

/**
 * The icon and the text — the two parts the bar chip and the `⋮` row paint
 * identically. Only the value node differs between them, so only it is written
 * twice.
 *
 * These are the chip's *children* rather than `Chip`'s `icon` / `label` /
 * `value` slots, and deliberately: it is the one construction, handed to a
 * `render` callback as `ctx.fallback` and rendered when there is none, so
 * deferring to the preset is exact by construction instead of by two pieces of
 * markup kept in step. `Chip` renders its children straight after the dot, in
 * the slots' own position, so nothing about the surrounding output moves. The
 * fragment itself is kit's `renderCompactParts` — six extensions wrote it
 * identically, so it is one function now, and the `(short, full)` pair it takes
 * is this extension's per-metric `label`/`title` rather than a module constant.
 */
function iconAndText(view: MetricView, parts: CompactParts, icon: ReactNode): ReactNode {
  return renderCompactParts({
    parts,
    icon,
    iconProps: { "data-dtb-part": "metrics-icon" },
    short: view.label,
    full: view.title,
    textProps: { "data-dtb-part": "metrics-label", "data-dtb-kind": "label" },
  });
}

export interface ChipsProps {
  runtime: MetricsRuntime;
  label: string;
  /** Already through `resolvePresentation`, in the factory closure. */
  presentation: ResolvedCompactPresentation<MetricView>;
  isOverflowed: boolean;
  isPanelOpen: boolean;
  injectStyles: boolean;
  styleNonce?: string;
  onToggle(): void;
}

export function MetricsChips({
  runtime,
  label,
  presentation,
  isOverflowed,
  isPanelOpen,
  injectStyles,
  styleNonce,
  onToggle,
}: ChipsProps): ReactNode {
  const snapshot = useExtensionSurface(
    runtime.store,
    injectStyles,
    ensureMetricsStyles,
    styleNonce,
  );

  const named = snapshot.order[0];
  const triggerName =
    named === undefined
      ? label
      : resolveAccessibleName(presentation.name, metricView(snapshot, named), label);

  // In the ⋮ menu there's vertical room, so spell metrics out instead of
  // shrinking them — which is what the overflow rule already forces on every
  // preset, so this branch differs from the bar only in its DOM.
  if (isOverflowed) {
    return (
      <div data-dtb-part="metrics-overflow-list">
        {snapshot.order.map((id) => {
          const view = metricView(snapshot, id);
          const control = resolveCompactControl(presentation, view, {
            isOverflowed: true,
            defaults: DEFAULTS,
          });
          // One text override per row, not one per trigger: the bar button is
          // one control naming N metrics, a `⋮` row *is* one metric. A row
          // carries no `aria-label` of its own — it is named by its content, and
          // ADR-004 leaves naming these rows outright a separate, open decision
          // — so this writes the attribute only when the consumer supplied a
          // name that says something, and writes nothing otherwise.
          const rowName = resolveNameOverride(presentation.name, view);
          const fallback = iconAndText(view, control.parts, control.icon);
          // Invoked once, above the tree, because the value span below has to
          // know whether it ran. `renderCompact` returns *this* `fallback`
          // reference — not a copy — when there is no callback and when the
          // callback returned `undefined`, so `=== fallback` is exactly "the
          // consumer did not paint here". A callback that deliberately returns
          // `ctx.fallback` lands in the same branch, which is what it asked for:
          // "paint what the preset would have".
          const rendered = renderCompact(
            presentation,
            view,
            { icon: control.icon, isOverflowed: true, isPanelOpen },
            fallback,
          );
          return (
            <button
              key={id}
              type="button"
              data-dtb-part="metrics-overflow-row"
              data-dtb-metric={id}
              data-dtb-severity={view.severity}
              {...(rowName === undefined ? {} : { "aria-label": rowName })}
              onClick={onToggle}
              title={view.hint}
            >
              {/* The chip and its dot sit outside the callback's reach, exactly
                  as they do in the bar and in the five Group A chips: the dot is
                  severity — state, not text — and a preset changes text, not
                  state (ADR-004). So `render` supplies the chip's *children*
                  here, which is the icon and the text. */}
              <Chip
                severity={view.severity}
                data-dtb-part="metrics-chip"
                dotProps={{ "data-dtb-part": "metrics-dot" }}
              >
                {rendered}
              </Chip>
              {/* Outside the chip, as this row has always shipped — the chip is
                  where the dot and the severity attributes live, and those are
                  not a callback's to lose. But `render` still owns the icon, the
                  text *and* the value, here as in the bar: the bar's value span
                  sits inside the chip and so is replaced, and a row that painted
                  it anyway would duplicate the readout for the most ordinary
                  callback there is — `render: (m) => <b>{m.display} used</b>`
                  reads "48 MB used48 MB". So the span is the preset's to drop
                  and the callback's to replace, and it paints only when
                  `renderCompact` fell through to the fallback. Attribute order
                  is this row's own, not the bar chip's below; both are pinned as
                  literal strings in `__tests__/presentation.test.tsx`. */}
              {control.parts.value && rendered === fallback ? (
                <span
                  data-dtb-part="metrics-value"
                  data-dtb-kind="value"
                  data-dtb-severity={view.severity}
                >
                  {view.display}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-dtb-part="trigger"
      aria-expanded={isPanelOpen}
      // Named after the extension, not the readout: the bar chips are the only
      // thing naming this button today, so a screen reader hears the numbers
      // and never the control. A name that churns with the values would also
      // re-speak on every focus. The values stay the chips' visible text and
      // the panel's. `title` explains; it does not name.
      // `presentation.name` overrides it, and a whitespace-only override is
      // ignored so no override can leave the trigger unnamed. One button names N
      // metrics, so the override is invoked with the first metric in bar order —
      // it names the control, and the argument is there for symmetry with the
      // other three knobs. With no metrics at all there is no view to pass, and
      // `label` stands.
      aria-label={triggerName}
      onClick={onToggle}
      title="Runtime performance — click for details"
    >
      <span data-dtb-part="metrics-chips">
        {snapshot.order.map((id) => {
          const view = metricView(snapshot, id);
          const control = resolveCompactControl(presentation, view, {
            isOverflowed: false,
            defaults: DEFAULTS,
          });
          const fallback = (
            <>
              {iconAndText(view, control.parts, control.icon)}
              {/* The order `Chip`'s own value slot wrote before this moved into
                  the chip's children: kind, severity, then the site's props. */}
              {control.parts.value ? (
                <span
                  data-dtb-kind="value"
                  data-dtb-severity={view.severity}
                  data-dtb-part="metrics-value"
                >
                  {view.display}
                </span>
              ) : null}
            </>
          );
          return (
            <Chip
              key={id}
              severity={view.severity}
              data-dtb-part="metrics-chip"
              data-dtb-metric={id}
              data-dtb-severity={view.severity}
              dotProps={{ "data-dtb-part": "metrics-dot" }}
            >
              {renderCompact(
                presentation,
                view,
                { icon: control.icon, isOverflowed: false, isPanelOpen },
                fallback,
              )}
            </Chip>
          );
        })}
      </span>
    </button>
  );
}

export interface PanelProps {
  runtime: MetricsRuntime;
  injectStyles: boolean;
  styleNonce?: string;
}

export function MetricsPanel({ runtime, injectStyles, styleNonce }: PanelProps): ReactNode {
  const snapshot = useExtensionSurface(
    runtime.store,
    injectStyles,
    ensureMetricsStyles,
    styleNonce,
  );
  const first = snapshot.order[0] ?? "memory";
  const idPrefix = `dtb-metrics-${useId().replace(/:/g, "")}`;
  const tabRefs = useRef<Partial<Record<CollectorId, HTMLButtonElement | null>>>(
    Object.create(null),
  );
  // start(api) has already run by the time a panel can open, so the
  // persisted tab is readable here.
  const [active, setActive] = useState<CollectorId>(() => runtime.readTab() ?? first);

  const select = (id: CollectorId) => {
    setActive(id);
    runtime.writeTab(id);
  };

  const view = metricView(snapshot, snapshot.order.includes(active) ? active : first);
  const collector = runtime.collectors.find((entry) => entry.id === view.id);
  const tabId = (id: CollectorId) => `${idPrefix}-tab-${id}`;
  const metricsPanelId = `${idPrefix}-panel`;
  const focusTab = (id: CollectorId | undefined) => {
    if (id === undefined) return;
    select(id);
    tabRefs.current[id]?.focus();
  };

  const moveTab = (id: CollectorId, offset: number) => {
    const index = snapshot.order.indexOf(id);
    const nextIndex = (index + offset + snapshot.order.length) % snapshot.order.length;
    focusTab(snapshot.order[nextIndex]);
  };

  return (
    <div data-dtb-part="metrics-panel" data-dtb-severity={view.severity}>
      <div data-dtb-part="metrics-tabs" data-dtb-bleed="" role="tablist" aria-label="Metrics">
        {snapshot.order.map((id) => {
          const tab = metricView(snapshot, id);
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={tabId(id)}
              data-dtb-part="metrics-tab"
              data-dtb-metric={id}
              data-dtb-severity={tab.severity}
              aria-selected={tab.id === view.id}
              aria-controls={metricsPanelId}
              tabIndex={tab.id === view.id ? 0 : -1}
              ref={(node) => {
                tabRefs.current[id] = node;
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                  event.preventDefault();
                  moveTab(id, 1);
                } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                  event.preventDefault();
                  moveTab(id, -1);
                } else if (event.key === "Home") {
                  event.preventDefault();
                  focusTab(snapshot.order[0]);
                } else if (event.key === "End") {
                  event.preventDefault();
                  focusTab(snapshot.order[snapshot.order.length - 1]);
                }
              }}
              onClick={() => select(id)}
            >
              <span
                data-dtb-part="metrics-dot"
                data-dtb-kind="dot"
                data-dtb-severity={tab.severity}
                aria-hidden="true"
              />
              {tab.title}
            </button>
          );
        })}
      </div>

      <div
        id={metricsPanelId}
        data-dtb-part="metrics-section"
        data-dtb-bleed=""
        data-dtb-metric={view.id}
        role="tabpanel"
        aria-labelledby={tabId(view.id)}
      >
        <div data-dtb-part="metrics-headline">
          <span data-dtb-part="metrics-headline-value" data-dtb-kind="value">
            {view.display}
          </span>
          <Note as="span" data-dtb-part="metrics-note">
            {view.unit}
          </Note>
          {view.status === "unsupported" ? (
            <Note as="span" data-dtb-part="metrics-note">
              — unsupported here
            </Note>
          ) : null}
        </div>

        <p data-dtb-part="metrics-hint">{view.hint}</p>

        {collector && view.status === "ok" ? (
          <Sparkline series={collector.series} revision={snapshot.revision} label={view.title} />
        ) : null}

        {view.detail.length > 0 ? (
          <Rows data-dtb-part="metrics-rows">
            {view.detail.map(([label, value]) => (
              <Row key={label} label={label}>
                {value}
              </Row>
            ))}
          </Rows>
        ) : null}

        {view.id === "network" ? <RequestTable requests={snapshot.requests} /> : null}

        {collector ? (
          <Note data-dtb-part="metrics-note">Collector cost: {collector.estimatedCost}.</Note>
        ) : null}
      </div>

      <div data-dtb-part="metrics-actions" data-dtb-bleed="">
        <Action
          data-dtb-part="metrics-action"
          data-dtb-action="reset"
          onClick={() => runtime.reset()}
        >
          Reset
        </Action>
        <CopyButton
          text={() => JSON.stringify(runtime.diagnostics(), null, 2)}
          statusText={{
            ok: "Copied — URLs and credential-shaped values are masked.",
            failed: "Clipboard unavailable.",
            idle: "URLs and credential-shaped values are masked before this leaves the page. Read it before you paste it.",
          }}
          statusProps={{ "data-dtb-part": "metrics-note" }}
          data-dtb-part="metrics-action"
          data-dtb-action="copy"
        >
          Copy diagnostic data
        </CopyButton>
      </div>
    </div>
  );
}

function RequestTable({ requests }: { requests: MetricsSnapshot["requests"] }): ReactNode {
  if (requests.length === 0) {
    return <Note data-dtb-part="metrics-note">No requests observed yet.</Note>;
  }
  return (
    <table data-dtb-part="metrics-requests">
      <thead>
        <tr>
          <th scope="col">Method</th>
          <th scope="col">Status</th>
          <th scope="col">Time</th>
          <th scope="col">Size</th>
          <th scope="col">URL</th>
        </tr>
      </thead>
      <tbody>
        {requests.slice(0, 30).map((request) => (
          <tr key={request.id} data-dtb-state={request.state}>
            <td>{request.method}</td>
            <td>{request.status ?? request.state}</td>
            <td>{formatMs(request.duration)}</td>
            <td>{request.bytes === undefined ? "—" : formatBytes(request.bytes, 1)}</td>
            <td data-dtb-url="">{shortenUrl(request.url, 96)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
