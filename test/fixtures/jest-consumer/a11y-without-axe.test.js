/**
 * The optional peer, proven optional: this fixture never opts into `axe-core`,
 * so requiring `./ext/a11y` and asking it to scan must reach the
 * `"unsupported"` state rather than throwing, rejecting, or hanging.
 *
 * `require.resolve("axe-core")` is deliberately **not** asserted to fail here:
 * Node walks up to the repo root, where axe is a devDependency of the library
 * itself, so a resolution check would be asserting the layout of the checkout
 * rather than this consumer's own dependencies. What this fixture proves is
 * the shape of the failure a CommonJS consumer actually gets — the packaged
 * `.cjs` keeps a native `import("axe-core")`, which under Jest does not
 * produce a module, and the extension has to survive that.
 */
const { a11y } = require("@nejcm/dev-toolbar/ext/a11y");
const pkg = require("./package.json");

test("this consumer never asked for axe-core", () => {
  expect(pkg.dependencies?.["axe-core"]).toBeUndefined();
  expect(pkg.devDependencies?.["axe-core"]).toBeUndefined();
});

test("the extension builds and enumerates its commands without the peer", () => {
  const extension = a11y();
  expect(extension.id).toBe("a11y");
  expect(extension.contractVersion).toBe(2);
  expect(extension.commands.map((command) => command.id)).toEqual([
    "a11y.scan",
    "a11y.export",
    "a11y.highlight",
    "a11y.clear",
  ]);
  // Nothing was loaded, so nothing can have thrown.
  expect(extension.diagnostics().status).toBe("pending");
});

test("scanning reports unsupported instead of throwing", async () => {
  const extension = a11y();
  const report = await extension.commands[0].run();

  expect(report.status).toBe("unsupported");
  expect(report.unsupportedReason).toContain("axe-core");
  expect(report.total).toBe(0);
  expect(extension.diagnostics()).toBe(report);
});
