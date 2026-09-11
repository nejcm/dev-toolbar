/**
 * Bar presentation vocabulary: presets, a consumer-supplied icon, a render
 * callback and an accessible-name override. [dev-toolbar/kit]
 *
 * Every extension that lets a consumer restyle its bar control resolves that
 * option through these pure helpers, so the two guarantees below hold once
 * rather than nine times. Almost nothing here paints: `resolveCompactControl`
 * answers *which parts* to paint and the extension paints them, because the
 * nine bar controls do not share a DOM shape (three of them are hand-written
 * on purpose). `renderCompact` is an exception in spirit only — it invokes the
 * consumer's callback and returns its node, still without a tree of its own.
 * `renderCompactParts` is the one real exception, and it earned it: six of the
 * nine wrote the *same* icon-plus-text fragment, so the shared shape is a fact
 * about them rather than a shape imposed on them. It stops at the icon and the
 * text; the value span and the state children stay each extension's own.
 *
 * Provenance: `plans/bar-presentation-icons-v1.md`, "Design"; the decision and
 * its rejected alternatives are `docs/adr/ADR-004-per-extension-bar-presentation.md`.
 */
import type { ReactNode } from "react";
import { Glyph } from "./controls";
import type { SpanProps } from "./controls";

/**
 * How a bar control presents itself.
 *
 * `"default"` is a member rather than an absence because today's rendering is
 * not one thing across the nine — Group A is short-word plus value, agent is
 * label-only, command-menu is a glyph plus a hotkey hint — so a member named
 * `"label-value"` would be a lie for three of them. It is also the option's
 * default value, so every existing consumer lands on it and
 * `resolveCompactParts` returns `null`: see that function for why that is what
 * makes byte-identical default output a structural property.
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
 * Group A chips paint a hardcoded short word in the bar (`"a11y"`,
 * `"diagnostics"`, `"overlays"`) and the configured `label` only when
 * overflowed, so presets operate on the short bar word while `label` stays the
 * overflow and accessible-name identity. Presets in the bar therefore select
 * `"short"`, and the overflow rule forces `"full"`.
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
 * nothing when the callback ignores it: `render: (m, ctx) => m.severity ===
 * "bad" ? <Siren /> : ctx.fallback`.
 *
 * `density` is deliberately absent — no first-party compact slot reads density
 * today, so it would be speculative surface. Adding it later is additive.
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
 * One option rather than four siblings: four names across nine extensions is 36
 * new option-bag entries, and the four are meaningless apart — an `icon` with
 * no preset that paints it does nothing.
 */
export interface CompactPresentation<TView> {
  /** Defaults to `"default"`. */
  preset?: CompactPreset;
  /**
   * A `ReactNode`, or a function returning one. The function form dissolves the
   * cardinality problem: an extension with N controls needs no icon map, just
   * `icon: (view) => ICONS[view.id]`.
   */
  icon?: ReactNode | ((data: TView) => ReactNode);
  /**
   * Full control over the control's children. The extension keeps its
   * `<button>`, `type`, `aria-expanded`, `onClick`, `title` and any
   * `role="switch"`/`aria-checked`; this supplies children only.
   *
   * Returning `undefined` falls through to the preset, so a callback can opt
   * out per control rather than per extension.
   */
  render?: (data: TView, ctx: CompactRenderContext) => ReactNode;
  /**
   * Overrides the control's `aria-label`. A whitespace-only return is ignored:
   * an icon-only control that lost its name would be worse than one named
   * awkwardly. `title` is not overridable — it explains, it does not name.
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
 * `null` is the whole point of the resolver: each extension reads
 * `parts === null ? <today's tree> : <driven tree>`, which makes "today's
 * output is byte-identical" a structural property rather than a truth-table
 * coincidence — and so a provable compatibility claim rather than an asserted
 * one.
 *
 * Two guarantees live here and nowhere else:
 *
 * 1. **An icon-only preset with no icon supplied paints text.** A blank control
 *    is worse than an unstyled one. Only `"icon"` needs this: the other
 *    icon-bearing presets still have their text or value to paint.
 * 2. **The `⋮` menu always paints `"full"` text.** The same reasoning `/ext/a11y`
 *    already applies by hand. It holds for every preset by construction; it is
 *    deliberately *not* enforced for `render`, which is honoured in both places
 *    with `ctx.isOverflowed` as the hook (ADR-004 records that deviation).
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
 * Invoked as a plain call and its result rendered as a node — never as
 * `const Icon = icon; <Icon />`, which `react/no-unstable-nested-components`
 * rejects and which would remount the icon on every render.
 */
export function resolveIcon<TView>(
  icon: CompactPresentation<TView>["icon"],
  data: TView,
): ReactNode {
  return typeof icon === "function" ? icon(data) : icon;
}

/**
 * The parts an extension paints under `"default"`, in each of the two places a
 * bar control appears.
 *
 * Passed in rather than known here: `"default"` means *whatever this extension
 * renders today*, and that differs across the nine. Group A happening to share
 * a shape is not a licence to hardcode it in kit.
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
 * The guard is the same `undefined | null` test the kit `Chip` applies to its
 * slots, and it has to happen here rather than in `resolveCompactParts`: a
 * function `icon` can return nothing for one control and a node for the next,
 * so guarantee 1 applies per control, not per extension.
 *
 * The other half of the point is `defaults`: `resolveCompactParts` answers
 * `null` for `"default"`, and every caller then owes the same
 * `isOverflowed ? overflow : bar` choice. Nine copies of that choice is nine
 * places for the byte-identity property to rot.
 *
 * The guard applies to `defaults` too, and that is the whole point of "in one
 * place": an extension whose `"default"` paints an icon (`/ext/flags`' promoted
 * control, which has painted `PromotedFlag.icon` since it existed) would
 * otherwise get `parts.icon === true` alongside `icon == null` — an
 * inconsistent pair `renderCompactParts` trusts, painting an empty
 * `<span data-dtb-kind="glyph">` that still eats a `gap`. The invariant is on
 * this function's *output*: `parts.icon` implies `icon` is paintable, whichever
 * side the parts came from. Extensions whose defaults name no icon slot are
 * untouched — the clause only ever turns a `true` into `false`.
 */
export function resolveCompactControl<TView>(
  presentation: ResolvedCompactPresentation<TView>,
  view: TView,
  { isOverflowed, defaults }: CompactControlOptions,
): CompactControl {
  const icon = resolveIcon(presentation.icon, view);
  const hasIcon = icon !== undefined && icon !== null;
  const parts = resolveCompactParts(presentation.preset, { hasIcon, isOverflowed });
  const chosen = parts ?? (isOverflowed ? defaults.overflow : defaults.bar);
  return { icon, parts: chosen.icon && !hasIcon ? { ...chosen, icon: false } : chosen };
}

/**
 * The icon and the text of one bar control, as `Chip` children.
 *
 * Six first-party extensions wrote the same six-line fragment: paint the
 * `Glyph` when `parts.icon`, and paint one `<span>` carrying either the short
 * bar word or the full identity when `parts.text` is not `"none"`. The
 * divergence that kept it six copies was the text span's attributes — four
 * chips wrote a bare `<span>` and two wrote a named one — and that is gone now
 * that all six name theirs, leaving `textProps` as an ordinary prop bag rather
 * than a shape parameter.
 *
 * `parts.value` is deliberately not read here: every site paints its own value
 * span, with its own part, its own `data-dtb-severity` and — for the two that
 * have one — its own state child after it. Kit answers *which parts*; the
 * extension still owns the DOM (ADR-004).
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
 * A plain function returning a fragment rather than a component, for the same
 * reason `resolveIcon` is a call and not `<Icon />`: a component declared or
 * chosen per render is what `react/no-unstable-nested-components` rejects, and
 * the result here is `Chip`'s children, which every site then concatenates its
 * own value and state children onto.
 *
 * **Precondition:** `parts.icon` implies `icon` is paintable. This function
 * paints the `Glyph` on `parts.icon` alone and does not re-check the node, so
 * an inconsistent pair yields an empty `<span data-dtb-kind="glyph">` that
 * still eats a `gap`. `resolveCompactControl` guarantees the pair on its own
 * output, `defaults` included — take `parts` from there rather than assembling
 * them by hand.
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
  /**
   * The resolved icon, as `resolveCompactControl` returned it. Required rather
   * than optional so a caller cannot silently drop it from the context.
   */
  icon: ReactNode;
}

/**
 * Invokes a `render` callback for one control, or returns the preset's node.
 *
 * The `CompactRenderContext` is assembled here and nowhere else, so the seven
 * value-bearing extensions cannot drift on which fields it carries — and
 * neither can they drift on the `undefined` rule: a callback returning
 * `undefined` falls through to `fallback`, so a consumer opts out per control
 * rather than per extension.
 *
 * `fallback` is an element tree the caller has already built, not a rendered
 * result, so handing it out costs nothing when the callback ignores it. It is
 * also the *same* construction the extension paints when there is no callback,
 * which is what makes `render: (_, ctx) => ctx.fallback` exact by construction
 * rather than by two pieces of markup kept in step.
 *
 * The callback is honoured in the bar and in the `⋮` menu alike, with
 * `ctx.isOverflowed` as the hook. That is the deliberate deviation from the
 * "the menu always paints text" guarantee that ADR-004 records: the guarantee
 * holds by construction for every preset, and a callback is the consumer taking
 * the wheel.
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
 * The control's accessible name: the override when it says something, the
 * extension's own name otherwise.
 *
 * A whitespace-only override is ignored rather than trusted, so no override can
 * leave an icon-only control unnamed — which is exactly what `/ext/a11y` would
 * flag on the toolbar's own bar.
 */
export function resolveAccessibleName<TView>(
  name: ((data: TView) => string) | undefined,
  data: TView,
  fallback: string,
): string {
  if (name === undefined) {
    return fallback;
  }
  const overridden = name(data);
  return overridden.trim() === "" ? fallback : overridden;
}
