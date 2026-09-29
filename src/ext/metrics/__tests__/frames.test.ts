import { afterEach, describe, expect, it, vi } from "vitest";
import { installAnimationFrames } from "../../../test-utils/animation-frames";
import type { FakeFrames } from "../../../test-utils/animation-frames";
import { createFpsReader } from "../collectors/fps";
import { createFrameSource } from "../collectors/frames";
import { createJankCollector, createJankReader } from "../collectors/jank";
import { metrics } from "../index";
import type { Collector } from "../types";

let frames: FakeFrames | null = null;

afterEach(() => {
  frames?.restore();
  frames = null;
  vi.restoreAllMocks();
});

const now = () => performance.now();

function started(collector: Collector) {
  const controller = new AbortController();
  collector.start({ signal: controller.signal, now, invalidate: vi.fn() });
  return controller;
}

describe("frame source", () => {
  it("runs one loop for two readers, and stops only once both abort", () => {
    frames = installAnimationFrames();
    const source = createFrameSource({ frameMs: 16 });
    const fps = createFpsReader(source);
    const jank = createJankReader(source);
    const first = started(fps);
    const second = started(jank);
    expect(frames.requested).toBe(1);

    frames.tick(16);
    for (let index = 0; index < 10; index += 1) frames.tick(16);
    expect(frames.requested).toBe(12);
    expect(fps.diagnostics(now())).toMatchObject({ count: 10 });
    expect(jank.diagnostics(now())).toMatchObject({ count: 10 });

    first.abort();
    expect(frames.cancelled).toEqual([]);
    expect(frames.pending).toBe(true);
    frames.tick(16);
    expect(jank.diagnostics(now())).toMatchObject({ count: 11 });

    second.abort();
    expect(frames.cancelled).toHaveLength(1);
    expect(frames.pending).toBe(false);

    started(fps);
    expect(frames.pending).toBe(true);
  });

  it("sizes the shared ring for its widest reader", () => {
    const source = createFrameSource({ frameMs: 10 });
    createJankReader(source, { windowMs: 1000 });
    createFpsReader(source, { windowMs: 10_000 });
    expect(source.frames.capacity).toBe(1250);
  });

  // Same ticks, fresh fake clock each run: a shared reader must read what a standalone one would.
  const drive = (build: () => Collector[], deltas: readonly number[]) => {
    frames?.restore();
    frames = installAnimationFrames();
    const collectors = build();
    const controllers = collectors.map(started);
    for (const delta of deltas) frames.tick(delta);
    const out = collectors.map((collector) =>
      JSON.stringify([collector.read(now()), collector.diagnostics(now())]),
    );
    for (const controller of controllers) controller.abort();
    return out;
  };

  it.each([
    ["fps first", true],
    ["jank first", false],
  ])("keeps each reader to its own explicit historySize (%s)", (_, fpsFirst) => {
    const deltas = Array.from({ length: 12 }, () => 16);
    const shared = () => {
      const source = createFrameSource({ frameMs: 16 });
      const build = [
        () => createFpsReader(source, { historySize: 100 }),
        () => createJankReader(source, { historySize: 2 }),
      ];
      const [fps, jank] = fpsFirst
        ? build.map((make) => make())
        : build
            .reverse()
            .map((make) => make())
            .reverse();
      return [fps!, jank!];
    };
    const [fps, jank] = drive(shared, deltas);
    const [alone] = drive(() => [createJankCollector({ frameMs: 16, historySize: 2 })], deltas);
    expect(jank).toBe(alone);
    expect(JSON.parse(jank!)[1]).toMatchObject({ count: 2, historySize: 2 });
    expect(JSON.parse(fps!)[1]).toMatchObject({ count: 11, historySize: 100 });

    const [small] = drive(() => {
      const source = createFrameSource({ frameMs: 16 });
      createJankReader(source, { historySize: 100 });
      return [createFpsReader(source, { historySize: 2 })];
    }, deltas);
    expect(JSON.parse(small!)[1]).toMatchObject({ count: 2, historySize: 2 });
  });

  it("leaves default-capacity jank byte-identical beside a wider fps window", () => {
    const deltas = [
      ...Array.from({ length: 200 }, (_, index) => (index % 7 === 0 ? 40 : 16.67)),
      1500,
      ...Array.from({ length: 400 }, (_, index) => (index % 5 === 0 ? 33.4 : 16.67)),
    ];
    const [, shared] = drive(() => {
      const source = createFrameSource();
      return [
        createFpsReader(source, { windowMs: 20_000 }),
        createJankReader(source, { windowMs: 1000 }),
      ];
    }, deltas);
    const [alone] = drive(() => [createJankCollector({ windowMs: 1000 })], deltas);
    expect(shared).toBe(alone);
  });

  it("resolves the deprecated jank.* aliases over frames", () => {
    const frameMs = (options: Parameters<typeof metrics>[0]) => {
      const data = metrics({ only: ["fps", "jank"], ...options }).diagnostics!() as {
        fps: { frameMs: number | null };
        jank?: { frameMs: number | null };
      };
      return [data.fps.frameMs, data.jank?.frameMs];
    };
    expect(frameMs({})).toEqual([null, null]);
    expect(frameMs({ frames: { frameMs: 20 } })).toEqual([20, 20]);
    expect(frameMs({ frames: { frameMs: 20 }, jank: { frameMs: 10 } })).toEqual([10, 10]);
    expect(frameMs({ frames: { frameMs: 20 }, jank: { windowMs: 1000 } })).toEqual([20, 20]);
    expect(frameMs({ frames: { frameMs: 20 }, jank: false })).toEqual([20, undefined]);
  });
});
