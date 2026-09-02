/**
 * `src/testing/heightVariable.ts` re-derives two internals of
 * `src/core/DevToolbar` rather than value-importing them, so that
 * `dist/testing.cjs` does not inline core. That is only safe while the two
 * copies agree — this is the test that keeps them agreeing.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_INSTANCE_ID as CORE_DEFAULT_INSTANCE_ID,
  instanceHeightVariable as coreInstanceHeightVariable,
} from "../../core/DevToolbar";
import { DEFAULT_INSTANCE_ID, instanceHeightVariable } from "../heightVariable";

describe("testing/heightVariable mirrors core", () => {
  it("uses the same default instance id", () => {
    expect(DEFAULT_INSTANCE_ID).toBe(CORE_DEFAULT_INSTANCE_ID);
  });

  it("builds the same variable name for every shape of id", () => {
    for (const id of ["default", "admin", "a b", "a.b:c", "", "Ünïcode", "1-2_3"]) {
      expect(instanceHeightVariable(id), id).toBe(coreInstanceHeightVariable(id));
    }
  });
});
