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
 * `resolveCompactControl` and `renderCompact`. A consumer's `render` supplies
 * only the chip's children — the metric's `data-dtb-metric`/severity, the chip
 * and its dot stay outside its reach, in the `⋮` menu as in the bar (ADR-004).
 * The `⋮` row's value span keeps its position outside the chip but not its
 * painting: `render` owns icon, text and value in both places, so the row
 * drops the span when a callback painted. Pinned in
 * `__tests__/presentation.test.tsx`.
 */

/**
 * Today's two trees, expressed as parts — what `resolveCompactControl` falls
 * back to under `"default"`. The bar paints the short label plus value, a `⋮`
 * row the full title plus value, neither paints an icon, so "default output is
 * byte-identical" stays structural rather than asserted.
 */
const DEFAULTS: CompactDefaults = {
  bar: { icon: false, text: "short", value: true },
  overflow: { icon: false, text: "full", value: true },
};

/**
 * The icon and text as the chip's children, not `Chip`'s `icon`/`label`/
 * `value` slots (`docs/adr/ADR-004-per-extension-bar-presentation.md`). Same
 * construction in the bar and the `⋮` menu — only the value node differs, so
 * only it is written twice.
 *
 * `labelId` is the bar's alone: the trigger's `aria-describedby` pairs each
 * chip's label with its value, which needs an `id` to point at. The `⋮` rows
 * pass none — each row is one metric, named by its own content.
 */
function iconAndText(
  view: MetricView,
  parts: CompactParts,
  icon: ReactNode,
  labelId?: string,
): ReactNode {
  return renderCompactParts({
    parts,
    icon,
    iconProps: { "data-dtb-part": "metrics-icon" },
    short: view.label,
    full: view.title,
    textProps: {
      "data-dtb-part": "metrics-label",
      "data-dtb-kind": "label",
      // Appended last, so the documented attribute order is untouched.
      ...(labelId === undefined ? {} : { id: labelId }),
    },
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

  // Ids for the spans `aria-describedby` points at, from `useId()` (as
  // `MetricsPanel` below already does) rather than the extension id — two
  // `<DevToolbar>` instances on one page would otherwise share ids and
  // `aria-describedby` would resolve to the other instance's span.
  const idPrefix = `dtb-metrics-${useId().replace(/:/g, "")}`;
  const valueId = (id: CollectorId) => `${idPrefix}-value-${id}`;
  const labelId = (id: CollectorId) => `${idPrefix}-label-${id}`;

  const named = snapshot.order[0];
  // WCAG 2.5.3 Label in Name: the bar paints each collector's short, hardcoded
  // word (`mem`, `net`), so the name must contain it. Being config-derived
  // rather than value-derived, the name doesn't churn as the numbers move; the
  // numbers themselves reach a screen reader through `aria-describedby`
  // below. With no metrics there is no view, so `label` stands alone.
  const triggerName =
    named === undefined
      ? label
      : resolveAccessibleName(
          presentation.name,
          metricView(snapshot, named),
          `${label}: ${snapshot.order.map((id) => metricView(snapshot, id).label).join(", ")}`,
        );

  // In the ⋮ menu there's vertical room, so spell metrics out instead of shrinking them.
  if (isOverflowed) {
    return (
      <div data-dtb-part="metrics-overflow-list">
        {snapshot.order.map((id) => {
          const view = metricView(snapshot, id);
          const control = resolveCompactControl(presentation, view, {
            isOverflowed: true,
            defaults: DEFAULTS,
          });
          // A row is named by its content, not an `aria-label` of its own
          // (naming them by default is a separate, open decision — ADR-004),
          // so this writes the attribute only when the consumer supplied one.
          const rowName = resolveNameOverride(presentation.name, view);
          const fallback = iconAndText(view, control.parts, control.icon);
          // `renderCompact` returns this exact `fallback` reference when there
          // is no callback or it returned `undefined`, so `=== fallback` below
          // means "the consumer did not paint here" — including when a
          // callback deliberately returns `ctx.fallback`.
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
              {/* The chip and its dot sit outside the callback's reach, as in
                  the bar: a preset (and a callback) changes text, not state. */}
              <Chip
                severity={view.severity}
                data-dtb-part="metrics-chip"
                dotProps={{ "data-dtb-part": "metrics-dot" }}
              >
                {rendered}
              </Chip>
              {/* Outside the chip, as this row has always shipped, but `render`
                  still owns the value — a naive callback would otherwise
                  duplicate the readout (e.g. "48 MB used48 MB") — so it paints
                  only when `renderCompact` fell through to the fallback.
                  Both attribute orders are pinned in
                  `__tests__/presentation.test.tsx`. */}
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

  // Built above the tree, not inside the map, because the button needs to
  // know which value spans got painted before it can point at them.
  const chips = snapshot.order.map((id) => {
    const view = metricView(snapshot, id);
    const control = resolveCompactControl(presentation, view, {
      isOverflowed: false,
      defaults: DEFAULTS,
    });
    const fallback = (
      <>
        {iconAndText(view, control.parts, control.icon, labelId(id))}
        {/* The order `Chip`'s own value slot wrote before this moved into
            the chip's children: kind, severity, then the site's props — with
            the `aria-describedby` target id appended last, so the documented
            order is untouched. */}
        {control.parts.value ? (
          <span
            data-dtb-kind="value"
            data-dtb-severity={view.severity}
            data-dtb-part="metrics-value"
            id={valueId(id)}
          >
            {view.display}
          </span>
        ) : null}
      </>
    );
    const rendered = renderCompact(
      presentation,
      view,
      { icon: control.icon, isOverflowed: false, isPanelOpen },
      fallback,
    );
    return { id, view, control, fallback, rendered };
  });

  // Pairs each chip's label id with its value id rather than pointing at
  // values alone: a bare "22 MB — — 0" asks the listener to match numbers
  // positionally against the name, and a collector this browser can't
  // support has no number to place at all. Measured against the real bar in
  // Chromium: pairing reads as "mem 22 MB delay — jank — net 0", the same
  // utterance as pointing at the chips themselves, but gated by the value
  // span rather than by whatever a `render` callback painted.
  const describedBy = chips
    .flatMap((chip) => {
      if (chip.rendered !== chip.fallback || !chip.control.parts.value) return [];
      const value = valueId(chip.id);
      return chip.control.parts.text === "none" ? [value] : [labelId(chip.id), value];
    })
    .join(" ");

  return (
    <button
      type="button"
      data-dtb-part="trigger"
      aria-expanded={isPanelOpen}
      // Identity plus the visible short words, never the numbers (WCAG
      // 2.5.3) — a name derived from the values would re-speak on every
      // focus. The numbers are described instead, by the `aria-describedby`
      // built above. `presentation.name` overrides this, invoked with the
      // first metric in bar order; with no metrics, `label` stands.
      aria-label={triggerName}
      {...(describedBy === "" ? {} : { "aria-describedby": describedBy })}
      onClick={onToggle}
      title="Runtime performance — click for details"
    >
      <span data-dtb-part="metrics-chips">
        {chips.map(({ id, view, rendered }) => (
          <Chip
            key={id}
            severity={view.severity}
            data-dtb-part="metrics-chip"
            data-dtb-metric={id}
            data-dtb-severity={view.severity}
            dotProps={{ "data-dtb-part": "metrics-dot" }}
          >
            {rendered}
          </Chip>
        ))}
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
