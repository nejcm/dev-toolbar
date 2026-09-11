/**
 * Thin controls over the tier B stylesheet. [dev-toolbar/kit]
 *
 * Each renders the plain DOM an extension already writes by hand plus its
 * `data-dtb-kind`, forwards `...rest` and its ref, and owns no state. No
 * colour props, variants or `size` — theming is `--dtb-*` tokens and
 * attributes (`docs/styling.md`). Nothing here is required.
 */
import { forwardRef } from "react";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import type { SeverityWithOverride } from "./types";

type DataAttributes = { [name: `data-${string}`]: string | undefined };

/**
 * Everything a `<span>` takes, plus `data-*`.
 *
 * Named and exported because it is the shape of every span-shaped slot in the
 * kit — `Chip`'s `dotProps` / `labelProps` / `valueProps`, `Glyph`, `Tag`, and
 * `renderCompactParts`' two prop bags — and an extension passing one around
 * should not have to spell it out. `GlyphProps` and `TagProps` are aliases of
 * it, kept so each component still names its own props type.
 */
export type SpanProps = HTMLAttributes<HTMLSpanElement> & DataAttributes;

/** Props for the shared button reset. Everything a `<button>` takes. */
export type ActionProps = ButtonHTMLAttributes<HTMLButtonElement> & DataAttributes;

/** A button carrying the shared reset, defaulting to a non-submitting type. */
export const Action = forwardRef<HTMLButtonElement, ActionProps>(function Action(
  { type = "button", ...rest },
  ref,
) {
  return <button {...rest} ref={ref} type={type} data-dtb-kind="action" />;
});

/** Props for a small inline icon wrapper. Everything a `<span>` takes. */
export type GlyphProps = SpanProps;

/**
 * A consumer-supplied icon, hidden from assistive technology and clamped.
 *
 * Two reasons nine call sites should not each solve: it is `aria-hidden` by
 * default, because the name belongs to the control and an announced icon
 * duplicates it — pass `aria-hidden={false}` with a `role`/`aria-label` where
 * the icon *is* the name — and it clamps its direct child, because a 24px
 * `<svg>` handed to an 11px bar would otherwise set the bar's height. The clamp
 * is `--dtb-glyph-size`, defaulting to `1.15em`, so it tracks density for free.
 *
 * It is a standalone control, not just a `Chip` slot, because three of the nine
 * first-party bar controls are hand-written and cannot route through `Chip`.
 */
export const Glyph = forwardRef<HTMLSpanElement, GlyphProps>(function Glyph(
  { "aria-hidden": ariaHidden = "true", ...rest },
  ref,
) {
  return <span {...rest} ref={ref} aria-hidden={ariaHidden} data-dtb-kind="glyph" />;
});

/**
 * Whether a resolved icon is one of the **primitives React paints nothing
 * for** — `false`, `true`, `null`, `undefined` and `""`.
 *
 * **The one rule**, and the reason it is a function rather than an inline
 * `!== undefined && !== null` at each of the five sites that need it: a
 * presence test that only rejects the middle two calls the first, fourth and
 * fifth an icon. That is not a cosmetic mistake — it is the hole guarantee 1
 * exists to close. `icon: (view) => view.enabled && <Icon />` is an ordinary
 * callback that returns `false` for a disabled control, and under
 * `preset: "icon"` a truthy `hasIcon` then suppresses the text *and* paints an
 * empty `<span data-dtb-kind="glyph">`, leaving a control that is blank but for
 * its dot and still eating a `gap`.
 *
 * `0` is deliberately **paintable**: React renders it as the character `0`, and
 * a numeric badge is a legitimate icon. So this is emptiness, not falsiness.
 *
 * **Not every icon that paints nothing is caught, and none can be.** A *node*
 * is an icon here: `[]`, `<></>` and `[null]` all answer `true` and produce the
 * blank glyph above, as does `<Badges />` when that component returns `null` —
 * and the last of those is undecidable without rendering it, which a value test
 * cannot do. So the line is drawn where a value test can see: the five
 * primitives, and nothing deeper. Half-recursing into arrays and fragments
 * would move the boundary without reaching it and would make `[]` and `[null]`
 * disagree for no reason a consumer could predict; `icon: () => undefined` is
 * the supported way to say "no icon here", and every preset but `"icon"` still
 * has its text or value to paint regardless.
 *
 * `/ext/flags` reaches the same answer from the other direction: its legacy
 * `PromotedFlag.icon` is a `string | undefined` it has always painted on
 * truthiness, so `""` has never been an icon there either. Over that type the
 * two rules agree exactly, which is what lets that call site read this one.
 */
export function hasPaintableIcon(icon: ReactNode): boolean {
  return icon !== undefined && icon !== null && icon !== false && icon !== true && icon !== "";
}

/**
 * Props for a bar chip: a decorative dot, an optional icon, an optional label
 * and an optional value.
 */
export interface ChipProps extends SpanProps {
  /**
   * Optional, and `undefined | null` renders nothing at all rather than an
   * empty span — the chip is `inline-flex` with a `gap`, so an empty span would
   * still consume one and leave an icon-only or value-only chip off-centre.
   */
  label?: ReactNode;
  /**
   * A consumer-supplied icon, rendered after the dot inside a `Glyph`.
   *
   * Guarded by `hasPaintableIcon` rather than by the presence test the two text
   * slots use, and the difference is the slot's audience: `label` and `value`
   * are text a site passes explicitly, while an icon is what a consumer writes
   * `icon={enabled && <I />}` for (ADR-004 records this slot as third-party
   * surface). That expression is `false` half the time, and a presence test
   * would call it an icon and paint an empty `Glyph` that still eats the gap —
   * the same hole the `presentation` vocabulary's guarantee 1 exists to close,
   * reached here through the same one rule. Note the rule is the five
   * primitives React paints nothing for and nothing deeper: `icon={[]}` is a
   * node, and still paints the empty `Glyph`.
   */
  icon?: ReactNode;
  /** Props for the icon's `Glyph` wrapper. */
  iconProps?: GlyphProps;
  value?: ReactNode;
  /**
   * Colours the dot and the value only — `data-dtb-severity` is compound with
   * `data-dtb-kind` in the kit sheet, so it never tints the chip itself.
   * Passing `severity` alongside a `data-dtb-severity` in `...rest` for the
   * container is intentional, not a duplicate to remove.
   */
  severity?: SeverityWithOverride;
  dotProps?: SpanProps;
  labelProps?: SpanProps;
  valueProps?: SpanProps;
}

/**
 * A dot, an optional icon, an optional label, an optional value and whatever
 * else the site appends.
 *
 * Each slot takes its own props so a site keeps its `data-dtb-part` names.
 * The dot and value default to `data-dtb-kind`; the label does not — pass
 * `labelProps={{ "data-dtb-kind": "label" }}` to opt in, or `undefined` on
 * the others to opt out.
 *
 * The icon slot is the exception: `Glyph` writes its kind *after* its own
 * props, so `iconProps` cannot drop it. The clamp keyed on that kind is the
 * reason `Glyph` exists — an unclamped 24px `<svg>` would set the bar's
 * height — so opting out would defeat the control. Style the icon through the
 * element you hand to `icon`.
 */
export const Chip = forwardRef<HTMLSpanElement, ChipProps>(function Chip(
  { children, dotProps, icon, iconProps, label, labelProps, severity, value, valueProps, ...rest },
  ref,
) {
  return (
    <span {...rest} ref={ref} data-dtb-kind="chip">
      <span data-dtb-kind="dot" data-dtb-severity={severity} aria-hidden="true" {...dotProps} />
      {hasPaintableIcon(icon) ? <Glyph {...iconProps}>{icon}</Glyph> : null}
      {label === undefined || label === null ? null : <span {...labelProps}>{label}</span>}
      {value === undefined || value === null ? null : (
        <span data-dtb-kind="value" data-dtb-severity={severity} {...valueProps}>
          {value}
        </span>
      )}
      {children}
    </span>
  );
});

type NoteElement = "label" | "p" | "span";

/** Props for secondary text. `as` picks the element the site already uses. */
export interface NoteProps extends HTMLAttributes<HTMLElement>, DataAttributes {
  as?: NoteElement;
}

/** Muted, margin-free secondary text. */
export const Note = forwardRef<HTMLElement, NoteProps>(function Note(
  { as: Element = "p", ...rest },
  ref,
) {
  return <Element {...rest} ref={ref as never} data-dtb-kind="note" />;
});

type BannerElement = "div" | "p";

/** Props for a panel-wide message. */
export interface BannerProps extends HTMLAttributes<HTMLElement>, DataAttributes {
  as?: BannerElement;
  /** Colours this element only. Optional, for sites with their own tone vocabulary. */
  severity?: SeverityWithOverride;
}

/**
 * A padded, rounded message.
 *
 * Give it a `role` — the kit supplies none, so a `Banner` without one is
 * announced to nobody. `role="alert"` interrupts; `role="status"` waits.
 */
export const Banner = forwardRef<HTMLElement, BannerProps>(function Banner(
  { as: Element = "p", severity, ...rest },
  ref,
) {
  return (
    <Element
      {...rest}
      ref={ref as never}
      data-dtb-kind="banner"
      data-dtb-severity={severity ?? rest["data-dtb-severity"]}
    />
  );
});

/** Props for a small inline marker. Everything a `<span>` takes. */
export type TagProps = SpanProps;

/** A small inline marker beside a value. */
export const Tag = forwardRef<HTMLSpanElement, TagProps>(function Tag(rest, ref) {
  return <span {...rest} ref={ref} data-dtb-kind="tag" />;
});

type EmptyStateElement = "div" | "p";

/** Props for the "nothing to show" placeholder. */
export interface EmptyStateProps extends HTMLAttributes<HTMLElement>, DataAttributes {
  as?: EmptyStateElement;
}

/** The muted placeholder a panel shows when it has nothing to list. */
export const EmptyState = forwardRef<HTMLElement, EmptyStateProps>(function EmptyState(
  { as: Element = "div", ...rest },
  ref,
) {
  return <Element {...rest} ref={ref as never} data-dtb-kind="empty" />;
});

/** Props for the panel search box. State stays in the extension so it can be filtered against or reset. */
export interface SearchFieldProps
  extends
    Omit<InputHTMLAttributes<HTMLInputElement>, "aria-label" | "onChange" | "type" | "value">,
    DataAttributes {
  value: string;
  /** Receives the new value, not the event — every site reads only that. */
  onChange: (value: string) => void;
  /**
   * The accessible name, written as `aria-label`. Required — a bare
   * `type="search"` with only a placeholder announces as just "search".
   * `aria-labelledby` still passes through `...rest` and wins when present.
   */
  label: string;
}

/** A `type="search"` input with an accessible name it cannot be built without. */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { label, onChange, value, ...rest },
  ref,
) {
  return (
    <input
      {...rest}
      ref={ref}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      type="search"
      aria-label={label}
      data-dtb-kind="search"
    />
  );
});

/** Props for the key/value readout. Everything a `<dl>` takes. */
export type RowsProps = HTMLAttributes<HTMLDListElement> & DataAttributes;

/** The two-column `<dl>` grid a panel prints a key/value readout into. */
export const Rows = forwardRef<HTMLDListElement, RowsProps>(function Rows(rest, ref) {
  return <dl {...rest} ref={ref} data-dtb-kind="rows" />;
});

type RowSlotProps = HTMLAttributes<HTMLElement> & DataAttributes;

/**
 * Props for one key/value pair inside `<Rows>`. Anything else spreads onto the
 * `<dd>`, so a stray `data-dtb-part` lands there; `valueProps` wins on collision.
 */
export interface RowProps extends RowSlotProps {
  label: ReactNode;
  /** The value cell's content. */
  children?: ReactNode;
  labelProps?: RowSlotProps;
  valueProps?: RowSlotProps;
}

/**
 * A `<dt>`/`<dd>` pair as a fragment, so pairs stay direct children of the
 * `<Rows>` grid instead of being wrapped in an element that would break it.
 * No `ref`: a fragment has no single DOM node; a site needing one writes the
 * two elements by hand.
 */
export function Row({ children, label, labelProps, valueProps, ...rest }: RowProps): ReactNode {
  return (
    <>
      <dt data-dtb-kind="label" {...labelProps}>
        {label}
      </dt>
      <dd {...rest} data-dtb-kind="value" {...valueProps}>
        {children}
      </dd>
    </>
  );
}

/** Props for a label wrapping its own control. */
export interface FieldProps extends Omit<NoteProps, "as"> {
  /** The visible label text, rendered before the control with a space between. */
  label: ReactNode;
}

/**
 * A muted `<label>` wrapping its control, which *is* the association — no
 * `id` to generate or keep in sync. An inner `aria-label` wins over this text
 * in the accessibility tree; that's intentional where a one-word visible
 * label needs more context for a screen reader.
 */
export const Field = forwardRef<HTMLLabelElement, FieldProps>(function Field(
  { children, label, ...rest },
  ref,
) {
  return (
    <Note {...rest} ref={ref as never} as="label">
      {label} {children}
    </Note>
  );
});

/** Props for a single-line text field. */
export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  /** Receives the new value, not the event. */
  onChange?: (value: string) => void;
}

/**
 * A text field. Geometry and ground come from core's `:where(input, select,
 * textarea)` rule; `data-dtb-kind="field"` is just a hook for one selector.
 */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { onChange, type = "text", ...rest },
  ref,
) {
  return (
    <input
      {...rest}
      ref={ref}
      type={type}
      onChange={onChange === undefined ? undefined : (event) => onChange(event.target.value)}
      data-dtb-kind="field"
    />
  );
});

/** Props for a select. */
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange"> {
  /** Receives the new value, not the event. */
  onChange?: (value: string) => void;
}

/** A select carrying the shared field hook. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { onChange, ...rest },
  ref,
) {
  return (
    <select
      {...rest}
      ref={ref}
      onChange={onChange === undefined ? undefined : (event) => onChange(event.target.value)}
      data-dtb-kind="field"
    />
  );
});
