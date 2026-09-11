/**
 * Bar presentation vocabulary: presets, a consumer-supplied icon, a render
 * callback and an accessible-name override. [dev-toolbar/kit]
 *
 * Every extension that lets a consumer restyle its bar control resolves that
 * option through these pure helpers, so the two guarantees below hold once
 * rather than nine times. `resolveCompactControl` answers *which parts* to
 * paint; the extension still paints them, since the nine bar controls don't
 * share a DOM shape. `renderCompactParts` is the one shared painter, and only
 * for the icon-plus-text fragment six extensions wrote identically — the
 * value span and state children stay each extension's own.
 *
 * Provenance: `plans/bar-presentation-icons-v1.md`, "Design";
 * `docs/adr/ADR-004-per-extension-bar-presentation.md` for rejected alternatives.
 */
import type { ReactNode } from "react";
import { Glyph, hasPaintableIcon } from "./controls";
import type { SpanProps } from "./controls";

/**
 * How a bar control presents itself.
 *
 * `"default"` is a member, not an absence, because "default" isn't one shape
 * across the nine (short-word-plus-value, label-only, glyph-plus-hint). It's
 * also the option's default, so `resolveCompactParts` returning `null` for it
 * is what makes byte-identical default output structural rather than assumed.
 */
export type CompactPreset =
  /** Whatever this extension renders today. Extension-defined; resolves to `null`. */
  | "default"
  /** The icon alone. Falls back to text when no icon is supplied. */
  | "icon"
  /** The icon and the extension's value. */
  | "icon-value"
  /** The icon and the extension's text. */
  | "icon-label"
  /** The extension's text alone. */
  | "label"
  /** The extension's value alone. */
  | "value";

/**
 * Which text a control paints.
 *
 * Group A chips paint a hardcoded short word in the bar and the configured
 * `label` only when overflowed, so presets select `"short"` in the bar and
 * the overflow rule forces `"full"`.
 */
export type CompactText = "none" | "short" | "full";

/** Which parts of a bar control to paint. `text` is the axis, not a boolean. */
export interface CompactParts {
  /** Paint the resolved icon. False when the preset names none, or none was supplied. */
  icon: boolean;
  /** Which of the extension's two texts to paint, if either. */
  text: CompactText;
  /** Paint the extension's value slot. */
  value: boolean;
}

/**
 * What a `render` callback is told about the control it is painting.
 *
 * `fallback` is an element tree, not a rendered result, so building it costs
 * nothing when the callback ignores it.
 *
 * No `density`: no first-party compact slot reads it today, so adding it
 * would be speculative surface.
 */
export interface CompactRenderContext {
  /** The resolved preset, `"default"` included. */
  preset: CompactPreset;
  /** The icon, already resolved through a function `icon`. */
  icon?: ReactNode;
  /** True in the `⋮` overflow menu rather than the bar. */
  isOverflowed: boolean;
  /** True while this extension's panel is the open one. */
  isPanelOpen: boolean;
  /** What the preset would have painted. */
  fallback: ReactNode;
}

/**
 * The presentation of one bar control.
 *
 * One option rather than four siblings: the four are meaningless apart — an
 * `icon` with no preset that paints it does nothing.
 */
export interface CompactPresentation<TView> {
  /** Defaults to `"default"`. */
  preset?: CompactPreset;
  /** A `ReactNode`, or a function of the view data — avoids an icon map for extensions with N controls. */
  icon?: ReactNode | ((data: TView) => ReactNode);
  /**
   * Full control over the control's children. The extension keeps its
   * `<button>`, `type`, `aria-expanded`, `onClick`, `title` and any
   * `role="switch"`/`aria-checked`; this supplies children only.
   *
   * Returning `undefined` falls through to the preset.
   */
  render?: (data: TView, ctx: CompactRenderContext) => ReactNode;
  /**
   * Overrides the control's `aria-label`. A whitespace-only return is
   * ignored — an unnamed icon-only control is worse than an awkwardly named
   * one. `title` is not overridable; it explains, it does not name.
   */
  name?: (data: TView) => string;
}

/** The `presentation` option: the full shape, or a bare preset as shorthand. */
export type CompactPresentationInput<TView> = CompactPreset | CompactPresentation<TView>;

/** A `CompactPresentation` with its preset filled in. What extensions hold. */
export interface ResolvedCompactPresentation<TView> extends CompactPresentation<TView> {
  preset: CompactPreset;
}

/** Where a control is being painted, and whether it has an icon to paint. */
export interface CompactPartsOptions {
  /** Whether an icon was supplied — after resolving a function `icon`. */
  hasIcon: boolean;
  /** True in the `⋮` overflow menu rather than the bar. */
  isOverflowed: boolean;
}

/**
 * Which parts a preset paints, or `null` for `"default"`.
 *
 * Each extension reads `parts === null ? <today's tree> : <driven tree>`,
 * which makes "today's output is byte-identical" structural rather than
 * asserted.
 *
 * Two guarantees live here and nowhere else:
 *
 * 1. **An icon-only preset with no icon supplied paints text instead.** Only
 *    `"icon"` needs this — the other icon-bearing presets still have text or
 *    value to paint. "No icon" is `hasPaintableIcon`'s answer.
 * 2. **The `⋮` menu always paints `"full"` text**, for every preset, by
 *    construction. Deliberately not enforced for `render`, which is honoured
 *    in both places via `ctx.isOverflowed` instead (ADR-004).
 */
export function resolveCompactParts(
  preset: CompactPreset,
  { hasIcon, isOverflowed }: CompactPartsOptions,
): CompactParts | null {
  if (preset === "default") {
    return null;
  }

  const icon = hasIcon && preset !== "label" && preset !== "value";
  const value = preset === "icon-value" || preset === "value";
  // Guarantee 1: "icon" with nothing to paint falls back to its text.
  const bare = preset === "icon" && !hasIcon;
  const wantsText = preset === "icon-label" || preset === "label" || bare;

  // Guarantee 2: the overflow menu is never wordless under a preset.
  let text: CompactText = "none";
  if (isOverflowed) {
    text = "full";
  } else if (wantsText) {
    text = "short";
  }

  return { icon, text, value };
}

/** Normalises the shorthand and the full shape into one, with `preset` filled in. */
export function resolvePresentation<TView>(
  input: CompactPresentationInput<TView> | undefined,
): ResolvedCompactPresentation<TView> {
  if (input === undefined) {
    return { preset: "default" };
  }
  if (typeof input === "string") {
    return { preset: input };
  }
  return { ...input, preset: input.preset ?? "default" };
}

/**
 * Resolves a possibly-function `icon` against this control's view data.
 *
 * Called directly and its result rendered as a node — never
 * `const Icon = icon; <Icon />`, which would remount the icon every render.
 */
export function resolveIcon<TView>(
  icon: CompactPresentation<TView>["icon"],
  data: TView,
): ReactNode {
  return typeof icon === "function" ? icon(data) : icon;
}

/**
 * The parts an extension paints under `"default"`, in each of the two places
 * a bar control appears.
 *
 * Passed in rather than known here — `"default"` means whatever this
 * extension renders today, and that differs across the nine.
 */
export interface CompactDefaults {
  /** What `"default"` paints in the bar. */
  bar: CompactParts;
  /** What `"default"` paints in the `⋮` overflow menu. */
  overflow: CompactParts;
}

/** Where a control is painting, and what `"default"` means there. */
export interface CompactControlOptions {
  /** True in the `⋮` overflow menu rather than the bar. */
  isOverflowed: boolean;
  /** This extension's own default parts. */
  defaults: CompactDefaults;
}

/** One control's resolved icon and the parts to paint for it. */
export interface CompactControl {
  /** The icon, already resolved through a function `icon`. */
  icon: ReactNode;
  /** Which parts to paint — the preset's, or this extension's defaults. */
  parts: CompactParts;
}

/**
 * One control's icon and parts, with the `hasIcon` guard and the
 * `"default"` fallback in one place.
 *
 * The guard happens here rather than in `resolveCompactParts` because a
 * function `icon` can return nothing for one control and a node for the
 * next — guarantee 1 applies per control, not per extension.
 *
 * The guard also applies to `defaults`: an extension whose `"default"` paints
 * an icon (`/ext/flags`' promoted control) could otherwise report
 * `parts.icon === true` alongside `icon == null`, and `renderCompactParts`
 * would paint an empty glyph that still eats the `gap`. This function's
 * output always keeps `parts.icon` implying `icon` is paintable — it only
 * ever turns a `true` into `false`.
 */
export function resolveCompactControl<TView>(
  presentation: ResolvedCompactPresentation<TView>,
  view: TView,
  { isOverflowed, defaults }: CompactControlOptions,
): CompactControl {
  const icon = resolveIcon(presentation.icon, view);
  const hasIcon = hasPaintableIcon(icon);
  const parts = resolveCompactParts(presentation.preset, { hasIcon, isOverflowed });
  const chosen = parts ?? (isOverflowed ? defaults.overflow : defaults.bar);
  return { icon, parts: chosen.icon && !hasIcon ? { ...chosen, icon: false } : chosen };
}

/**
 * The icon and the text of one bar control, as `Chip` children.
 *
 * Shared shape for the icon-plus-text fragment six first-party extensions
 * wrote identically. `parts.value` is deliberately not read here — every site
 * paints its own value span and, where it has one, its own state child after
 * it. Kit answers which parts; the extension still owns the DOM (ADR-004).
 */
export interface CompactPartsContent {
  /** Which parts to paint: `resolveCompactControl(...).parts`. */
  parts: CompactParts;
  /** The resolved icon node, as `resolveCompactControl` returned it. */
  icon: ReactNode;
  /** Attributes for the `Glyph` — in practice this extension's `data-dtb-part`. */
  iconProps?: SpanProps;
  /** The short bar word, painted when `parts.text` is `"short"`. */
  short: ReactNode;
  /** The extension's full identity, painted when `parts.text` is `"full"`. */
  full: ReactNode;
  /** Attributes for the text `<span>`. Omitted entirely, it writes a bare one. */
  textProps?: SpanProps;
}

/**
 * Paints the icon and the text of one bar control.
 *
 * A plain function returning a fragment, not a component — the same reason
 * `resolveIcon` is a call and not `<Icon />`. The result becomes `Chip`'s
 * children, which the caller then appends its own value and state children to.
 *
 * Precondition: `parts.icon` implies `icon` is paintable. This function
 * trusts `parts.icon` without re-checking the node; `resolveCompactControl`
 * is what guarantees the pair, so take `parts` from there.
 */
export function renderCompactParts({
  parts,
  icon,
  iconProps,
  short,
  full,
  textProps,
}: CompactPartsContent): ReactNode {
  return (
    <>
      {parts.icon ? <Glyph {...iconProps}>{icon}</Glyph> : null}
      {parts.text === "none" ? null : (
        <span {...textProps}>{parts.text === "full" ? full : short}</span>
      )}
    </>
  );
}

/** Where a `render` callback is being invoked, for the context it is handed. */
export interface CompactPlace {
  /** True in the `⋮` overflow menu rather than the bar. */
  isOverflowed: boolean;
  /** True while this extension's panel is the open one. */
  isPanelOpen: boolean;
  /** The resolved icon, as `resolveCompactControl` returned it. Required so it can't be silently dropped. */
  icon: ReactNode;
}

/**
 * Invokes a `render` callback for one control, or returns the preset's node.
 *
 * `CompactRenderContext` is assembled only here, so extensions can't drift on
 * its fields or on the `undefined` rule: a callback returning `undefined`
 * falls through to `fallback`.
 *
 * `fallback` is an element tree the caller already built — the same one
 * painted when there's no callback, so `render: (_, ctx) => ctx.fallback` is
 * exact by construction.
 *
 * Honoured in the bar and the `⋮` menu alike via `ctx.isOverflowed`, the
 * deliberate exception to "the menu always paints text" (ADR-004): that
 * guarantee holds by construction for presets; a callback is the consumer
 * taking the wheel.
 */
export function renderCompact<TView>(
  presentation: ResolvedCompactPresentation<TView>,
  view: TView,
  { icon, isOverflowed, isPanelOpen }: CompactPlace,
  fallback: ReactNode,
): ReactNode {
  if (presentation.render === undefined) {
    return fallback;
  }
  const rendered = presentation.render(view, {
    preset: presentation.preset,
    icon,
    isOverflowed,
    isPanelOpen,
    fallback,
  });
  return rendered === undefined ? fallback : rendered;
}

/**
 * The `name` override, when there is one that says something — `undefined`
 * otherwise.
 *
 * Whitespace-only is treated as absent here so both callers agree:
 * `resolveAccessibleName` below, and a control with no fallback name at all,
 * which must write no `aria-label` rather than an empty one.
 */
export function resolveNameOverride<TView>(
  name: ((data: TView) => string) | undefined,
  data: TView,
): string | undefined {
  if (name === undefined) {
    return undefined;
  }
  const overridden = name(data);
  return overridden.trim() === "" ? undefined : overridden;
}

/**
 * The control's accessible name: the override when it says something, the
 * extension's own name otherwise.
 */
export function resolveAccessibleName<TView>(
  name: ((data: TView) => string) | undefined,
  data: TView,
  fallback: string,
): string {
  return resolveNameOverride(name, data) ?? fallback;
}
