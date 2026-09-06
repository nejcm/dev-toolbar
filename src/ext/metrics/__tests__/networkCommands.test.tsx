/**
 * The four `network.*` commands (`plans/ecosystem-extensions.md` § 1A), driven
 * through the real shell's `invokeCommand` — the same path `/ext/agent` takes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { cleanupToolbar, installClipboard, mountToolbar } from "@nejcm/dev-toolbar/testing";
import { REDACTED } from "@nejcm/dev-toolbar/runtime";
import { metrics } from "../index";
import { formatBytes, formatMs, shortenUrl } from "../format";
import { createMetricsRuntime } from "../runtime";
import { createNetworkCollector } from "../collectors/network";
import { fakeExtensionApi } from "@nejcm/dev-toolbar/testing";
import type { NetworkExport, NetworkEntryView } from "../types";

const originalFetch = globalThis.fetch;

const response = (status = 200, length?: string) =>
  ({
    status,
    headers: { get: (name: string) => (name === "content-length" ? (length ?? null) : null) },
  }) as unknown as Response;

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => response(200, "128")) as unknown as typeof fetch;
});

afterEach(() => {
  cleanupToolbar();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const mount = (options: Parameters<typeof metrics>[0] = {}) =>
  mountToolbar(null, {
    extensions: [metrics({ only: ["network"], network: { patchXhr: false }, ...options })],
    layout: { barWidth: 900, itemWidth: 200 },
  });

/** Issues a request through the patched `fetch` and lets the store settle. */
const request = async (url: string, init?: RequestInit) => {
  await act(async () => {
    await globalThis.fetch(url, init);
  });
};

describe("network.export", () => {
  it("hands back the very array the panel is rendering", async () => {
    const { toolbar } = mount();
    await request("https://api.test/v1/orders?access_token=super-secret&page=2");
    toolbar.openPanel("metrics");

    const invocation = await toolbar.invokeCommand<NetworkExport>("metrics.network.export");
    expect(invocation.ok).toBe(true);
    const payload = (invocation as { ok: true; result: NetworkExport }).result;

    expect(payload.count).toBe(1);

    // What it holds is what the table paints, cell for cell.
    const panel = toolbar.panel("metrics");
    const rows = [
      ...(panel?.querySelectorAll('[data-dtb-part="metrics-requests"] tbody tr') ?? []),
    ];
    expect(rows).toHaveLength(1);
    const cells = [...(rows[0]?.querySelectorAll("td") ?? [])].map((cell) => cell.textContent);
    const entry = payload.requests[0] as NetworkEntryView;
    expect(cells).toEqual([
      entry.method,
      String(entry.status ?? entry.state),
      formatMs(entry.duration),
      entry.bytes === undefined ? "—" : formatBytes(entry.bytes, 1),
      shortenUrl(entry.url, 96),
    ]);

    // Redaction happened on the way in, so both surfaces inherit it.
    expect(entry.url).toBe(`https://api.test/v1/orders?access_token=${REDACTED}&page=2`);
    expect(JSON.stringify(payload)).not.toContain("super-secret");
    expect(panel?.textContent).not.toContain("super-secret");
  });

  it("reports the page URL redacted, and limits the tail on request", async () => {
    const { toolbar } = mount();
    await request("/api/one");
    await request("/api/two");

    const all = await toolbar.invokeCommand<NetworkExport>("metrics.network.export");
    expect((all as { result: NetworkExport }).result.requests.map((entry) => entry.url)).toEqual([
      "/api/two",
      "/api/one",
    ]);

    const one = await toolbar.invokeCommand<NetworkExport>("metrics.network.export", { limit: 1 });
    const payload = (one as { result: NetworkExport }).result;
    expect(payload.count).toBe(1);
    expect(payload.requests.map((entry) => entry.url)).toEqual(["/api/two"]);
    expect(payload.url).toBe("http://localhost:3000/");
    expect(Date.parse(payload.generatedAt)).not.toBeNaN();
  });

  it("copies the JSON only when asked, and refuses a limit that is not a number", async () => {
    const clipboard = installClipboard();
    try {
      const { toolbar } = mount();
      await request("/api/one");

      await toolbar.invokeCommand("metrics.network.export");
      expect(clipboard.writes).toEqual([]);

      await toolbar.invokeCommand("metrics.network.export", { copy: true });
      expect(JSON.parse(clipboard.writes[0] as string)).toMatchObject({ count: 1 });

      await expect(toolbar.invokeCommand("metrics.network.export", { limit: "2" })).rejects.toThrow(
        "`limit` must be a finite number.",
      );
    } finally {
      clipboard.restore();
    }
  });
});

it("returns the identical array the panel's snapshot holds", async () => {
  /**
   * Identity, not equality. The panel renders `store.getSnapshot().requests`
   * and `exportRequests()` returns that same object, so the two cannot drift
   * into different redaction, ordering or shape — the divergence the plan
   * calls "a bug, not a nuance". A second mapping written for the export
   * would fail this `toBe` while still passing a `toEqual`.
   */
  const collector = createNetworkCollector({ patchXhr: false });
  const runtime = createMetricsRuntime({ collectors: [collector] });
  const { api, abort } = fakeExtensionApi();
  runtime.start(api);
  await globalThis.fetch("/api/identity?token=nope");

  const payload = runtime.exportRequests();
  expect(payload.requests).toBe(runtime.store.getSnapshot().requests);
  expect(payload.requests.map((entry) => entry.url)).toEqual([`/api/identity?token=${REDACTED}`]);
  abort();
});

describe("network.copyAsCurl", () => {
  it("round-trips the most recent request with its query redacted", async () => {
    const clipboard = installClipboard();
    try {
      const { toolbar } = mount();
      await request("/api/orders?api_key=hunter2&page=3", { method: "post" });

      const invocation = await toolbar.invokeCommand<string>("metrics.network.copyAsCurl");
      const line = (invocation as { result: string }).result;

      expect(line).toBe(
        `curl -X 'POST' 'http://localhost:3000/api/orders?api_key=${REDACTED}&page=3'`,
      );
      expect(clipboard.writes).toEqual([line]);
      expect(line).not.toContain("hunter2");
    } finally {
      clipboard.restore();
    }
  });

  it("cannot leak what the panel hides — userinfo, tokens, or a shell escape", async () => {
    const { toolbar } = mount();
    // Every one of these is a way a credential reaches a curl line: the
    // `user:pass@` form curl accepts natively, a token in the query, and a
    // quote that would end the shell string early and turn the rest into
    // arguments.
    await request("https://alice:s3cret@api.test/v1?session_id=abc&q='%20whoami");

    const invocation = await toolbar.invokeCommand<string>("metrics.network.copyAsCurl", {
      copy: false,
    });
    const line = (invocation as { result: string }).result;

    expect(line).not.toContain("s3cret");
    expect(line).not.toContain("alice");
    expect(line).not.toContain("abc");
    expect(line).toContain(REDACTED);
    // The whole URL is one single-quoted shell argument, and the quote that
    // could have ended it early came back percent-encoded from the parser
    // rather than raw. (The escaping itself is covered in `curl.test.ts`,
    // against a string no URL parser will normalise.)
    expect(line).toBe(
      `curl 'https://${REDACTED}:${REDACTED}@api.test/v1?session_id=${REDACTED}&q=%27+whoami'`,
    );

    const panel = (() => {
      toolbar.openPanel("metrics");
      return toolbar.panel("metrics");
    })();
    expect(panel?.textContent).not.toContain("s3cret");
  });

  it("takes an id from the export, and says so when there is nothing to copy", async () => {
    const { toolbar } = mount();
    await expect(toolbar.invokeCommand("metrics.network.copyAsCurl")).rejects.toThrow(
      "No request has been recorded yet.",
    );

    await request("/api/first");
    await request("/api/second");
    const exported = (
      (await toolbar.invokeCommand<NetworkExport>("metrics.network.export")) as {
        result: NetworkExport;
      }
    ).result;
    const oldest = exported.requests.at(-1) as NetworkEntryView;

    const invocation = await toolbar.invokeCommand<string>("metrics.network.copyAsCurl", {
      id: oldest.id,
      copy: false,
    });
    expect((invocation as { result: string }).result).toBe(
      "curl 'http://localhost:3000/api/first'",
    );

    await expect(
      toolbar.invokeCommand("metrics.network.copyAsCurl", { id: "nope" }),
    ).rejects.toThrow('No retained request has id "nope"');
    await expect(toolbar.invokeCommand("metrics.network.copyAsCurl", { id: 7 })).rejects.toThrow(
      "`id` must be a string.",
    );
  });

  it("throws — and still names the line — when the clipboard is unavailable", async () => {
    const clipboard = installClipboard(null);
    try {
      const { toolbar } = mount();
      await request("/api/x");
      await expect(toolbar.invokeCommand("metrics.network.copyAsCurl")).rejects.toThrow(
        "The clipboard is unavailable. The line is this command's return value; copy it from there.",
      );
      // The escape hatch works with no clipboard at all.
      const invocation = await toolbar.invokeCommand<string>("metrics.network.copyAsCurl", {
        copy: false,
      });
      expect((invocation as { result: string }).result).toContain("curl ");
    } finally {
      clipboard.restore();
    }
  });
});

describe("network.clear and network.pause", () => {
  it("clears the request tail without touching the other collectors", async () => {
    const { toolbar } = mount({ only: ["memory", "network"] });
    await request("/api/x");
    expect(
      (
        (await toolbar.invokeCommand<NetworkExport>("metrics.network.export")) as {
          result: NetworkExport;
        }
      ).result.count,
    ).toBe(1);

    await toolbar.invokeCommand("metrics.network.clear");
    const after = (
      (await toolbar.invokeCommand<NetworkExport>("metrics.network.export")) as {
        result: NetworkExport;
      }
    ).result;
    expect(after.requests).toEqual([]);
    // The memory collector is untouched: it still reports a live view.
    toolbar.openPanel("metrics");
    expect(toolbar.panel("metrics")?.textContent).toContain("Memory");
  });

  it("stops recording, says so on the chip, and resumes", async () => {
    const { toolbar } = mount();
    await request("/api/before");

    const paused = await toolbar.invokeCommand<{ paused: boolean }>("metrics.network.pause");
    expect((paused as { result: { paused: boolean } }).result).toEqual({ paused: true });

    await request("/api/during");
    const tail = (
      (await toolbar.invokeCommand<NetworkExport>("metrics.network.export")) as {
        result: NetworkExport;
      }
    ).result;
    // The paused request is not recorded; the earlier one stays readable.
    expect(tail.requests.map((entry) => entry.url)).toEqual(["/api/before"]);

    // Visible, not silent: the chip and the panel both say so.
    expect(
      toolbar.item("metrics")?.querySelector('[data-dtb-part="metrics-value"]')?.textContent,
    ).toBe("paused");
    toolbar.openPanel("metrics");
    expect(toolbar.panel("metrics")?.textContent).toContain("paused");

    const resumed = await toolbar.invokeCommand<{ paused: boolean }>("metrics.network.pause", {
      paused: false,
    });
    expect((resumed as { result: { paused: boolean } }).result).toEqual({ paused: false });
    await request("/api/after");
    const again = (
      (await toolbar.invokeCommand<NetworkExport>("metrics.network.export")) as {
        result: NetworkExport;
      }
    ).result;
    expect(again.requests.map((entry) => entry.url)).toEqual(["/api/after", "/api/before"]);

    await expect(toolbar.invokeCommand("metrics.network.pause", { paused: "yes" })).rejects.toThrow(
      "`paused` must be a boolean, or omitted to toggle.",
    );
  });

  it("keeps the shared wrapper installed while paused", async () => {
    const { toolbar } = mount();
    const patched = globalThis.fetch;
    await toolbar.invokeCommand("metrics.network.pause");
    // Pausing a recorder is not a reason to hand a global back — anything else
    // observing requests through the same wrapper would go blind.
    expect(globalThis.fetch).toBe(patched);
  });
});

describe("the agent surface", () => {
  it("contributes the network commands only where the collector runs", async () => {
    const { toolbar } = mount({ only: ["memory"] });
    expect(toolbar.context().commands.map((command) => command.id)).toEqual([
      "metrics.reset",
      "metrics.copy",
    ]);
    cleanupToolbar();

    const withNetwork = mount();
    expect(withNetwork.toolbar.context().commands.map((command) => command.id)).toEqual([
      "metrics.reset",
      "metrics.copy",
      "metrics.network.export",
      "metrics.network.copyAsCurl",
      "metrics.network.clear",
      "metrics.network.pause",
    ]);
    await expect(withNetwork.toolbar.runCommand("metrics.network.clear")).resolves.toBe(true);
  });

  it("declares a description everywhere, and an input schema exactly where run takes one", () => {
    const { toolbar } = mount();
    const commands = toolbar.context().commands;
    expect(commands.length).toBeGreaterThan(4);

    for (const command of commands) {
      /**
       * Derived, not a roster: `run.length` is the arity the command actually
       * declared, so a command that grows an argument without a
       * `CommandInputSchema` — or keeps a schema it no longer reads — fails
       * here without anyone remembering to update a list.
       */
      expect(command.run.length > 0, `${command.id} arity vs input`).toBe(
        command.input !== undefined,
      );
      for (const [name, field] of Object.entries(command.input?.fields ?? {})) {
        expect(typeof field.description, `${command.id}.${name}`).toBe("string");
        expect(field.description, `${command.id}.${name}`).not.toBe("");
      }
      if (command.id.startsWith("metrics.network.")) {
        // Contract v2: a command with no description is a label and nothing
        // more to an agent deciding whether to call it.
        expect(typeof command.description, command.id).toBe("string");
        expect((command.description as string).length, command.id).toBeGreaterThan(40);
      }
    }
  });
});
