import { expect, test } from "./fixtures";

// Recipe: .claude/skills/verify-dev-toolbar/features/environment.md

interface EnvField {
  id: string;
  masked: boolean;
  markers: string[];
  value: string;
}
interface EnvState {
  environment: string;
  severity: string;
  supplied: boolean;
  impersonating: boolean;
  maskedCount: number;
  fields: EnvField[];
}

const SECRETS = ["super-secret", "abcdef123456", "rt-nested-secret", "nejc.mursic@example.com"];

test("masks the four secrets by value and leaves the rest alone", async ({ toolbar }) => {
  const env = (await toolbar.ext<EnvState>("environment"))!;
  expect(env).toMatchObject({ environment: "staging", severity: "warn", supplied: true });
  const field = (id: string) => env.fields.find((f) => f.id === id);

  expect(field("apiEndpoint")).toMatchObject({
    value: "https://api.example.com/v2?access_token=[redacted]",
    markers: ["masked"],
  });
  expect(field("userId")).toMatchObject({ value: "n***@example.com", markers: ["masked"] });
  expect(field("extra:authToken")).toMatchObject({ value: "[redacted]", markers: ["masked"] });
  expect(field("extra:identity")).toMatchObject({
    value: '{"email":"n***@example.com","refreshToken":"[redacted]"}',
    markers: ["masked"],
  });
  expect(env.maskedCount).toBe(4);

  for (const [id, value] of [
    ["release", "web-2026.08.28.4"],
    ["commit", "a84c7e1"],
    ["region", "ap-southeast-1"],
  ]) {
    expect(field(id!), id).toMatchObject({ value, masked: false, markers: [] });
  }
});

test("no secret reaches anything the toolbar publishes, or the panel", async ({
  toolbar,
  page,
}) => {
  const everything = JSON.stringify(await toolbar.read());
  for (const secret of SECRETS) expect(everything).not.toContain(secret);

  await toolbar.trigger("environment").click();
  await expect.poll(() => toolbar.read().then((s) => s.shell.activePanel)).toBe("environment");
  const panelText = await page.locator('[data-dtb-part="panel"]').innerText();
  for (const secret of SECRETS) expect(panelText).not.toContain(secret);
  expect(panelText).toContain("[redacted]");
});

test("impersonation outranks the environment's own severity", async ({ toolbar, page }) => {
  await page.getByTestId("env-impersonate").click();
  await expect
    .poll(() => toolbar.ext<EnvState>("environment").then((e) => e?.impersonating))
    .toBe(true);
  const env = (await toolbar.ext<EnvState>("environment"))!;
  expect(env.severity).toBe("bad");
  expect(env.fields.find((f) => f.id === "impersonation")?.markers).toContain("alarming");
});

test("an empty context is reported as unknown, never inferred", async ({ toolbar, page }) => {
  await page.getByTestId("env-supply").click();
  await expect.poll(() => toolbar.ext<EnvState>("environment").then((e) => e?.supplied)).toBe(false);
  expect((await toolbar.ext<EnvState>("environment"))?.environment).toBe("unknown");
});
