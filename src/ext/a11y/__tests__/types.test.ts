import { expectTypeOf, it } from "vitest";
import { emptyReport } from "../index";
import type { A11ySnapshot } from "../index";

it("lets a hand-built snapshot leave the loading flag out", () => {
  const snapshot = { revision: 0, report: emptyReport("pending"), highlight: [] };
  expectTypeOf(snapshot).toExtend<A11ySnapshot>();
  expectTypeOf<A11ySnapshot["axeLoaded"]>().toEqualTypeOf<boolean | undefined>();
});
