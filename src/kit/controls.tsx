/**
 * Thin controls over the tier B stylesheet. [dev-toolbar/kit]
 *
 * Each one renders exactly the DOM an extension writes by hand today plus its
 * `data-dtb-kind`, forwards `...rest` and its ref to that node, and owns no
 * state. There are no colour props, no variants and no `size` — theming is
 * `--dtb-*` tokens and attributes, as `docs/styling.md` describes. Anything a
 * control cannot express stays hand-written JSX; nothing here is required.
 */
import { forwardRef } from "react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import type { SeverityWithOverride } from "./types";

type DataAttributes = { [name: `data-${string}`]: string | undefined };
type SpanProps = HTMLAttributes<HTMLSpanElement> & DataAttributes;

/** Props for the shared button reset. Everything a `<button>` takes. */
export type ActionProps = ButtonHTMLAttributes<HTMLButtonElement> & DataAttributes;

/** A button carrying the shared reset, defaulting to a non-submitting type. */
export const Action = forwardRef<HTMLButtonElement, ActionProps>(function Action(
  { type = "button", ...rest },
  ref,
) {
  return <button {...rest} ref={ref} type={type} data-dtb-kind="action" />;
});

/** Props for a bar chip: a decorative dot, a label and an optional value. */
export interface ChipProps extends SpanProps {
  label: ReactNode;
  value?: ReactNode;
  /**
   * Colours the dot and the value, never the chip or anything else inside it:
   * `data-dtb-severity` is compound with `data-dtb-kind` in the kit sheet, so a
   * container carrying it does not tint its descendants. Omit it where the site
   * colours its own dot from an attribute of its own.
   *
   * It deliberately writes nothing onto the container, so a site that also
   * needs `[data-dtb-severity]` on the chip itself passes that attribute
   * through `...rest` as well. Both are load-bearing: passing `severity` and
   * `data-dtb-severity` together is correct, not a duplicate to tidy away.
   */
  severity?: SeverityWithOverride;
  dotProps?: SpanProps;
  labelProps?: SpanProps;
  valueProps?: SpanProps;
}

/**
 * A dot, a label, an optional value and whatever else the site appends.
 *
 * The three slots take their own props so a site keeps its `data-dtb-part`
 * names. The dot and the value carry a `data-dtb-kind` by default; the label
 * does not, because most sites leave it unstyled — pass
 * `labelProps={{ "data-dtb-kind": "label" }}` to opt into the kit's label
 * treatment, or `"data-dtb-kind": undefined` on the other slots to opt out.
 */
export const Chip = forwardRef<HTMLSpanElement, ChipProps>(function Chip(
  { children, dotProps, label, labelProps, severity, value, valueProps, ...rest },
  ref,
) {
  return (
    <span {...rest} ref={ref} data-dtb-kind="chip">
      <span data-dtb-kind="dot" data-dtb-severity={severity} aria-hidden="true" {...dotProps} />
      <span {...labelProps}>{label}</span>
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
  /**
   * Colours this element and nothing under it. Optional: a site with its own
   * tone vocabulary keeps it and omits this rather than taking the kit's
   * bordered treatment on top.
   */
  severity?: SeverityWithOverride;
}

/**
 * A padded, rounded message.
 *
 * Give it a `role`: the kit does not guess one, and nothing here supplies a
 * default, so a `Banner` without one is announced to nobody. `role="alert"`
 * interrupts, `role="status"` waits for a pause — the kit cannot know which
 * this message is.
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
