import { useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Sparkline } from "./Sparkline";
import { writeClipboardText } from "../../runtime";
import { useExtensionSurface } from "../shared/hooks";
import { ensureMetricsStyles } from "./css";
import { formatBytes, formatMs, shortenUrl } from "./format";
import type { MetricsRuntime } from "./runtime";
import type { MetricId, MetricsSnapshot } from "./types";

/**
 * The rendered surface. [dev-toolbar/ext/metrics]
 *
 * Slot functions must be cheap, so they just return these components, which
 * subscribe to the metrics store themselves and re-render only when it
 * publishes (at most `updateHz` times a second).
 */

export interface ChipsProps {
  runtime: MetricsRuntime;
  isOverflowed: boolean;
  isPanelOpen: boolean;
  injectStyles: boolean;
  onToggle(): void;
}

export function MetricsChips({
  runtime,
  isOverflowed,
  isPanelOpen,
  injectStyles,
  onToggle,
}: ChipsProps): ReactNode {
  const snapshot = useExtensionSurface(runtime.store, injectStyles, ensureMetricsStyles);

  // In the ··· menu there's vertical room, so spell metrics out instead of shrinking them.
  if (isOverflowed) {
    return (
      <div data-dtb-part="metrics-overflow-list">
        {snapshot.order.map((id) => {
          const view = snapshot.views[id];
          return (
            <button
              key={id}
              type="button"
              data-dtb-part="metrics-overflow-row"
              data-dtb-metric={id}
              data-dtb-severity={view.severity}
              onClick={onToggle}
              title={view.hint}
            >
              <span data-dtb-part="metrics-chip">
                <span data-dtb-part="metrics-dot" aria-hidden="true" />
                <span data-dtb-part="metrics-label">{view.title}</span>
              </span>
              <span data-dtb-part="metrics-value">{view.display}</span>
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
      onClick={onToggle}
      title="Runtime performance — click for details"
    >
      <span data-dtb-part="metrics-chips">
        {snapshot.order.map((id) => {
          const view = snapshot.views[id];
          return (
            <span
              key={id}
              data-dtb-part="metrics-chip"
              data-dtb-metric={id}
              data-dtb-severity={view.severity}
            >
              <span data-dtb-part="metrics-dot" aria-hidden="true" />
              <span data-dtb-part="metrics-label">{view.label}</span>
              <span data-dtb-part="metrics-value">{view.display}</span>
            </span>
          );
        })}
      </span>
    </button>
  );
}

export interface PanelProps {
  runtime: MetricsRuntime;
  injectStyles: boolean;
}

const STORAGE_TAB_KEY = "tab";

export function MetricsPanel({ runtime, injectStyles }: PanelProps): ReactNode {
  const snapshot = useExtensionSurface(runtime.store, injectStyles, ensureMetricsStyles);
  const first = snapshot.order[0] ?? "memory";
  const idPrefix = `dtb-metrics-${useId().replace(/:/g, "")}`;
  const tabRefs = useRef<Partial<Record<MetricId, HTMLButtonElement | null>>>({});
  // start(api) has already run by the time a panel can open, so the
  // persisted tab is readable here.
  const [active, setActive] = useState<MetricId>(() => {
    const stored = runtime.storage()?.getItem(STORAGE_TAB_KEY);
    return stored && snapshot.order.includes(stored as MetricId) ? (stored as MetricId) : first;
  });
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");

  const select = (id: MetricId) => {
    setActive(id);
    runtime.storage()?.setItem(STORAGE_TAB_KEY, id);
  };

  const view = snapshot.views[snapshot.order.includes(active) ? active : first];
  const collector = runtime.collectors.find((entry) => entry.id === view.id);
  const tabId = (id: MetricId) => `${idPrefix}-tab-${id}`;
  const metricsPanelId = `${idPrefix}-panel`;
  const focusTab = (id: MetricId | undefined) => {
    if (id === undefined) return;
    select(id);
    tabRefs.current[id]?.focus();
  };

  const moveTab = (id: MetricId, offset: number) => {
    const index = snapshot.order.indexOf(id);
    const nextIndex = (index + offset + snapshot.order.length) % snapshot.order.length;
    focusTab(snapshot.order[nextIndex]);
  };

  const copy = () => {
    const text = JSON.stringify(runtime.diagnostics(), null, 2);
    void writeClipboardText(text).then((ok) => setCopied(ok ? "ok" : "failed"));
  };

  return (
    <div data-dtb-part="metrics-panel" data-dtb-severity={view.severity}>
      <div data-dtb-part="metrics-tabs" role="tablist" aria-label="Metrics">
        {snapshot.order.map((id) => {
          const tab = snapshot.views[id];
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
              <span data-dtb-part="metrics-dot" aria-hidden="true" />
              {tab.title}
            </button>
          );
        })}
      </div>

      <div
        id={metricsPanelId}
        data-dtb-part="metrics-section"
        data-dtb-metric={view.id}
        role="tabpanel"
        aria-labelledby={tabId(view.id)}
      >
        <div data-dtb-part="metrics-headline">
          <span data-dtb-part="metrics-headline-value">{view.display}</span>
          <span data-dtb-part="metrics-note">{view.unit}</span>
          {view.status === "unsupported" ? (
            <span data-dtb-part="metrics-note">— unsupported here</span>
          ) : null}
        </div>

        <p data-dtb-part="metrics-hint">{view.hint}</p>

        {collector && view.status === "ok" ? (
          <Sparkline series={collector.series} revision={snapshot.revision} label={view.title} />
        ) : null}

        {view.detail.length > 0 ? (
          <dl data-dtb-part="metrics-rows">
            {view.detail.map(([label, value]) => (
              <Row key={label} label={label} value={value} />
            ))}
          </dl>
        ) : null}

        {view.id === "network" ? <RequestTable requests={snapshot.requests} /> : null}

        {collector ? (
          <p data-dtb-part="metrics-note">Collector cost: {collector.estimatedCost}.</p>
        ) : null}
      </div>

      <div data-dtb-part="metrics-actions">
        <button
          type="button"
          data-dtb-part="metrics-action"
          data-dtb-action="reset"
          onClick={() => runtime.reset()}
        >
          Reset
        </button>
        <button type="button" data-dtb-part="metrics-action" data-dtb-action="copy" onClick={copy}>
          Copy diagnostic data
        </button>
        <span data-dtb-part="metrics-note" role="status">
          {copied === "ok"
            ? "Copied — URLs and credential-shaped values are masked."
            : copied === "failed"
              ? "Clipboard unavailable."
              : "URLs and credential-shaped values are masked before this leaves the page. Read it before you paste it."}
        </span>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function RequestTable({ requests }: { requests: MetricsSnapshot["requests"] }): ReactNode {
  if (requests.length === 0) {
    return <p data-dtb-part="metrics-note">No requests observed yet.</p>;
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
