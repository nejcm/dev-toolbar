import { useRef } from "react";
import type { DevToolbarClassNames } from "./contract";

const EMPTY_CLASS_NAMES: DevToolbarClassNames = {};

/** Field-by-field equality. Every value is `string | undefined`, so this is exact. */
function sameClassNames(a: DevToolbarClassNames, b: DevToolbarClassNames): boolean {
  if (a === b) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof DevToolbarClassNames>;
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

/**
 * Holds one `classNames` object identity for as long as its *strings* are
 * unchanged.
 *
 * `classNames={{ bar: "x" }}` written inline in JSX is a new object every
 * render, and two things key on that identity: the context value's `useMemo`,
 * which would then re-run for every consumer of `useDevToolbar()`, and
 * `OverlayHost`'s `memo`, which would re-invoke every extension's overlay slot
 * on every panel-height drag frame — exactly the two costs those memos exist
 * to avoid.
 *
 * Chosen over documenting "hoist the object": the inline form is the natural
 * React idiom, a doc note is unenforceable, and eleven optional string fields
 * make the comparison exact rather than a heuristic. The ref is written during
 * render, which is safe because the write is idempotent and derived purely
 * from props — a discarded render can only store a value string-equal to the
 * one the retried render would produce.
 */
export function useStableClassNames(next: DevToolbarClassNames | undefined): DevToolbarClassNames {
  const held = useRef<DevToolbarClassNames>(EMPTY_CLASS_NAMES);
  const value = next ?? EMPTY_CLASS_NAMES;
  /* oxlint-disable react/refs -- read and written in render on purpose, above. */
  if (!sameClassNames(held.current, value)) held.current = value;
  return held.current;
  /* oxlint-enable react/refs */
}
