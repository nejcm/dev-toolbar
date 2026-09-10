import { useLayoutEffect } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Banner,
  Chip,
  Glyph,
  Note,
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
import { ensureOverlaysStyles } from "./css";
import { OVERLAY_IDS, OVERLAY_META } from "./types";
import type { FocusItem, GridSettings, HoverTarget, OverlaysSnapshot, RectLike } from "./types";
import type { OverlaysRuntime } from "./runtime";

/**
 * The rendered surfaces. [dev-toolbar/ext/overlays]
 *
 * Everything drawn over the application is React, inside the `overlay` slot —
 * no imperative DOM writing to reverse, so toggling off, hiding, unmounting
 * and hot reload all restore the page by construction. The one exception, the
 * host-outline stylesheet, lives in `runtime.ts` and tears down with the
 * listeners.
 *
 * `presentation` arrives already resolved and is read through `/kit`'s
 * `resolveCompactControl` and `renderCompact`, so the `hasIcon` guard, the
 * `"default"` fallback, the `CompactRenderContext` and the `undefined`
 * fall-through live in one place for all nine extensions rather than nine.
 * What stays here is the DOM: a consumer's `render` supplies the children of
 * the chip carrying `data-dtb-active`, and `Chip` paints the dot before them,
 * so no callback can cost the control its state attributes or its dot. The
 * error `Tag` is rendered *after* those children under every preset and under
 * a `render` callback alike — a measurement that threw is state, not
 * presentation (`plans/bar-presentation-icons-v1.md`, invariant 2).
 */

const box = (rect: RectLike): CSSProperties => ({
  left: `${rect.x}px`,
  top: `${rect.y}px`,
  width: `${Math.max(rect.width, 0)}px`,
  height: `${Math.max(rect.height, 0)}px`,
});

/* -------------------------------------------------------------------------- */
/* Bar chip                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The short word the bar paints, and the reason there is one.
 *
 * `label` is the extension's identity — the panel's accessible name, the `⋮`
 * row — and the bar has always painted this instead. Presets operate on *this*
 * word; `label` stays the overflow and accessible-name identity, which is what
 * makes the text axis `"none" | "short" | "full"` rather than a boolean
 * (`plans/bar-presentation-icons-v1.md`, "Which text").
 */
const SHORT_LABEL = "overlays";

/**
 * Today's tree, expressed as parts.
 *
 * `resolveCompactControl` answers the preset's parts, or these when the preset
 * is `"default"` — handed in rather than known to kit, because `"default"`
 * means *whatever this extension renders today* and that differs across the
 * nine. Overlays' default is exactly expressible as parts (short word plus
 * value in the bar, full label plus value in the `⋮` menu, no icon in either),
 * so "the default output is byte-identical" is a structural property rather
 * than a claim — and the hand-rolled `isOverflowed ? label : "overlays"` swing
 * this chip used to write is now just `parts.text`.
 *
 * The error `Tag` is not in here, and cannot be: it is state the extension
 * paints after the parts under every preset.
 */
const DEFAULTS: CompactDefaults = {
  bar: { icon: false, text: "short", value: true },
  overflow: { icon: false, text: "full", value: true },
};

/**
 * The icon and the text.
 *
 * These are the chip's *children* rather than `Chip`'s `icon` / `label` /
 * `value` slots — the same call `/ext/a11y` and `/ext/metrics` made, and the
 * reason is recorded in
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
      {paintIcon ? <Glyph data-dtb-part="ovl-icon">{icon}</Glyph> : null}
      {/* A bare `<span>`, which is what `Chip`'s `label` slot wrote before this
          moved into the chip's children — no `data-dtb-part`, because adding
          one would change today's bytes. */}
      {text === "none" ? null : <span>{text === "full" ? label : SHORT_LABEL}</span>}
    </>
  );
}

export interface ChipProps {
  runtime: OverlaysRuntime;
  label: string;
  /** Already through `resolvePresentation`, in the factory closure. */
  presentation: ResolvedCompactPresentation<OverlaysSnapshot>;
  isOverflowed: boolean;
  isPanelOpen: boolean;
  injectStyles: boolean;
  styleNonce?: string;
  onToggle(): void;
}

export function OverlaysChip({
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
    ensureOverlaysStyles,
    styleNonce,
  );
  const on = snapshot.activeCount > 0;
  const names = OVERLAY_IDS.filter((id) => snapshot.enabled[id]).map(
    (id) => OVERLAY_META[id].label,
  );
  // One word for the state, painted by the chip, spoken by the name and
  // explained by the title — so a voice-control user can say what they see.
  const state = on ? `${snapshot.activeCount} on` : "off";
  // The chip text is the whole name today, so the button is announced as its
  // readout. Name it after the extension and keep the state the chip shows —
  // the error tag included, since that is the part worth hearing.
  const accessibleLabel = [label, state, snapshot.error === null ? null : "error"]
    .filter((part) => part !== null)
    .join(", ");

  const control = resolveCompactControl(presentation, snapshot, {
    isOverflowed,
    defaults: DEFAULTS,
  });
  const fallback = (
    <>
      {iconAndText(label, control.parts, control.icon)}
      {/* The order `Chip`'s own value slot wrote before this moved into the
          chip's children: kind, then the site's props. This chip passes no
          `severity`, so no `data-dtb-severity` is written — it never did. */}
      {control.parts.value ? (
        <span data-dtb-kind="value" data-dtb-part="ovl-value">
          {state}
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
      // ignored so no override can leave the trigger unnamed. `title`
      // explains; it does not name, so it is not overridable.
      aria-label={resolveAccessibleName(presentation.name, snapshot, accessibleLabel)}
      onClick={onToggle}
      title={
        on
          ? `${label}: ${names.join(", ")} — click to choose overlays`
          : `${label}: ${state} — click to choose overlays`
      }
    >
      <Chip
        data-dtb-part="ovl-chip"
        data-dtb-active={on ? "true" : "false"}
        dotProps={{ "data-dtb-part": "ovl-dot" }}
      >
        {renderCompact(
          presentation,
          snapshot,
          { icon: control.icon, isOverflowed, isPanelOpen },
          fallback,
        )}
        {/* Invariant 2: a measurement that threw is state, not presentation.
            The tag sits outside both the preset and `render`, after the
            contents, under every preset including `"icon"` — a consumer
            restyling the chip cannot hide the fact that every overlay was
            switched off. */}
        {snapshot.error === null ? null : <Tag data-dtb-part="ovl-tag">error</Tag>}
      </Chip>
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
  styleNonce?: string;
}

export function OverlaysPanel({ runtime, label, injectStyles, styleNonce }: PanelProps): ReactNode {
  const snapshot = useExtensionSurface(
    runtime.store,
    injectStyles,
    ensureOverlaysStyles,
    styleNonce,
  );

  return (
    <div data-dtb-part="ovl-panel" aria-label={label}>
      {snapshot.error === null ? null : (
        <Banner data-dtb-part="ovl-error" role="alert">
          {snapshot.error}
        </Banner>
      )}

      <ul data-dtb-part="ovl-rows" data-dtb-kind="list">
        {OVERLAY_IDS.map((id) => {
          const meta = OVERLAY_META[id];
          const on = snapshot.enabled[id] === true;
          return (
            <li
              key={id}
              data-dtb-part="ovl-row"
              data-dtb-kind="row"
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
                  <Tag
                    data-dtb-part="ovl-tag"
                    title="This overlay adds one stylesheet to document.head while it is on. It is removed the moment it is switched off, when the bar is hidden, and on teardown."
                  >
                    stylesheet
                  </Tag>
                ) : null}
              </button>
              <p data-dtb-part="ovl-summary">{meta.summary}</p>
              <p data-dtb-part="ovl-cost">{meta.cost}</p>
              {id === "focus" && on ? (
                <Note data-dtb-part="ovl-note" role="status">
                  {snapshot.focusItems.length} badge
                  {snapshot.focusItems.length === 1 ? "" : "s"} on screen, {snapshot.unnamedCount}{" "}
                  with no accessible name
                  {snapshot.focusTruncated
                    ? " — the scan stopped at the badge limit, so the numbering past that point is incomplete"
                    : ""}
                  . Names are computed by a documented heuristic, not the full accname algorithm;
                  treat a flag as a prompt to check, not a verdict.
                </Note>
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
        <Note as="span" data-dtb-part="ovl-note" role="status">
          Nothing drawn here can be clicked: the surface is{" "}
          <code>pointer-events: none !important</code>, which no ordinary app rule can undo, and it
          paints below the bar — so a click reaches your page and the toolbar and palette are never
          covered.
        </Note>
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
  styleNonce?: string;
}

/**
 * Rendered by the `overlay` slot on every toolbar render; `null` whenever no
 * overlay is on, which is the common case.
 */
export function OverlaysSurface({ runtime, injectStyles, styleNonce }: SurfaceProps): ReactNode {
  const snapshot = useExtensionSurface(
    runtime.store,
    injectStyles,
    ensureOverlaysStyles,
    styleNonce,
  );
  useLayoutEffect(() => {
    runtime.setStyleNonce(styleNonce);
  }, [runtime, styleNonce]);
  if (snapshot.activeCount === 0) return null;

  const drawsSomething =
    snapshot.enabled.grid ||
    (snapshot.enabled.inspect && snapshot.hover !== null) ||
    (snapshot.enabled.focus && snapshot.focusItems.length > 0);
  // `boxes` draws through its stylesheet, not here, so a surface with only
  // `boxes` on has nothing to render.
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

  // Above the box when there's room, below it otherwise, never off the left
  // edge. `>=` on a rounded rect avoids jitter across the boundary.
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
        {item.ariaHidden ? <Tag data-dtb-part="ovl-tag">aria-hidden</Tag> : null}
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
