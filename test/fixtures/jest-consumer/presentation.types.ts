/**
 * The `presentation` option's **types**, through the package's `exports` map,
 * resolved as a CommonJS consumer on `moduleResolution: node16` would: the
 * `require` condition, so `dist/*.d.cts`, not `dist/*.d.ts`. Nothing here
 * runs — `tsconfig.json` compiles it with `--noEmit`, using the repo root's
 * own TypeScript.
 *
 * Separate from `presentation.test.js` because the kit vocabulary
 * (`CompactPresentation`, `CompactPreset`, `CompactRenderContext`) comes from
 * a shared dts chunk (`dist/presentation-*.d.cts`) that a rendered assertion
 * can't see silently widen to `any`. The `@ts-expect-error` lines below are
 * what make this a boundary test: with the chunk missing, `skipLibCheck`
 * swallows the broken import inside the `.d.cts` and the expected errors
 * stop happening (verified by deleting the chunk — the failure is loud
 * either way, but as a different TS code).
 *
 * Deliberately narrower than an `exports`-map typo check: TypeScript falls
 * back to the sibling `.d.cts` next to the resolved `.cjs`, so a bad
 * `require.types` path still compiles clean. That's `attw`'s job, inside
 * `check:package`.
 */
import React = require("react");
import kit = require("@nejcm/dev-toolbar/kit");
import env = require("@nejcm/dev-toolbar/ext/environment");
import metrics = require("@nejcm/dev-toolbar/ext/metrics");
import flags = require("@nejcm/dev-toolbar/ext/flags");

const icon: React.ReactNode = React.createElement("svg", { viewBox: "0 0 16 16" });

// The 90% case the plan names: the bare-preset shorthand, on a factory.
env.environment({ context: () => ({ environment: "test" }), presentation: "icon" });

// @ts-expect-error - "glyph" is not a CompactPreset; if the types hadn't
// crossed the boundary, `presentation` would be `any` and this wouldn't error.
env.environment({ context: () => ({ environment: "test" }), presentation: "glyph" });

// The full shape, with the view type flowing into the callbacks. `MetricView`
// reaches this file only through the shared dts chunk.
const presentation: kit.CompactPresentation<metrics.MetricView> = {
  preset: "icon-value",
  icon: (view) => (view.severity === "bad" ? icon : null),
  render: (view, ctx) => (view.id === "network" ? ctx.fallback : undefined),
  name: (view) => `${view.label}: ${view.value}`,
};
metrics.metrics({ presentation });

// @ts-expect-error - `MetricView` has no `missing`, so the callback parameter
// is genuinely typed rather than `any`.
metrics.metrics({ presentation: { render: (view) => view.missing } });

// Group B's per-control configuration: a `PromotedFlag` carries its own.
flags.flags({
  flags: () => [{ key: "new-header", label: "New header", type: "boolean", value: true }],
  promoted: [{ flagKey: "new-header", presentation: { preset: "icon", icon } }],
});

// The pure helpers are part of the published kit surface a third-party
// extension author uses, so they cross the boundary too.
const parts: kit.CompactParts | null = kit.resolveCompactParts("icon", {
  hasIcon: false,
  isOverflowed: false,
});
// Guarantee 1, asserted at the type level only: the return is nullable.
export const text: kit.CompactText = parts === null ? "full" : parts.text;
