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
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
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

/**
 * Props for the panel search box. `value` and `onChange` are the pair the two
 * sites already hold in a `useState("")`; the state stays in the extension,
 * because a control that owned it could not be filtered against or reset.
 */
export interface SearchFieldProps
  extends
    Omit<InputHTMLAttributes<HTMLInputElement>, "aria-label" | "onChange" | "type" | "value">,
    DataAttributes {
  value: string;
  /** Receives the new value, not the event — every site reads only that. */
  onChange: (value: string) => void;
  /**
   * The accessible name, written as `aria-label`. Required, because a bare
   * `type="search"` with only a placeholder is announced as "search" and
   * nothing else. `aria-labelledby` still passes through `...rest` and wins in
   * the accessibility tree where a site has a visible heading to point at.
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
 * `<dd>` — the value cell is the one a site names and targets — so a stray
 * `data-dtb-part` lands somewhere rather than vanishing. The kit's `value` kind
 * wins over that spread; `valueProps` wins on a collision as the explicit way
 * to address the cell or opt out of its kind.
 */
export interface RowProps extends RowSlotProps {
  label: ReactNode;
  /** The value cell's content. */
  children?: ReactNode;
  labelProps?: RowSlotProps;
  valueProps?: RowSlotProps;
}

/**
 * A `<dt>`/`<dd>` pair, as a fragment, so the pairs stay direct children of the
 * `<Rows>` grid rather than being wrapped in an element that would break it.
 *
 * There is no `ref`: a fragment has no single DOM node, and inventing a wrapper
 * to hang one on would change the layout. A site that needs a ref writes the
 * two elements by hand — they are two lines.
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
 * A muted `<label>` wrapping its control, which *is* the association — no `id`
 * to generate, none to collide, and nothing to keep in sync. It is `Note as=
 * "label"` with the pattern named, so both are the same DOM.
 *
 * Where the control inside also carries an `aria-label`, that name wins over
 * this text in the accessibility tree. That is not a duplicate to tidy away:
 * both theme-editor sites do it deliberately, spelling out for a screen reader
 * what a one-word visible label means in context.
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
 * textarea)` rule, so the kit adds no rules of its own — `data-dtb-kind="field"`
 * is a hook, letting a consumer reach every kit field with one selector.
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
