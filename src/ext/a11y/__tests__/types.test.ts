import { expectTypeOf, it } from "vitest";
import { emptyReport } from "../index";
import type { A11ySnapshot } from "../index";

it("requires every field of the snapshot, the loading flag included", () => {
  const snapshot = {
    revision: 0,
    report: emptyReport("pending"),
    highlight: [],
    axeLoaded: false,
  };
  expectTypeOf(snapshot).toExtend<A11ySnapshot>();
  expectTypeOf<A11ySnapshot["axeLoaded"]>().toEqualTypeOf<boolean>();
  // A hand-built snapshot that leaves it out is a compile error, deliberately:
  // the runtime is the only thing that builds one (src/ext/README.md).
  expectTypeOf<{
    revision: number;
    report: ReturnType<typeof emptyReport>;
    highlight: [];
  }>().not.toExtend<A11ySnapshot>();
});
