import { expect, test } from "./fixtures";

// The dev-server half of the agent bridge: plugins/devToolbarAgent.ts. Its
// malformed-input handling is covered by `node --test`; this proves the whole
// loop — a page checks in, an agent that never loads the app reads and drives
// it over HTTP. The project runs serially after everything else because the
// plugin holds one snapshot slot per server (see playwright.config.ts).

test.describe.configure({ mode: "serial" });

test("GET /state answers with the live snapshot once a page has checked in", async ({
  toolbar,
  request,
}) => {
  // Pages from the main project may still be inside the plugin's 3 s
  // staleness window when this starts; wait for this page to be the only one.
  await expect
    .poll(
      async () => {
        const res = await request.get("/__dev-toolbar/state");
        if (res.status() !== 200) return res.status();
        const { connection } = await res.json();
        return connection.connected && !connection.ambiguous ? "sole-reporter" : connection;
      },
      { timeout: 10_000 },
    )
    .toBe("sole-reporter");
  const state = await (await request.get("/__dev-toolbar/state")).json();
  expect(state.connection).toMatchObject({ connected: true, ambiguous: false });
  expect(state.shell.mounted).toBe(true);
  expect(state.diagnostics.length).toBe((await toolbar.read()).diagnostics.length);
  expect(Object.keys(state.extensions)).toContain("flags");
});

test("GET /commands lists the registry with input schemas", async ({ toolbar, request }) => {
  // `toolbar` opens the page whose check-in fills the registry; without it
  // this test only passes on the previous test's leftovers.
  expect(toolbar).toBeDefined();
  await expect
    .poll(async () => (await request.get("/__dev-toolbar/commands")).status(), { timeout: 10_000 })
    .toBe(200);
  const body = await (await request.get("/__dev-toolbar/commands")).json();
  const ids = body.commands.map((c: { id: string }) => c.id);
  expect(ids).toContain("flags.set");
  expect(ids).toContain("overlays.disableAll");
  expect(body.commands.find((c: { id: string }) => c.id === "flags.set").input).toBeDefined();
});

test("POST /commands/:id runs on the open page and the state reflects it", async ({
  toolbar,
  request,
}) => {
  const res = await request.post("/__dev-toolbar/commands/flags.set", {
    data: { key: "search.rank", value: 9 },
  });
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, command: "flags.set" });

  await expect
    .poll(async () => {
      const state = await (await request.get("/__dev-toolbar/state")).json();
      return state.extensions.flags.flags.find((f: { key: string }) => f.key === "search.rank")
        ?.effective;
    })
    .toBe(9);
  const inPage = await toolbar.ext<{ flags: { key: string; effective: unknown }[] }>("flags");
  expect(inPage?.flags.find((f) => f.key === "search.rank")?.effective).toBe(9);

  const refused = await request.post("/__dev-toolbar/commands/flags.set", {
    data: { key: "new-header", value: "yes" },
  });
  expect(refused.status()).toBe(422);
  expect(await request.post("/__dev-toolbar/commands/nope").then((r) => r.status())).toBe(404);
});
