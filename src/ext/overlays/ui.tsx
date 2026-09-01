import { useEffect, useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode } from "react";
import { ensureOverlaysStyles } from "./css";
import { OVERLAY_IDS, OVERLAY_META } from "./types";
import type { FocusItem, GridSettings, HoverTarget, OverlaysSnapshot, RectLike } from "./types";
import type { OverlaysRuntime } from "./runtime";

/**
 * The rendered surfaces. [dev-toolbar/ext/overlays]
 *
 * Everything drawn over the application is **React**, inside the `overlay`
 * slot. That is the whole teardown story: there is no imperative DOM writing to
 * reverse, so switching an overlay off, hiding the bar, unmounting the toolbar
 * and a hot reload all leave the page exactly as they found it by construction
 * rather than by discipline. The one thing that is not React — the host-outline
 * stylesheet — lives in `runtime.ts`, where its removal is part of the same
 * teardown as the listeners.
 */

function useSnapshot(runtime: OverlaysRuntime): OverlaysSnapshot {
  return useSyncExternalStore(
    runtime.store.subscribe,
    runtime.store.getSnapshot,
    runtime.store.getSnapshot,
  );
}

function useOverlayStyles(inject: boolean): void {
  useEffect(() => {
    if (inject) ensureOverlaysStyles();
  }, [inject]);
}

const box = (rect: RectLike): CSSProperties => ({
  left: `${rect.x}px`,
  top: `${rect.y}px`,
  width: `${Math.max(rect.width, 0)}px`,
  height: `${Math.max(rect.height, 0)}px`,
});

/* -------------------------------------------------------------------------- */
/* Bar chip                                                                    */
/* -------------------------------------------------------------------------- */

export interface ChipProps {
  runtime: OverlaysRuntime;
  label: string;
  isOverflowed: boolean;
  isPanelOpen: boolean;
  injectStyles: boolean;
  onToggle(): void;
}

export function OverlaysChip({
  runtime,
  label,
  isOverflowed,
  isPanelOpen,
  injectStyles,
  onToggle,
}: ChipProps): ReactNode {
  useOverlayStyles(injectStyles);
  const snapshot = useSnapshot(runtime);
  const on = snapshot.activeCount > 0;
  const names = OVERLAY_IDS.filter((id) => snapshot.enabled[id]).map(
    (id) => OVERLAY_META[id].label,
  );

  return (
    <button
      type="button"
      data-dtb-part="trigger"
      aria-expanded={isPanelOpen}
      onClick={onToggle}
      title={
        on
          ? `${label}: ${names.join(", ")} — click to choose overlays`
          : `${label}: none on — click to choose overlays`
      }
    >
      <span data-dtb-part="ovl-chip" data-dtb-active={on ? "true" : "false"}>
        <span data-dtb-part="ovl-dot" aria-hidden="true" />
        <span>{isOverflowed ? label : "overlays"}</span>
        <span data-dtb-part="ovl-value">{on ? `${snapshot.activeCount} on` : "off"}</span>
        {snapshot.error === null ? null : <span data-dtb-part="ovl-tag">error</span>}
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                       */
/* -------------------------------------------------------------------------- */

export interface PanelProps {
  runtime: OverlaysRuntime;
  label: string;
  injectStyles: boolean;
}

export function OverlaysPanel({ runtime, label, injectStyles }: PanelProps): ReactNode {
  useOverlayStyles(injectStyles);
  const snapshot = useSnapshot(runtime);

  return (
    <div data-dtb-part="ovl-panel" aria-label={label}>
      {snapshot.error === null ? null : (
        <p data-dtb-part="ovl-error" role="alert">
          {snapshot.error}
        </p>
      )}

      <ul data-dtb-part="ovl-rows">
        {OVERLAY_IDS.map((id) => {
          const meta = OVERLAY_META[id];
          const on = snapshot.enabled[id] === true;
          return (
            <li
              key={id}
              data-dtb-part="ovl-row"
              data-dtb-overlay={id}
              data-dtb-on={on ? "true" : "false"}
            >
              <button
                type="button"
                data-dtb-part="ovl-toggle"
                role="switch"
                aria-checked={on}
                onClick={() => runtime.toggle(id)}
              >
                <span aria-hidden="true">{on ? "◉" : "○"}</span>
                <span>{meta.label}</span>
                {meta.touchesHost === true ? (
                  <span
                    data-dtb-part="ovl-tag"
                    title="This overlay adds one stylesheet to document.head while it is on. It is removed the moment it is switched off, when the bar is hidden, and on teardown."
                  >
                    stylesheet
                  </span>
                ) : null}
              </button>
              <p data-dtb-part="ovl-summary">{meta.summary}</p>
              <p data-dtb-part="ovl-cost">{meta.cost}</p>
              {id === "focus" && on ? (
                <p data-dtb-part="ovl-note" role="status">
                  {snapshot.focusItems.length} badge
                  {snapshot.focusItems.length === 1 ? "" : "s"} on screen, {snapshot.unnamedCount}{" "}
                  with no accessible name
                  {snapshot.focusTruncated
                    ? " — the scan stopped at the badge limit, so the numbering past that point is incomplete"
                    : ""}
                  . Names are computed by a documented heuristic, not the full accname algorithm;
                  treat a flag as a prompt to check, not a verdict.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div data-dtb-part="ovl-actions">
        <button
          type="button"
          data-dtb-part="trigger"
          disabled={snapshot.activeCount === 0}
          onClick={() => runtime.disableAll()}
        >
          Turn every overlay off
        </button>
        <span data-dtb-part="ovl-note" role="status">
          Nothing drawn here can be clicked: the surface is{" "}
          <code>pointer-events: none !important</code>, which no ordinary app rule can undo, and it
          paints below the bar — so a click reaches your page and the toolbar and palette are never
          covered.
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The drawing surface                                                         */
/* -------------------------------------------------------------------------- */

export interface SurfaceProps {
  runtime: OverlaysRuntime;
  injectStyles: boolean;
}

/**
 * Rendered by the `overlay` slot on every toolbar render; `null` whenever no
 * overlay is on, which is the common case.
 */
export function OverlaysSurface({ runtime, injectStyles }: SurfaceProps): ReactNode {
  useOverlayStyles(injectStyles);
  const snapshot = useSnapshot(runtime);
  if (snapshot.activeCount === 0) return null;

  const drawsSomething =
    snapshot.enabled.grid ||
    (snapshot.enabled.inspect && snapshot.hover !== null) ||
    (snapshot.enabled.focus && snapshot.focusItems.length > 0);
  // `boxes` draws through its stylesheet, not here, so a surface with only
  // `boxes` on has nothing to render — and an empty fixed div, even a
  // transparent one, is a thing that can go wrong for no benefit.
  if (!drawsSomething) return null;

  return (
    <div data-dtb-part="ovl-surface" aria-hidden="true">
      {snapshot.enabled.grid ? <Grid grid={runtime.grid} /> : null}
      {snapshot.enabled.inspect && snapshot.hover !== null ? (
        <Inspector hover={snapshot.hover} />
      ) : null}
      {snapshot.enabled.focus ? (
        <>
          {snapshot.focusItems.map((item) => (
            <FocusBadge key={item.key} item={item} />
          ))}
          {snapshot.focusTruncated ? (
            <div data-dtb-part="ovl-notice">
              focus order: stopped at {snapshot.focusItems.length}+ elements
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Grid({ grid }: { grid: GridSettings }): ReactNode {
  const column = `calc((100% - ${grid.gutter * (grid.columns - 1)}px) / ${grid.columns})`;
  return (
    <div data-dtb-part="ovl-grid">
      <div
        data-dtb-part="ovl-grid-columns"
        style={{
          width: `min(${grid.maxWidth}px, 100%)`,
          backgroundImage: `repeating-linear-gradient(to right, rgba(255, 64, 129, 0.12) 0, rgba(255, 64, 129, 0.12) ${column}, transparent ${column}, transparent calc(${column} + ${grid.gutter}px))`,
        }}
      />
      {grid.baseline > 0 ? (
        <div
          data-dtb-part="ovl-grid-baseline"
          style={{
            backgroundImage: `repeating-linear-gradient(to bottom, rgba(255, 64, 129, 0.16) 0, rgba(255, 64, 129, 0.16) 1px, transparent 1px, transparent ${grid.baseline}px)`,
          }}
        />
      ) : null}
    </div>
  );
}

const LABEL_HEIGHT = 18;

function Inspector({ hover }: { hover: HoverTarget }): ReactNode {
  const { rect, margin, padding } = hover;

  const marginBox: RectLike = {
    x: rect.x - margin.left,
    y: rect.y - margin.top,
    width: rect.width + margin.left + margin.right,
    height: rect.height + margin.top + margin.bottom,
  };
  const contentBox: RectLike = {
    x: rect.x + padding.left,
    y: rect.y + padding.top,
    width: rect.width - padding.left - padding.right,
    height: rect.height - padding.top - padding.bottom,
  };

  // Above the box when there is room, below it otherwise, and never off the
  // left edge. The label is the only part of the overlay a stationary pointer
  // sees move, so it must not jitter across the boundary: `>=` on a rounded
  // rect, not a fractional comparison.
  const above = rect.y >= LABEL_HEIGHT + 4;
  const labelStyle: CSSProperties = {
    left: `${Math.max(2, rect.x)}px`,
    top: above ? `${rect.y - LABEL_HEIGHT - 2}px` : `${rect.y + rect.height + 2}px`,
  };

  const showPadding =
    padding.top + padding.right + padding.bottom + padding.left > 0 &&
    contentBox.width > 0 &&
    contentBox.height > 0;
  const showMargin = margin.top + margin.right + margin.bottom + margin.left > 0;

  return (
    <>
      {showMargin ? (
        <div data-dtb-part="ovl-box" data-dtb-box="margin" style={box(marginBox)} />
      ) : null}
      <div data-dtb-part="ovl-box" data-dtb-box="border" style={box(rect)} />
      {showPadding ? (
        <div data-dtb-part="ovl-box" data-dtb-box="content" style={box(contentBox)} />
      ) : null}
      <div data-dtb-part="ovl-label" style={labelStyle}>
        <span data-dtb-part="ovl-label-target">{hover.description}</span>
        <span data-dtb-part="ovl-label-size">{hover.size}</span>
        {hover.name === null ? (
          <span data-dtb-part="ovl-label-note">no accessible name</span>
        ) : (
          <span data-dtb-part="ovl-label-name">
            {hover.name.length > 40 ? `${hover.name.slice(0, 40)}…` : hover.name}
          </span>
        )}
        {hover.role === null ? null : <span data-dtb-part="ovl-label-note">role={hover.role}</span>}
        {hover.pinned ? <span data-dtb-part="ovl-label-note">fixed</span> : null}
      </div>
    </>
  );
}

function FocusBadge({ item }: { item: FocusItem }): ReactNode {
  const named = item.name !== null;
  return (
    <>
      <div
        data-dtb-part="ovl-focus-box"
        data-dtb-named={named ? "true" : "false"}
        style={box(item.rect)}
      />
      <div
        data-dtb-part="ovl-focus-badge"
        data-dtb-named={named ? "true" : "false"}
        data-dtb-focus-index={item.index}
        style={{
          left: `${Math.max(0, item.rect.x)}px`,
          top: `${Math.max(0, item.rect.y - 14)}px`,
        }}
      >
        <span>{item.index}</span>
        {item.tabIndex !== null && item.tabIndex > 0 ? <span>tabindex={item.tabIndex}</span> : null}
        <span>
          {named
            ? (item.name as string).length > 24
              ? `${(item.name as string).slice(0, 24)}…`
              : (item.name as string)
            : `${item.tag} — unnamed`}
        </span>
      </div>
    </>
  );
}
