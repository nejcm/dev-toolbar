/**
 * `DEFAULT_INSTANCE_ID` and `instanceHeightVariable` mirror the internal ones
 * in `src/core/DevToolbar` and `src/core/useHeightVariables`, which
 * `src/testing` may not value-import (it would
 * inline core's whole React context into `dist/testing.cjs`, since tsup's CJS
 * output has no code splitting). Both are stateless, so duplicating them is
 * safe; `__tests__/heightVariable.test.ts` asserts they stay in agreement.
 */
import { HEIGHT_VARIABLE } from "@nejcm/dev-toolbar";

/** Mirrors `DEFAULT_INSTANCE_ID` in `src/core/DevToolbar`. */
export const DEFAULT_INSTANCE_ID = "default";

/** Mirrors `instanceHeightVariable` in `src/core/useHeightVariables`. */
export function instanceHeightVariable(instanceId: string): string {
  return `${HEIGHT_VARIABLE}-${instanceId.replace(/[^A-Za-z0-9_-]+/g, "_")}`;
}
