/**
 * The scan, the masking and the highlight, driven rather than described: axe's
 * results are foreign data, so every claim about what reaches the report is
 * made by running the code that builds it — including against the real
 * `axe-core` peer, which jsdom is enough of a browser for.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import { fakeExtensionApi } from "@nejcm/dev-toolbar/testing";
import { DEFAULT_NODE_LIMIT, TOOLBAR_EXCLUDE, createA11yRuntime } from "../runtime";
import { emptyReport, selectionKey, worstImpact } from "../types";
import type { AxeLike, Impact } from "../types";

/** The real peer must satisfy the structural type we declare instead of importing its. */
const realAxe: AxeLike = axe;

interface NodeSpec {
  target?: readonly string[];
  html?: string;
  failureSummary?: string;
}

const violation = (
  id: string,
  impact: Impact | null,
  nodes: readonly NodeSpec[],
  extra: Record<string, unknown> = {},
) => ({
  id,
  impact,
  help: `${id} help`,
  helpUrl: `https://dequeuniversity.com/rules/axe/4.10/${id}`,
  tags: ["wcag2a"],
  nodes: nodes.map((node) => ({
    target: node.target ?? ["#one"],
    html: node.html ?? "<div></div>",
    failureSummary: node.failureSummary ?? null,
  })),
  ...extra,
});

const stubAxe = (results: unknown, version = "4.10.0") => {
  const run = vi.fn(async () => results);
  const stub: AxeLike = { version, run };
  return { stub, run, load: () => Promise.resolve(stub) };
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the optional peer", () => {
  it("reports unsupported instead of throwing when axe cannot be imported", async () => {
    const runtime = createA11yRuntime({
      load: () => Promise.reject(new Error("Cannot find module 'axe-core'")),
    });
    const fake = fakeExtensionApi();
    const stop = runtime.start(fake.api);

    const report = await runtime.scan();

    expect(report.status).toBe("unsupported");
    expect(report.unsupportedReason).toContain("axe-core is not installed");
    expect(report.unsupportedReason).toContain("npm install --save-dev axe-core");
    expect(report.total).toBe(0);
    expect(report.running).toBe(false);
    expect(runtime.store.getSnapshot().report.status).toBe("unsupported");
    stop();
  });

  it("reports unsupported when the module resolves but is not axe", async () => {
    const runtime = createA11yRuntime({
      load: () => Promise.resolve({} as AxeLike),
    });
    const report = await runtime.scan();
    expect(report.status).toBe("unsupported");
    expect(report.unsupportedReason).toContain("exposes no run()");
  });

  it("accepts the interop shape where axe arrives as `default`", async () => {
    const { stub } = stubAxe({ violations: [] });
    const runtime = createA11yRuntime({
      load: () => Promise.resolve({ default: stub } as unknown as AxeLike),
    });
    const report = await runtime.scan();
    expect(report.status).toBe("ok");
    expect(report.axeVersion).toBe("4.10.0");
  });

  it("imports axe when the extension starts, before anything asks for a scan", async () => {
    const load = vi.fn(() => Promise.resolve(stubAxe({ violations: [] }).stub));
    const runtime = createA11yRuntime({ load });
    const fake = fakeExtensionApi();

    const stop = runtime.start(fake.api);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    expect(runtime.report().axeVersion).toBe("4.10.0");
    // Loaded is not scanned: the expensive half still waits to be asked.
    expect(runtime.report().status).toBe("pending");
    expect(runtime.report().scans).toBe(0);
    stop();
  });

  it("scans at start only when asked to", async () => {
    const { run, load } = stubAxe({ violations: [] });
    const runtime = createA11yRuntime({ load, scanOnStart: true });
    const stop = runtime.start(fakeExtensionApi().api);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    stop();
  });
});

describe("grouping and counts", () => {
  it("groups violations by impact, worst first, and counts elements exactly", async () => {
    const { load } = stubAxe({
      violations: [
        violation("minor-rule", "minor", [{}]),
        violation("critical-rule", "critical", [{}, {}]),
        violation("serious-rule", "serious", [{}]),
        violation("another-critical", "critical", [{}]),
      ],
      passes: [{}, {}, {}],
      incomplete: [{}],
      testEngine: { version: "4.11.1" },
    });
    const runtime = createA11yRuntime({ load });

    const report = await runtime.scan();

    expect(report.groups.map((group) => [group.impact, group.count])).toEqual([
      ["critical", 2],
      ["serious", 1],
      ["minor", 1],
    ]);
    expect(report.counts).toEqual({ critical: 2, serious: 1, moderate: 0, minor: 1 });
    expect(report.total).toBe(4);
    expect(report.nodeTotal).toBe(5);
    expect(report.passes).toBe(3);
    expect(report.incomplete).toBe(1);
    expect(report.axeVersion).toBe("4.11.1");
    expect(report.scans).toBe(1);
    expect(worstImpact(report.counts)).toBe("critical");
  });

  it("treats a violation with no impact as minor rather than dropping it", async () => {
    const { load } = stubAxe({ violations: [violation("no-impact", null, [{}])] });
    const report = await createA11yRuntime({ load }).scan();
    expect(report.groups).toEqual([expect.objectContaining({ impact: "minor", count: 1 })]);
  });

  it("caps the listed elements and says so, keeping the count exact", async () => {
    const nodes = Array.from({ length: 9 }, (_, index) => ({ target: [`#n${index}`] }));
    const { load } = stubAxe({ violations: [violation("many", "serious", nodes)] });
    const report = await createA11yRuntime({ load, nodeLimit: 3 }).scan();
    const only = report.groups[0]?.violations[0];

    expect(only?.nodeCount).toBe(9);
    expect(only?.nodes).toHaveLength(3);
    expect(only?.truncated).toBe(true);
    expect(report.nodeTotal).toBe(9);
  });

  it.each([undefined, null, "hello", 42, { violations: "x" }])(
    "refuses to call %o a clean page — the one wrong answer that matters",
    async (result) => {
      const { load } = stubAxe(result);
      const report = await createA11yRuntime({ load }).scan();
      // A green `0` from a module that is not axe is worse than an error.
      expect(report.status).toBe("failed");
      expect(report.error).toContain("not an axe result");
      expect(report.total).toBe(0);
      expect(report.groups).toEqual([]);
    },
  );

  it("still coerces a malformed entry inside a real violations array", async () => {
    const { load } = stubAxe({ violations: [null] });
    const report = await createA11yRuntime({ load }).scan();
    expect(report.status).toBe("ok");
    expect(report.total).toBe(1);
    expect(report.groups[0]?.violations[0]?.rule).toBe("unknown");
  });

  it("records a thrown run as failed, with the reason", async () => {
    const runtime = createA11yRuntime({
      load: () => Promise.resolve({ run: () => Promise.reject(new Error("boom")) }),
    });
    const report = await runtime.scan();
    expect(report.status).toBe("failed");
    expect(report.error).toContain("axe.run() threw");
    expect(report.error).toContain("boom");
    expect(report.running).toBe(false);
  });

  it("describes a thrown value that is not an Error", async () => {
    const runtime = createA11yRuntime({
      // A non-Error rejection, which is what a hostile page can produce.
      load: () => Promise.resolve({ run: () => Promise.reject("just a string") }),
    });
    const report = await runtime.scan();
    expect(report.status).toBe("failed");
    expect(report.error).toContain("just a string");
  });

  it("publishes nothing from a scan that lands after teardown", async () => {
    let release: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const runtime = createA11yRuntime({ load: () => Promise.resolve({ run: () => pending }) });
    const fake = fakeExtensionApi();
    const stop = runtime.start(fake.api);
    const scan = runtime.scan();
    await vi.waitFor(() => expect(runtime.report().running).toBe(true));

    stop();
    release({ violations: [violation("late", "critical", [{}])] });
    await scan;

    // The results are dropped, not applied to a torn-down extension.
    expect(runtime.report().total).toBe(0);
    expect(runtime.report().status).not.toBe("ok");
  });

  it("shares one axe pass between concurrent callers, and answers both", async () => {
    let release: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const run = vi.fn(() => pending);
    const runtime = createA11yRuntime({ load: () => Promise.resolve({ run }) });

    const first = runtime.scan();
    await vi.waitFor(() => expect(runtime.report().running).toBe(true));
    const second = runtime.scan();

    release({ violations: [] });
    const [a, b] = await Promise.all([first, second]);

    // axe refuses to run twice at once, so a second caller must join the pass
    // rather than start one — and must get the result, not a stale report.
    expect(run).toHaveBeenCalledTimes(1);
    expect(a.status).toBe("ok");
    expect(b).toBe(a);
    expect(runtime.report().scans).toBe(1);
    expect(runtime.report().running).toBe(false);
  });

  it("guards the second caller before the peer is even loaded", async () => {
    // Both calls happen in one tick, so the guard has to be in place *before*
    // the `await` that loads axe — axe's own "already running" error is what
    // reaching `run()` twice produces.
    const run = vi.fn(async () => ({ violations: [] }));
    const runtime = createA11yRuntime({ load: () => Promise.resolve({ run }) });

    const [a, b] = await Promise.all([runtime.scan(), runtime.scan()]);

    expect(run).toHaveBeenCalledTimes(1);
    expect(a.status).toBe("ok");
    expect(b).toBe(a);
    expect(runtime.report().scans).toBe(1);
  });

  it("scans again after the first pass settles", async () => {
    const { load, run } = stubAxe({ violations: [] });
    const runtime = createA11yRuntime({ load });
    await runtime.scan();
    await runtime.scan();
    expect(run).toHaveBeenCalledTimes(2);
    expect(runtime.report().scans).toBe(2);
  });
});

describe("what reaches the report", () => {
  const SECRETS = [
    "hunter2",
    "tok_live_51secret",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.dBjftJeZ4CVPmB92K27u",
    "sess-abcdef",
  ];

  it("masks credentials in element markup, targets and summaries", async () => {
    const { load } = stubAxe({
      violations: [
        violation("label", "critical", [
          {
            target: ['input[name="card"]'],
            html:
              '<input type="password" name="pw" value="hunter2" data-token="tok_live_51secret" ' +
              'aria-label="Password" class="field">',
            failureSummary:
              "Fix any of the following: retry https://api.example.com/login?session=sess-abcdef",
          },
          {
            target: ["#jwt"],
            html: '<div title="ok">eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.dBjftJeZ4CVPmB92K27u</div>',
          },
        ]),
      ],
    });

    const report = await createA11yRuntime({ load }).scan();
    const serialised = JSON.stringify(report);

    for (const secret of SECRETS) {
      expect(serialised, `"${secret}" must not reach the report`).not.toContain(secret);
    }

    const nodes = report.groups[0]?.violations[0]?.nodes ?? [];
    // The a11y-relevant attributes are what the panel is for, so they survive.
    expect(nodes[0]?.html).toContain('aria-label="Password"');
    expect(nodes[0]?.html).toContain('class="field"');
    expect(nodes[0]?.html).toContain('type="password"');
    expect(nodes[0]?.html).toContain('value="[redacted]"');
    expect(nodes[0]?.html).toContain('data-token="[redacted]"');
    expect(nodes[0]?.summary).toContain("[redacted]");
    expect(nodes[1]?.html).toContain("[redacted]");
    expect(nodes[1]?.html).toContain('title="ok"');
  });

  it("masks a credential in a text node, not just in an attribute", async () => {
    const { load } = stubAxe({
      violations: [
        violation("link-name", "serious", [
          {
            html: '<a href="/x">Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.dBjftJeZ4CVPmB92</a>',
          },
        ]),
      ],
    });
    const report = await createA11yRuntime({ load }).scan();
    expect(JSON.stringify(report)).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("does NOT catch a credential once anything precedes it — the real boundary", async () => {
    // The limit is "is the whole value", not "is short": a complete bearer
    // token is masked on its own and survives one word of prefix away. Pinned
    // as a pair so the boundary cannot be mis-stated in either direction.
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.dBjftJeZ4CVPmB92";
    const { load } = stubAxe({
      violations: [
        violation("link-name", "serious", [
          { html: `<a href="/x">Bearer ${jwt}</a>` },
          { html: `<p>Authorization: Bearer ${jwt}</p>` },
          { html: '<button aria-label="key sk-9f2a7c">b</button>' },
          { html: '<img alt="AKIAIOSFODNN7EXAMPLE">' },
        ]),
      ],
    });
    const report = await createA11yRuntime({ load }).scan();
    const nodes = report.groups[0]?.violations[0]?.nodes ?? [];

    expect(nodes[0]?.html).not.toContain(jwt);
    expect(nodes[1]?.html).toContain(jwt);
    // `title`, `alt`, `placeholder` and `aria-*` are kept, and kept means
    // whole-value masking only — a prefix carries the rest through.
    expect(nodes[2]?.html).toContain("sk-9f2a7c");
    // And `redact()` has no AWS-key *shape*, so a whole-value one survives:
    // the anchoring is not the only limit.
    expect(nodes[3]?.html).toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("does NOT catch a credential mid-sentence in text — the known limit, pinned", async () => {
    // `redact()`'s value matching is anchored: it masks a string that *is* a
    // credential, not one embedded in prose. Documented in docs/ext/a11y.md;
    // asserted here so the gap cannot close silently and be assumed absent.
    const { load } = stubAxe({
      violations: [
        violation("link-name", "serious", [{ html: '<a href="/x">key is sk-9f2a7c</a>' }]),
      ],
    });
    const report = await createA11yRuntime({ load }).scan();
    expect(report.groups[0]?.violations[0]?.nodes[0]?.html).toContain("sk-9f2a7c");
  });

  it("masks a sensitive query parameter in a *relative* href or src", async () => {
    // The common SPA shape. A substring pass keyed on `scheme://` never sees
    // one, so `href`/`src` go through the URL redactor as whole values.
    const { load } = stubAxe({
      violations: [
        violation("link-name", "serious", [
          { html: '<a href="/reset?token=abc123SECRETvalue&page=2">go</a>' },
          { html: '<img src="/avatar.png?session=sess-abcdef" alt="me">' },
        ]),
      ],
    });
    const report = await createA11yRuntime({ load }).scan();
    const nodes = report.groups[0]?.violations[0]?.nodes ?? [];

    expect(nodes[0]?.html).toBe('<a href="/reset?token=[redacted]&page=2">go</a>');
    expect(nodes[1]?.html).toBe('<img src="/avatar.png?session=[redacted]" alt="me">');
  });

  it("masks a sensitive query parameter in a kept attribute", async () => {
    const { load } = stubAxe({
      violations: [
        violation("link-name", "serious", [
          { html: '<a href="https://x.test/cb?token=tok_live_51secret&page=2">go</a>' },
        ]),
      ],
    });
    const report = await createA11yRuntime({ load }).scan();
    const html = report.groups[0]?.violations[0]?.nodes[0]?.html ?? "";
    expect(html).not.toContain("tok_live_51secret");
    expect(html).toContain("page=2");
  });

  it("keeps an unparseable snippet out of the report rather than passing it through", async () => {
    const { load } = stubAxe({
      violations: [violation("x", "minor", [{ html: "<input value=hunter2 aria-hidden=true>" }])],
    });
    const report = await createA11yRuntime({ load }).scan();
    expect(JSON.stringify(report)).not.toContain("hunter2");
  });

  it("masks a `data-*` value that contains a quoted `>`", async () => {
    // Ending a tag at the first `>` ends it *inside* the quotes and carries the
    // tail through unmasked. Real axe exports exactly this markup.
    document.body.innerHTML = `<main><img src="/logo.png" data-secret="prefix>MY_SECRET"></main>`;
    const report = await createA11yRuntime({
      load: () => Promise.resolve(realAxe),
      axeOptions: { runOnly: ["image-alt"] },
    }).scan();

    expect(report.groups[0]?.violations[0]?.nodes[0]?.html).toContain('data-secret="[redacted]"');
    expect(JSON.stringify(report)).not.toContain("MY_SECRET");
  });

  it("drops a snippet whose quoting never closes rather than emitting it raw", async () => {
    const { load } = stubAxe({
      violations: [violation("x", "minor", [{ html: '<img alt="a" data-secret="hunter2' }])],
    });
    const report = await createA11yRuntime({ load }).scan();
    expect(report.groups[0]?.violations[0]?.nodes[0]?.html).toBe("[unreadable]");
  });

  it("caps a snippet and a summary instead of copying a hundred kilobytes", async () => {
    const { load } = stubAxe({
      violations: [
        violation("x", "minor", [
          { html: `<p>${"word ".repeat(30_000)}</p>`, failureSummary: "line ".repeat(30_000) },
          { html: `<p>${"<span>x</span>".repeat(5_000)}</p>` },
          { html: `<img alt="${"alt ".repeat(30_000)}">` },
        ]),
      ],
    });
    const nodes = (await createA11yRuntime({ load }).scan()).groups[0]?.violations[0]?.nodes ?? [];

    for (const node of nodes) expect(node.html.length).toBeLessThan(10_000);
    expect(nodes[0]?.html).toContain("[truncated]");
    expect(nodes[0]?.summary?.length).toBeLessThan(10_000);
    expect(nodes[1]?.html).toContain("[truncated]");
    // Truncating an attribute value could split a token, so an oversized one
    // goes wholesale instead.
    expect(nodes[2]?.html).toBe('<img alt="[redacted]">');
  });
});

describe("axe's arguments", () => {
  it("excludes the toolbar's own DOM by default and passes rules through", async () => {
    const { run, load } = stubAxe({ violations: [] });
    const runtime = createA11yRuntime({
      load,
      rules: { "color-contrast": { enabled: false } },
      axeOptions: { resultTypes: ["violations"] },
    });

    await runtime.scan();

    expect(run).toHaveBeenCalledWith(
      { exclude: [[TOOLBAR_EXCLUDE]] },
      { resultTypes: ["violations"], rules: { "color-contrast": { enabled: false } } },
    );
  });

  it("asks for violations in full even when `resultTypes` leaves them out", async () => {
    // axe truncates an omitted type's nodes to one, with nothing in the output
    // to say so, which would quietly make `nodeCount` a lie.
    document.body.innerHTML = `<main><img src="/a.png"><img src="/b.png"></main>`;
    const report = await createA11yRuntime({
      load: () => Promise.resolve(realAxe),
      axeOptions: { runOnly: ["image-alt"], resultTypes: ["passes"] },
    }).scan();

    expect(report.nodeTotal).toBe(2);
    expect(report.groups[0]?.violations[0]?.nodeCount).toBe(2);
    expect(report.groups[0]?.violations[0]?.truncated).toBe(false);
  });

  it("keeps the result types the caller did ask for", async () => {
    let seen: unknown;
    const load = () =>
      Promise.resolve({
        run: (_context: unknown, options: unknown) => {
          seen = options;
          return Promise.resolve({ violations: [] });
        },
      } as AxeLike);

    await createA11yRuntime({ load, axeOptions: { resultTypes: ["passes"] } }).scan();
    expect(seen).toMatchObject({ resultTypes: ["passes", "violations"] });
  });

  it("lets a caller replace the context outright", async () => {
    const { run, load } = stubAxe({ violations: [] });
    await createA11yRuntime({ load, context: "#app" }).scan();
    expect(run).toHaveBeenCalledWith("#app", {});
  });
});

describe("the highlight", () => {
  it("measures the selected element and follows the page as it scrolls", async () => {
    document.body.innerHTML = `<main><button id="one">one</button></main>`;
    const target = document.getElementById("one") as HTMLElement;
    let box = { x: 10, y: 20, width: 30, height: 40 };
    target.getBoundingClientRect = () => ({ ...box, top: box.y, left: box.x }) as DOMRect;

    const { load } = stubAxe({
      violations: [violation("label", "critical", [{ target: ["#one"] }])],
    });
    const runtime = createA11yRuntime({ load });
    await runtime.scan();

    const key = selectionKey("label", 0);
    runtime.select(key);
    runtime.store.flush();
    expect(runtime.store.getSnapshot().highlight).toEqual([
      { key, rect: box, label: "label", impact: "critical" },
    ]);
    expect(runtime.report().selected).toBe(key);

    box = { x: 10, y: -60, width: 30, height: 40 };
    window.dispatchEvent(new Event("scroll"));
    await vi.waitFor(() => {
      runtime.store.flush();
      expect(runtime.store.getSnapshot().highlight[0]?.rect.y).toBe(-60);
    });

    runtime.select(null);
    runtime.store.flush();
    expect(runtime.store.getSnapshot().highlight).toEqual([]);
    expect(runtime.report().selected).toBeNull();
  });

  it("refuses a key it never scanned, and an element axe reached through an iframe", async () => {
    const { load } = stubAxe({
      violations: [violation("frame-rule", "serious", [{ target: ["#frame", "#inside"] }])],
    });
    const runtime = createA11yRuntime({ load });
    await runtime.scan();

    expect(runtime.select("nope#0").selected).toBeNull();
    expect(runtime.select(selectionKey("frame-rule", 0)).selected).toBeNull();
  });

  it("survives a target selector the document cannot parse", async () => {
    const { load } = stubAxe({
      violations: [violation("bad-target", "serious", [{ target: ["#a:has(("] }])],
    });
    const runtime = createA11yRuntime({ load });
    await runtime.scan();

    const report = runtime.select(selectionKey("bad-target", 0));
    runtime.store.flush();
    expect(report.selected).toBe(selectionKey("bad-target", 0));
    expect(runtime.store.getSnapshot().highlight).toEqual([]);
  });

  it("draws nothing when the element has since left the document", async () => {
    document.body.innerHTML = `<main><button id="one">one</button></main>`;
    const { load } = stubAxe({
      violations: [violation("label", "critical", [{ target: ["#one"] }])],
    });
    const runtime = createA11yRuntime({ load });
    await runtime.scan();
    document.body.innerHTML = "";

    runtime.select(selectionKey("label", 0));
    runtime.store.flush();
    expect(runtime.store.getSnapshot().highlight).toEqual([]);
    // Still selected: the report says which element, the geometry says it is gone.
    expect(runtime.report().selected).toBe(selectionKey("label", 0));
  });

  it("drops the highlight while the bar is hidden and stops listening on teardown", async () => {
    document.body.innerHTML = `<main><button id="one">one</button></main>`;
    const { load } = stubAxe({
      violations: [violation("label", "critical", [{ target: ["#one"] }])],
    });
    const runtime = createA11yRuntime({ load });
    const fake = fakeExtensionApi();
    const stop = runtime.start(fake.api);
    await runtime.scan();
    runtime.select(selectionKey("label", 0));
    runtime.store.flush();
    expect(runtime.store.getSnapshot().highlight).toHaveLength(1);

    fake.setVisible(false);
    runtime.store.flush();
    expect(runtime.store.getSnapshot().highlight).toEqual([]);

    stop();
    const before = runtime.store.published;
    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    runtime.store.flush();
    expect(runtime.store.published).toBe(before);
  });
});

describe("clearing", () => {
  it("returns to pending, keeps the scan count, and forgets the highlight", async () => {
    document.body.innerHTML = `<main><button id="one">one</button></main>`;
    const { load } = stubAxe({
      violations: [violation("label", "critical", [{ target: ["#one"] }])],
    });
    const runtime = createA11yRuntime({ load });
    await runtime.scan();
    runtime.select(selectionKey("label", 0));

    const report = runtime.clear();

    expect(report.status).toBe("pending");
    expect(report.total).toBe(0);
    expect(report.groups).toEqual([]);
    expect(report.selected).toBeNull();
    expect(report.scans).toBe(1);
    runtime.store.flush();
    expect(runtime.store.getSnapshot().highlight).toEqual([]);
    // A cleared scan cannot be re-highlighted from its old keys.
    expect(runtime.select(selectionKey("label", 0)).selected).toBeNull();
  });

  it("stays unsupported after clearing, with the reason intact", async () => {
    const runtime = createA11yRuntime({ load: () => Promise.reject(new Error("nope")) });
    await runtime.scan();
    const report = runtime.clear();
    expect(report.status).toBe("unsupported");
    expect(report.unsupportedReason).toContain("axe-core is not installed");
  });
});

describe("with the real axe-core peer", () => {
  it("finds the violations the page actually has, and skips the toolbar's own DOM", async () => {
    document.body.innerHTML = `
      <main><img src="/logo.png"><input type="text"></main>
      <div data-dev-toolbar><img src="/bar.png"><input type="text"></div>
    `;

    const runtime = createA11yRuntime({
      // Two rules, so the assertion is about this page and the run stays quick.
      axeOptions: { runOnly: ["image-alt", "label"] },
    });
    const report = await runtime.scan();
    const rules = report.groups.flatMap((group) => group.violations.map((entry) => entry.rule));

    expect(report.status).toBe("ok");
    expect(report.axeVersion).toBe(realAxe.version);
    expect(rules.sort()).toEqual(["image-alt", "label"]);
    // One each: the toolbar's img and input are excluded, or these would be two.
    expect(report.nodeTotal).toBe(2);
    for (const group of report.groups) {
      for (const entry of group.violations) {
        for (const node of entry.nodes) {
          expect(node.target).not.toContain("data-dev-toolbar");
        }
      }
    }
  });

  it("highlights an element the real scan found", async () => {
    document.body.innerHTML = `<main><img id="logo" src="/logo.png"></main>`;
    const runtime = createA11yRuntime({ axeOptions: { runOnly: ["image-alt"] } });
    await runtime.scan();

    const report = runtime.select(selectionKey("image-alt", 0));
    runtime.store.flush();

    expect(report.selected).toBe(selectionKey("image-alt", 0));
    expect(runtime.store.getSnapshot().highlight[0]?.label).toBe("image-alt");
  });
});

describe("the empty report", () => {
  it("says nothing has happened yet without claiming a clean page", () => {
    const report = emptyReport("pending");
    expect(report).toMatchObject({ status: "pending", total: 0, at: null, scans: 0 });
    expect(worstImpact(report.counts)).toBeNull();
    expect(DEFAULT_NODE_LIMIT).toBe(5);
  });
});

describe("a peer object that fights back", () => {
  it("reports unsupported when reading `run` throws", async () => {
    const runtime = createA11yRuntime({
      load: () =>
        Promise.resolve({
          get run(): AxeLike["run"] {
            throw new Error("boom");
          },
        } as AxeLike),
    });
    const report = await runtime.scan();

    expect(report.status).toBe("unsupported");
    expect(report.unsupportedReason).toContain("run()");
  });

  it("scans anyway when reading `version` throws, at start and at scan", async () => {
    const runtime = createA11yRuntime({
      load: () =>
        Promise.resolve({
          get version(): string {
            throw new Error("v boom");
          },
          run: async () => ({ violations: [], testEngine: {} }),
        } as AxeLike),
    });
    const fake = fakeExtensionApi();
    const stop = runtime.start(fake.api);
    const report = await runtime.scan();
    stop();

    expect(report.status).toBe("ok");
    expect(report.axeVersion).toBeNull();
  });

  it("describes a rejection whose own `name` throws", async () => {
    const nasty = Object.create(Error.prototype, {
      name: {
        get() {
          throw new Error("name boom");
        },
      },
      message: { value: "x" },
    }) as Error;
    const report = await createA11yRuntime({
      load: () => Promise.resolve({ run: () => Promise.reject(nasty) } as AxeLike),
    }).scan();

    expect(report.status).toBe("failed");
    expect(report.error).toContain("[unreadable]");
  });
});

describe("two runtimes over one engine", () => {
  it("serialises their passes instead of tripping axe's own guard", async () => {
    document.body.innerHTML = `<main><img src="/a.png"></main>`;
    const load = () => Promise.resolve(realAxe);
    const first = createA11yRuntime({ load, axeOptions: { runOnly: ["image-alt"] } });
    const second = createA11yRuntime({ load, axeOptions: { runOnly: ["image-alt"] } });

    const [a, b] = await Promise.all([first.scan(), second.scan()]);

    expect([a.status, b.status]).toEqual(["ok", "ok"]);
    // Serialised, not shared: each runtime keeps its own report.
    expect(a).not.toBe(b);
    expect(a.total).toBe(1);
    expect(b.total).toBe(1);
  });
});

describe("the scan's lifecycle", () => {
  it("hands a waiting caller the finalised report, not the one it had captured", async () => {
    let release: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const runtime = createA11yRuntime({ load: () => Promise.resolve({ run: () => pending }) });
    const fake = fakeExtensionApi();
    const stop = runtime.start(fake.api);
    const first = runtime.scan();
    const second = runtime.scan();
    await vi.waitFor(() => expect(runtime.report().running).toBe(true));

    stop();
    release({ violations: [] });
    const [a, b] = await Promise.all([first, second]);
    runtime.store.flush();

    expect(a.running).toBe(false);
    expect(b.running).toBe(false);
    expect(a).toBe(runtime.store.getSnapshot().report);
  });

  it("does not let a torn-down mount's result land on the next one", async () => {
    let release: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const run = vi
      .fn()
      .mockImplementationOnce(() => pending)
      .mockImplementation(async () => ({ violations: [] }));
    const runtime = createA11yRuntime({ load: () => Promise.resolve({ run } as AxeLike) });
    const stop = runtime.start(fakeExtensionApi().api);
    const abandoned = runtime.scan();
    await vi.waitFor(() => expect(runtime.report().running).toBe(true));

    stop();
    const restop = runtime.start(fakeExtensionApi().api);
    const fresh = runtime.scan();
    release({ violations: [violation("stale", "critical", [{}])] });
    await abandoned;
    const report = await fresh;
    restop();

    // A fresh scan, not the previous mount's promise, and not its result.
    expect(run).toHaveBeenCalledTimes(2);
    expect(report.total).toBe(0);
    expect(runtime.report().total).toBe(0);
  });

  it("clear() disowns the scan in flight instead of letting it repopulate", async () => {
    let release: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const runtime = createA11yRuntime({ load: () => Promise.resolve({ run: () => pending }) });
    const scan = runtime.scan();
    await vi.waitFor(() => expect(runtime.report().running).toBe(true));

    runtime.clear();
    release({ violations: [violation("late", "critical", [{}])] });
    await scan;

    expect(runtime.report().status).toBe("pending");
    expect(runtime.report().total).toBe(0);
  });

  it("lets the next caller start its own scan rather than join the disowned one", async () => {
    let release: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const run = vi
      .fn()
      .mockImplementationOnce(() => pending)
      .mockImplementation(async () => ({ violations: [] }));
    const runtime = createA11yRuntime({ load: () => Promise.resolve({ run } as AxeLike) });
    const disowned = runtime.scan();
    await vi.waitFor(() => expect(runtime.report().running).toBe(true));

    runtime.clear();
    const next = runtime.scan();
    expect(next).not.toBe(disowned);
    release({ violations: [violation("late", "critical", [{}])] });
    await disowned;

    expect((await next).status).toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(runtime.report().total).toBe(0);
  });
});

describe("an element in a shadow root", () => {
  it("keeps axe's target path and highlights through the open root", async () => {
    document.body.innerHTML = `<main><div id="host"></div></main>`;
    const host = document.getElementById("host") as HTMLElement;
    host.attachShadow({ mode: "open" }).innerHTML = `<img id="bad" src="/x.png">`;

    const runtime = createA11yRuntime({
      load: () => Promise.resolve(realAxe),
      axeOptions: { runOnly: ["image-alt"] },
    });
    const report = await runtime.scan();
    const selected = runtime.select(selectionKey("image-alt", 0));
    runtime.store.flush();

    expect(report.groups[0]?.violations[0]?.nodes[0]?.target).toBe("#host >> #bad");
    expect(selected.selected).toBe(selectionKey("image-alt", 0));
    expect(runtime.store.getSnapshot().highlight[0]?.label).toBe("image-alt");
  });
});
