import { expect, test } from "./fixtures";

// No recipe yet: theme-editor is listed as unmapped in features/README.md.

test("the share link carries the edit and masks the page URL's credential", async ({
  toolbar,
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await toolbar.goto("/?access_token=tok-theme-secret&tab=2");
  const edit = { name: "--pg-brand", value: "#ff0088" };
  expect(await toolbar.run("theme-editor.setToken", edit)).toEqual({ ok: true });
  expect(await toolbar.run("theme-editor.copyLink")).toEqual({ ok: true });

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).not.toContain("tok-theme-secret");
  const link = new URL(copied);
  expect(link.searchParams.get("access_token")).toBe("[redacted]");
  expect(link.searchParams.get("tab")).toBe("2");
  expect(JSON.parse(link.searchParams.get("dtb-theme") ?? "{}").overrides).toEqual({
    "--pg-brand": "#ff0088",
  });
});
