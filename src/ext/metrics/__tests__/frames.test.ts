import { afterEach, describe, expect, it, vi } from "vitest";
import { installAnimationFrames } from "../../../test-utils/animation-frames";
import type { FakeFrames } from "../../../test-utils/animation-frames";
import { createFpsReader } from "../collectors/fps";
import { createFrameSource } from "../collectors/frames";
import { createJankReader } from "../collectors/jank";
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
