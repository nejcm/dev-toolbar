// One test on purpose: the mock factory runs once per file and vitest caches
// its module, so a second test could not observe another initialisation.
import { describe, expect, it, vi } from "vitest";
import { fakeExtensionApi } from "@nejcm/dev-toolbar/testing";
import { createA11yRuntime } from "../runtime";

const peer = vi.hoisted(() => ({ imports: 0 }));

// Both shapes, as the real CJS interop exposes them: vitest throws on a read of
// an export the factory did not define, and `unwrap()` probes `run` first.
vi.mock("axe-core", () => {
  peer.imports += 1;
  const stub = {
    version: "0.0.0-mocked",
    run: () => Promise.resolve({ violations: [], passes: [], incomplete: [] }),
  };
  return { ...stub, default: stub };
});

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("the peer import, counted", () => {
  it('is not evaluated at start under loadOn: "scan", and is on the first scan', async () => {
    const deferred = createA11yRuntime({ loadOn: "scan" });
    const stopDeferred = deferred.start(fakeExtensionApi().api);
    await settle();
    expect(peer.imports).toBe(0);
    expect(deferred.store.getSnapshot().axeLoaded).toBe(false);
    expect(deferred.report().status).toBe("pending");

    const report = await deferred.scan();
    expect(peer.imports).toBe(1);
    expect(report.status).toBe("ok");
    expect(report.axeVersion).toBe("0.0.0-mocked");
    expect(deferred.store.getSnapshot().axeLoaded).toBe(true);
    stopDeferred();

    // Non-vacuity: the default path reaches the same module through the same
    // expression, so what the count above measured is the import this option defers.
    const eager = createA11yRuntime();
    const stopEager = eager.start(fakeExtensionApi().api);
    await vi.waitFor(() => expect(eager.store.getSnapshot().axeLoaded).toBe(true));
    expect(eager.report().axeVersion).toBe("0.0.0-mocked");
    expect(eager.report().scans).toBe(0);
    stopEager();
  });
});
