/**
 * Phase 3 (`plans/agent-readable-toolbar.md`): the snapshot leaves the page.
 *
 * The receiving half is a dev-server middleware and lives in the playground,
 * not in this package — so what is testable here is the *page* half: that the
 * check-in carries what a receiver needs, that the snapshot is coalesced
 * rather than streamed, that a queued command comes back with its token and a
 * fresh snapshot, that `allowRun: false` refuses to run one, and that nothing
 * keeps posting after the toolbar unmounts.
 *
 * The transport is driven through injected `fetch` and clocks: a test that
 * needed a real server would be testing the playground's plugin.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { renderWithToolbar } from "@nejcm/dev-toolbar/testing";
import { agentBridge } from "../index";
import { createAgentReporter, startAgentReporter } from "../report";
import { AGENT_PROTOCOL_VERSION, DEFAULT_GLOBAL_NAME } from "../types";
import type { AgentReportBody, AgentReportResponse } from "../report";
import type { AgentHandle, AgentRunResult, AgentSnapshot } from "../types";

const scope = globalThis as unknown as Record<string, unknown>;

afterEach(() => {
  cleanup();
  delete scope[DEFAULT_GLOBAL_NAME];
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* A handle under the test's control                                          */
/* -------------------------------------------------------------------------- */

const snapshotWith = (visible: boolean): AgentSnapshot => ({
  instanceId: "test",
  contractVersion: 2,
  visible,
  allowRun: true,
  commands: [{ id: "a.b", label: "A" }],
  shell: {
    mounted: true,
    position: "bottom",
    density: "compact",
    colorScheme: "system",
    heightVariable: { name: "--dev-toolbar-height-test", value: "36px" },
    bar: [],
    overflow: { present: false, open: false, items: [] },
    activePanel: null,
  },
  diagnostics: [],
});

interface FakeHandle {
  handle: AgentHandle;
  /** Flip to change what the next `read()` returns. */
  setVisible(next: boolean): void;
  /** Make `read()` throw, the way a torn-down handle does. */
  tearDown(): void;
  ran: { id: string; input?: unknown }[];
}

function fakeHandle(options: { allowRun?: boolean; outcome?: AgentRunResult } = {}): FakeHandle {
  const { allowRun = true, outcome = { ok: true } as AgentRunResult } = options;
  let visible = true;
  let dead = false;
  const ran: { id: string; input?: unknown }[] = [];

  const handle: AgentHandle = {
    instanceId: "test",
    contractVersion: 2,
    allowRun,
    listCommands: () => snapshotWith(visible).commands,
    read: () => {
      if (dead) throw new Error("torn down");
      return snapshotWith(visible);
    },
    ...(allowRun
      ? {
          runCommand: (id: string, input?: unknown) => {
            ran.push(input === undefined ? { id } : { id, input });
            return Promise.resolve(outcome);
          },
        }
      : {}),
  };

  return {
    handle,
    ran,
    setVisible: (next) => {
      visible = next;
    },
    tearDown: () => {
      dead = true;
    },
  };
}

/** A `fetch` that records every call and answers with whatever is queued. */
function recordingFetch(replies: AgentReportResponse[] = []) {
  const bodies: AgentReportBody[] = [];
  const queue = [...replies];
  const impl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as AgentReportBody);
    const reply = queue.shift() ?? {};
    return {
      ok: true,
      json: () => Promise.resolve(reply),
    } as unknown as Response;
  });
  return { impl: impl as unknown as typeof globalThis.fetch, bodies, calls: impl };
}

/** A clock the test moves by hand, so coalescing is decided rather than raced. */
function clock(): { now: () => number; advance(ms: number): void } {
  let value = 10_000;
  return {
    now: () => value,
    advance: (ms) => {
      value += ms;
    },
  };
}

/** Swallows the store's trailing timer: publication in these tests is leading-edge only. */
const noSchedule = () => () => {};

/** Lets an in-flight check-in finish. `startAgentReporter` drops an overlapping pump. */
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/* -------------------------------------------------------------------------- */
/* The check-in body                                                          */
/* -------------------------------------------------------------------------- */

describe("the check-in", () => {
  it("carries the snapshot, the instance and the protocol version", async () => {
    const fake = fakeHandle();
    const net = recordingFetch();
    const time = clock();
    const reporter = createAgentReporter(fake.handle, {
      url: "/__dev-toolbar/state",
      fetch: net.impl,
      now: time.now,
      schedule: noSchedule,
    });

    await reporter.tick();

    expect(net.bodies).toHaveLength(1);
    expect(net.bodies[0]).toMatchObject({
      protocolVersion: AGENT_PROTOCOL_VERSION,
      instanceId: "test",
      allowRun: true,
      results: [],
    });
    // Identifies the page, not the toolbar: a receiver holding one slot needs
    // it to say "two tabs are writing into this" instead of blending them.
    expect(typeof net.bodies[0]?.reporterId).toBe("string");
    expect(net.bodies[0]?.reporterId).not.toBe("");
    expect(net.bodies[0]?.snapshot?.shell.position).toBe("bottom");
    expect(reporter.snapshotPosts).toBe(1);
  });

  it("posts as JSON, which a cross-origin page cannot forge without a preflight", async () => {
    const net = recordingFetch();
    const reporter = createAgentReporter(fakeHandle().handle, {
      url: "/__dev-toolbar/state",
      fetch: net.impl,
      now: clock().now,
      schedule: noSchedule,
    });

    await reporter.tick();

    const init = net.calls.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(init.credentials).toBe("omit");
  });

  it("omits the snapshot when nothing changed, and carries it again when something did", async () => {
    const fake = fakeHandle();
    const net = recordingFetch();
    const time = clock();
    const reporter = createAgentReporter(fake.handle, {
      url: "/__dev-toolbar/state",
      intervalMs: 1000,
      fetch: net.impl,
      now: time.now,
      schedule: noSchedule,
    });

    await reporter.tick();
    time.advance(1000);
    await reporter.tick(); // identical state
    time.advance(1000);
    fake.setVisible(false);
    await reporter.tick(); // changed

    expect(net.bodies.map((body) => body.snapshot !== undefined)).toEqual([true, false, true]);
    expect(reporter.posts).toBe(3);
    expect(reporter.snapshotPosts).toBe(2);
  });

  it("gives two pages of one toolbar two different reporter ids", async () => {
    const net = recordingFetch();
    const options = {
      url: "/__dev-toolbar/state",
      fetch: net.impl,
      now: clock().now,
      schedule: noSchedule,
    };
    await createAgentReporter(fakeHandle().handle, options).tick();
    await createAgentReporter(fakeHandle().handle, options).tick();

    expect(net.bodies[0]?.instanceId).toBe(net.bodies[1]?.instanceId);
    expect(net.bodies[0]?.reporterId).not.toBe(net.bodies[1]?.reporterId);
  });

  it("still produces a reporter id where `crypto.randomUUID` is missing", async () => {
    vi.stubGlobal("crypto", {});
    const net = recordingFetch();
    await createAgentReporter(fakeHandle().handle, {
      url: "/__dev-toolbar/state",
      fetch: net.impl,
      now: clock().now,
      schedule: noSchedule,
    }).tick();

    expect(net.bodies[0]?.reporterId).toMatch(/^r-[a-z0-9]+-[a-z0-9]+$/);
    vi.unstubAllGlobals();
  });

  it("coalesces a burst into one snapshot post", async () => {
    const fake = fakeHandle();
    const net = recordingFetch();
    const time = clock();
    const reporter = createAgentReporter(fake.handle, {
      url: "/__dev-toolbar/state",
      intervalMs: 1000,
      fetch: net.impl,
      now: time.now,
      schedule: noSchedule,
    });

    // Four check-ins inside one interval, each seeing different state.
    for (const visible of [true, false, true, false]) {
      fake.setVisible(visible);
      await reporter.tick();
      time.advance(100);
    }

    expect(reporter.posts).toBe(4);
    expect(reporter.snapshotPosts).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Commands, both ways                                                        */
/* -------------------------------------------------------------------------- */

describe("a queued command", () => {
  it("runs, comes back with its token, and brings a fresh snapshot with it", async () => {
    const fake = fakeHandle({ outcome: { ok: true, result: { captured: 1 } } });
    const net = recordingFetch([
      { pending: [{ token: "t1", id: "flags.set", input: { key: "a" } }] },
    ]);
    const time = clock();
    const reporter = createAgentReporter(fake.handle, {
      url: "/__dev-toolbar/state",
      fetch: net.impl,
      now: time.now,
      schedule: noSchedule,
    });

    await reporter.tick();

    expect(fake.ran).toEqual([{ id: "flags.set", input: { key: "a" } }]);
    expect(net.bodies).toHaveLength(2);
    expect(net.bodies[1]?.results).toEqual([
      { token: "t1", outcome: { ok: true, result: { captured: 1 } } },
    ]);
    // The caller is about to read the state the command just changed, so the
    // result and a fresh snapshot travel together.
    expect(net.bodies[1]?.snapshot).toBeDefined();
  });

  it("is refused, not faked, when the bridge has no runCommand", async () => {
    const fake = fakeHandle({ allowRun: false });
    const net = recordingFetch([{ pending: [{ token: "t1", id: "overlays.disableAll" }] }]);
    const reporter = createAgentReporter(fake.handle, {
      url: "/__dev-toolbar/state",
      fetch: net.impl,
      now: clock().now,
      schedule: noSchedule,
    });

    await reporter.tick();

    expect(fake.handle.runCommand).toBeUndefined();
    expect(net.bodies[0]?.allowRun).toBe(false);
    expect(net.bodies[1]?.results).toEqual([
      { token: "t1", outcome: { ok: false, reason: "run-not-allowed" } },
    ]);
  });

  it("keeps an outcome that could not be delivered and sends it on the next check-in", async () => {
    const fake = fakeHandle();
    const time = clock();
    let call = 0;
    const bodies: AgentReportBody[] = [];
    const impl = (async (_url: string, init?: RequestInit) => {
      call += 1;
      bodies.push(JSON.parse(String(init?.body)) as AgentReportBody);
      // The follow-up carrying the outcome is the one that fails.
      if (call === 2) throw new Error("connection refused");
      return {
        ok: true,
        json: () => Promise.resolve(call === 1 ? { pending: [{ token: "t1", id: "a.b" }] } : {}),
      } as unknown as Response;
    }) as unknown as typeof globalThis.fetch;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const reporter = createAgentReporter(fake.handle, {
      url: "/__dev-toolbar/state",
      fetch: impl,
      now: time.now,
      schedule: noSchedule,
    });

    await reporter.tick();
    time.advance(1000);
    await reporter.tick();

    expect(bodies[1]?.results).toHaveLength(1);
    expect(bodies[2]?.results).toEqual(bodies[1]?.results);
    // One line for the first failure, then silence: a 500 ms poll would
    // otherwise fill the console with the same message.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("could not reach the reporter endpoint");
  });
});

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                  */
/* -------------------------------------------------------------------------- */

describe("the reporter's lifetime", () => {
  it("stops itself when the toolbar it reports on has unmounted", async () => {
    const fake = fakeHandle();
    const net = recordingFetch();
    const reporter = createAgentReporter(fake.handle, {
      url: "/__dev-toolbar/state",
      fetch: net.impl,
      now: clock().now,
      schedule: noSchedule,
    });

    await reporter.tick();
    fake.tearDown();
    await reporter.tick();
    await reporter.tick();

    expect(reporter.posts).toBe(1);
  });

  it("checks in immediately and then on the poll timer, and stops on teardown", async () => {
    const fake = fakeHandle();
    const net = recordingFetch();
    let pump: (() => void) | null = null;
    let cancelled = false;

    const stop = startAgentReporter(fake.handle, {
      url: "/__dev-toolbar/state",
      fetch: net.impl,
      now: clock().now,
      schedule: noSchedule,
      pollSchedule: (callback) => {
        pump = callback;
        return () => {
          cancelled = true;
        };
      },
    });

    // The first check-in is deferred by a macrotask, not by a poll interval:
    // an agent that just started the dev server still gets an answer at once,
    // and it is one taken after the toolbar finished mounting.
    await vi.waitFor(() => {
      expect(net.bodies).toHaveLength(1);
    });

    stop();
    expect(cancelled).toBe(true);
    (pump as unknown as () => void)();
    await Promise.resolve();
    expect(net.bodies).toHaveLength(1);
  });

  it("still reports the outcome when the toolbar unmounts between running and reporting", async () => {
    const fake = fakeHandle();
    const net = recordingFetch([{ pending: [{ token: "t1", id: "a.b" }] }]);
    const reporter = createAgentReporter(
      {
        ...fake.handle,
        runCommand: (id: string, input?: unknown) => {
          fake.tearDown();
          return (fake.handle.runCommand as NonNullable<AgentHandle["runCommand"]>)(id, input);
        },
      },
      { url: "/__dev-toolbar/state", fetch: net.impl, now: clock().now, schedule: noSchedule },
    );

    await reporter.tick();

    // No fresh snapshot to send — there is no toolbar left to read — but the
    // caller blocked on the HTTP request still gets an answer.
    expect(net.bodies[1]?.snapshot).toBeUndefined();
    expect(net.bodies[1]?.results).toEqual([{ token: "t1", outcome: { ok: true } }]);
  });

  it("does nothing at all where there is no `fetch`", async () => {
    vi.stubGlobal("fetch", undefined);
    const reporter = createAgentReporter(fakeHandle().handle, {
      url: "/__dev-toolbar/state",
      now: clock().now,
      schedule: noSchedule,
    });

    await reporter.tick();

    expect(reporter.posts).toBe(0);
    vi.unstubAllGlobals();
  });

  it("polls on its own timer when none is injected", async () => {
    const net = recordingFetch();
    const stop = startAgentReporter(fakeHandle().handle, {
      url: "/__dev-toolbar/state",
      pollMs: 5,
      intervalMs: 0,
      fetch: net.impl,
    });

    await vi.waitFor(() => {
      expect(net.bodies.length).toBeGreaterThanOrEqual(3);
    });
    stop();
    const settledCount = net.bodies.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(net.bodies).toHaveLength(settledCount);
  });

  it("is opt-in: a bridge with no `report` opens no connection", () => {
    const net = recordingFetch();
    vi.stubGlobal("fetch", net.impl);

    renderWithToolbar(undefined, {
      instanceId: "test",
      extensions: [agentBridge({ instanceId: "test" })],
    });

    expect(net.calls).not.toHaveBeenCalled();
  });

  it("is wired from the extension's options, and unmounting stops it", async () => {
    const net = recordingFetch();
    const time = clock();
    let pump: (() => void) | null = null;

    const { unmount } = renderWithToolbar(undefined, {
      instanceId: "test",
      extensions: [
        agentBridge({
          instanceId: "test",
          allowRun: true,
          report: {
            url: "/__dev-toolbar/state",
            fetch: net.impl,
            now: time.now,
            schedule: noSchedule,
            pollSchedule: (callback) => {
              pump = callback;
              return () => {};
            },
          },
        }),
      ],
    });

    await vi.waitFor(() => {
      expect(net.bodies).toHaveLength(1);
    });
    // The body is recorded inside `fetch`, so it is observable while the first
    // check-in is still unwinding — and an overlapping pump would be dropped.
    await settled();
    expect(net.bodies[0]?.instanceId).toBe("test");
    // The **first** check-in already sees the mounted bar. `start(api)` runs
    // while core is still committing, so an inline first tick would report
    // `shell.mounted: false` for about a second — the one field a reader uses
    // to decide the toolbar is there. Deferring that first pump by a
    // macrotask costs nothing and makes the first answer the settled one.
    expect(net.bodies[0]?.snapshot?.shell.mounted).toBe(true);
    expect(net.bodies[0]?.snapshot?.shell.bar.map((item) => item.id)).toEqual(["agent"]);

    unmount();
    time.advance(2000);
    (pump as unknown as () => void)();
    await settled();
    expect(net.bodies).toHaveLength(1);
  });
});
