/**
 * Generated ids, and how a test may look at them. [dev-toolbar/test-utils]
 *
 * `aria-describedby` needs an `id` on its target, and those ids come from
 * React's `useId()` (the convention `/ext/metrics`' panel already follows,
 * since an id derived from the extension id would collide across two
 * `<DevToolbar>`s on one page). `useId()`'s format differs between React 18
 * and 19, and the peer range is `react: ">=18"`, so its value must never end
 * up inside one of this repo's pinned DOM literals — `canonicaliseIds`
 * rewrites just the *values* of `id` and `aria-describedby`, so a literal
 * still fails when one goes missing, moves, or appears where it shouldn't.
 *
 * What a canonicalised literal can't catch is a *mismatch* — an
 * `aria-describedby` pointing at an id nothing carries. `describedBy` and
 * `describedByIds` assert that separately; that assertion has the teeth.
 *
 * Nothing under `src/test-utils/` is a published entrypoint (AGENTS.md).
 */

/**
 * `html` with every `id` and `aria-describedby` *value* replaced by `#`.
 *
 * Deliberately blunt about lists: metrics' one bar button describes itself with
 * N value spans, and collapsing the whole attribute value to a single `#` keeps
 * the literal readable at the price of not pinning how many. `describedByIds`
 * pins the count, and `describedBy` pins where they point.
 */
export function canonicaliseIds(html: string): string {
  // The lookbehind, not `\b`: `-` is a non-word character, so `\bid=` matches
  // the tail of `data-dtb-ext-id="metrics"` and would blank a pinned attribute
  // that is not a generated id at all. `(?<![\w-])` requires the attribute
  // name to start the token.
  return html.replace(/(?<![\w-])(id|aria-describedby)="[^"]*"/g, '$1="#"');
}

/** The ids in an element's `aria-describedby`, in order. Empty when it has none. */
export function describedByIds(element: Element): string[] {
  const value = element.getAttribute("aria-describedby");
  return value === null ? [] : value.split(/\s+/).filter((id) => id !== "");
}

/**
 * The elements an `aria-describedby` resolves to, looked up the way a browser
 * does it: by id, in the element's own document.
 *
 * A `null` entry is a dangling IDREF — an `aria-describedby` naming an id
 * nothing carries, which announces nothing and is exactly what a canonicalised
 * literal cannot see.
 */
export function describedBy(element: Element): (Element | null)[] {
  const doc = element.ownerDocument;
  return describedByIds(element).map((id) => doc.getElementById(id));
}

/** What a screen reader would read out as the description: the targets' text, joined. */
export function description(element: Element): string {
  return describedBy(element)
    .map((target) => target?.textContent ?? "")
    .join(" ");
}
