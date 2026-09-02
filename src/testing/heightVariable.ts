/**
 * `DEFAULT_INSTANCE_ID` and `instanceHeightVariable` in `src/core/DevToolbar`
 * are internal — deliberately not on any entry point — and `src/testing` may
 * not value-import a relative path into `core/`: doing so inlines the whole of
 * `core/DevToolbar` (and the React context underneath it) into
 * `dist/testing.cjs`, because tsup's CJS output has no code splitting.
 *
 * Both are stateless — a string constant and a pure function — so a second
 * copy of them is harmless in a way a second copy of a context is not. They
 * are re-derived here from the *public* `HEIGHT_VARIABLE`, and
 * `__tests__/heightVariable.test.ts` asserts they still agree with core's.
 */
import { HEIGHT_VARIABLE } from "@nejcm/dev-toolbar";

/** Mirrors `DEFAULT_INSTANCE_ID` in `src/core/DevToolbar`. */
export const DEFAULT_INSTANCE_ID = "default";

/** Mirrors `instanceHeightVariable` in `src/core/DevToolbar`. */
export function instanceHeightVariable(instanceId: string): string {
  return `${HEIGHT_VARIABLE}-${instanceId.replace(/[^A-Za-z0-9_-]+/g, "_")}`;
}
