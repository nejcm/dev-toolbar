import { expect, test } from "./fixtures";
import type { Toolbar } from "./fixtures";

// Recipe: .claude/skills/verify-dev-toolbar/features/diagnostics.md

interface ConsoleCounts {
  status: string;
  errors: number | null;
  warnings: number | null;
  watching: string[];
}
interface ConsoleEntry {
  source: string;
  message: string;
  count: number;
}
interface ConsoleReport extends ConsoleCounts {
  entries: ConsoleEntry[];
}

const SECRETS = ["sess-console-secret", "tok-console-secret"];

const counts = (toolbar: Toolbar) =>
  toolbar.ext<{ console: ConsoleCounts }>("diagnostics").then((d) => d?.console);

async function exportTail(toolbar: Toolbar): Promise<ConsoleReport> {
  const run = await toolbar.run("diagnostics.console.export");
  expect(run.ok).toBe(true);
  return (run as { result: ConsoleReport }).result;
}

test("counts the three error sources, never console.log, and masks on the way in", async ({
  toolbar,
  page,
}) => {
  expect(await counts(toolbar)).toMatchObject({
    status: "capturing",
    watching: ["console.error", "console.warn", "window.error", "unhandledrejection"],
  });
  expect(await toolbar.run("diagnostics.console.clear")).toEqual({ ok: true });
  await expect.poll(() => counts(toolbar).then((c) => c?.errors)).toBe(0);

  // `console-log` goes first, so the `1` below would be a `2` if it counted.
  await page.getByTestId("console-log").click();
  await page.getByTestId("console-error").click();
  await expect
    .poll(() => counts(toolbar).then((c) => [c?.errors, c?.warnings]))
    .toEqual([1, 0]);
  await page.getByTestId("console-throw").click();
  await page.getByTestId("console-reject").click();
  await expect
    .poll(() => counts(toolbar).then((c) => [c?.errors, c?.warnings]))
    .toEqual([3, 0]);

  const report = await exportTail(toolbar);
  expect(report.entries.map((e) => e.source).sort()).toEqual([
    "console.error",
    "unhandledrejection",
    "window.error",
  ]);
  expect(JSON.stringify(report.entries)).not.toContain("never captured, by design");
  const checkout = report.entries.find((e) => e.message.startsWith("checkout failed"));
  expect(checkout?.message).toContain('"sessionToken":"[redacted]"');
  expect(checkout?.message).toContain("access_token=[redacted]");

  const capture = await toolbar.run("diagnostics.capture");
  expect(capture.ok).toBe(true);
  const everywhere = {
    export: JSON.stringify(report),
    capture: JSON.stringify(capture),
    read: JSON.stringify(await toolbar.read()),
  };
  for (const [where, text] of Object.entries(everywhere)) {
    for (const secret of SECRETS) expect(text, `${secret} in ${where}`).not.toContain(secret);
  }
});

test("a repeated error folds into one entry and counts every event", async ({
  toolbar,
  page,
}) => {
  expect(await toolbar.run("diagnostics.console.clear")).toEqual({ ok: true });
  await expect.poll(() => counts(toolbar).then((c) => c?.errors)).toBe(0);

  await page.getByTestId("console-repeat").click();
  await expect.poll(() => counts(toolbar).then((c) => c?.errors)).toBe(5);
  const report = await exportTail(toolbar);
  expect(report.entries).toEqual([
    expect.objectContaining({
      source: "console.error",
      message: "render loop: state updated during render",
      count: 5,
    }),
  ]);
});
