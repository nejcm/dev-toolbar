import { expect, vi } from "vitest";
import type { ExtensionRuntimeApi } from "../core/contract";

/** What a test needs to drive one runtime API adapter. */
export interface RuntimeApiHarness {
  api: ExtensionRuntimeApi;
  /** Returns once delivery has happened. */
  setVisible(next: boolean): void;
  /** Runs two flips inside one commit. */
  batch?(flips: () => void): void;
  abort(): void;
  dispose(): void;
  delivery: "post-commit" | "synchronous";
}

interface RuntimeApiCase {
  name: string;
  requires?: "batch" | "post-commit";
  run(harness: RuntimeApiHarness): void | Promise<void>;
}

function meets(harness: RuntimeApiHarness, requirement: RuntimeApiCase["requires"]): boolean {
  if (requirement === "batch") return harness.batch !== undefined;
  if (requirement === "post-commit") return harness.delivery === "post-commit";
  return true;
}

/** Runs one case on a fresh harness, calling `skip` when the harness lacks what the case requires. */
export async function runRuntimeApiCase(
  testCase: RuntimeApiCase,
  make: () => RuntimeApiHarness,
  skip: () => void,
): Promise<void> {
  const harness = make();
  try {
    if (!meets(harness, testCase.requires)) return skip();
    await testCase.run(harness);
  } finally {
    harness.dispose();
  }
}

export const RUNTIME_API_CASES: ReadonlyArray<RuntimeApiCase> = [
  {
    name: "the callback never runs on subscribe",
    run: ({ api }) => {
      const seen: boolean[] = [];
      api.subscribeVisibility((visible) => seen.push(visible));
      expect(seen).toEqual([]);
    },
  },
  {
    name: "the callback runs only when effective visibility changes",
    run: ({ api, setVisible }) => {
      const initial = api.isVisible();
      const seen: boolean[] = [];
      api.subscribeVisibility((visible) => seen.push(visible));

      setVisible(initial);
      expect(seen).toEqual([]);

      setVisible(!initial);
      expect(seen).toEqual([!initial]);
    },
  },
  {
    name: "the callback runs after React has committed the change, not synchronously inside the update that caused it",
    requires: "post-commit",
    run: (harness) => {
      const next = !harness.api.isVisible();
      const seen: boolean[] = [];
      harness.api.subscribeVisibility((visible) => seen.push(visible));

      expect(harness.batch).toBeDefined();
      harness.batch?.(() => {
        harness.setVisible(next);
        expect(seen).toEqual([]);
      });

      expect(seen).toEqual([next]);
    },
  },
  {
    name: "delivery happens exactly once per change, by the time the harness's setVisible returns",
    run: ({ api, setVisible }) => {
      const initial = api.isVisible();
      const seen: boolean[] = [];
      api.subscribeVisibility((visible) => seen.push(visible));

      setVisible(!initial);
      expect(seen).toEqual([!initial]);

      setVisible(initial);
      expect(seen).toEqual([!initial, initial]);
    },
  },
  {
    name: "flips that cancel out within one batch are coalesced and deliver nothing",
    requires: "batch",
    run: (harness) => {
      const initial = harness.api.isVisible();
      const seen: boolean[] = [];
      harness.api.subscribeVisibility((visible) => seen.push(visible));
      harness.batch?.(() => {
        harness.setVisible(!initial);
        harness.setVisible(initial);
      });

      expect(seen).toEqual([]);
    },
  },
  {
    name: "a throwing callback is contained, and later ones still run",
    run: (harness) => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const next = !harness.api.isVisible();
        const seen: boolean[] = [];
        harness.api.subscribeVisibility(() => {
          throw new Error("boom");
        });
        harness.api.subscribeVisibility((visible) => seen.push(visible));

        expect(() => harness.setVisible(next)).not.toThrow();
        expect(seen).toEqual([next]);
      } finally {
        spy.mockRestore();
      }
    },
  },
  {
    name: "the subscription is released automatically when signal aborts",
    run: (harness) => {
      const initial = harness.api.isVisible();
      const seen: boolean[] = [];
      harness.api.subscribeVisibility((visible) => seen.push(visible));

      harness.abort();
      harness.setVisible(!initial);

      expect(seen).toEqual([]);
    },
  },
  {
    name: "calling unsubscribe more than once, or after signal has aborted, is a no-op",
    run: (harness) => {
      const initial = harness.api.isVisible();
      const seen: boolean[] = [];
      const unsubscribe = harness.api.subscribeVisibility((visible) => seen.push(visible));

      expect(() => {
        unsubscribe();
        unsubscribe();
      }).not.toThrow();
      harness.setVisible(!initial);
      expect(seen).toEqual([]);

      harness.abort();
      expect(unsubscribe).not.toThrow();
    },
  },
  {
    name: "subscribing after signal has aborted is a no-op",
    run: (harness) => {
      const initial = harness.api.isVisible();
      harness.abort();
      const seen: boolean[] = [];
      const unsubscribe = harness.api.subscribeVisibility((visible) => seen.push(visible));

      harness.setVisible(!initial);
      expect(seen).toEqual([]);
      expect(() => {
        unsubscribe();
        unsubscribe();
      }).not.toThrow();
    },
  },
  {
    name: "signal is aborted when the extension is torn down",
    run: ({ api, abort }) => {
      expect(api.signal.aborted).toBe(false);
      abort();
      expect(api.signal.aborted).toBe(true);
    },
  },
  {
    name: "isVisible() reflects the last delivered value",
    run: ({ api, setVisible }) => {
      const next = !api.isVisible();
      const seen: boolean[] = [];
      api.subscribeVisibility((visible) => {
        expect(api.isVisible()).toBe(visible);
        seen.push(visible);
      });

      setVisible(next);
      expect(seen).toEqual([next]);
      expect(api.isVisible()).toBe(next);
    },
  },
  {
    name: "a subscriber added during delivery does not hear that delivery",
    run: ({ api, setVisible }) => {
      const initial = api.isVisible();
      const addedDuringDelivery: boolean[] = [];
      let subscribed = false;
      api.subscribeVisibility(() => {
        if (subscribed) return;
        subscribed = true;
        api.subscribeVisibility((visible) => addedDuringDelivery.push(visible));
      });

      setVisible(!initial);
      expect(addedDuringDelivery).toEqual([]);

      setVisible(initial);
      expect(addedDuringDelivery).toEqual([initial]);
    },
  },
  {
    name: "the defaults of every aggregation member are callable",
    run: async ({ api }) => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(() => api.getCommands()).not.toThrow();
        expect(() => api.getDiagnostics()).not.toThrow();
        await expect(api.runCommand("runtime-api-conformance.missing")).resolves.toBe(false);
        await expect(api.invokeCommand("runtime-api-conformance.missing")).resolves.toEqual({
          ok: false,
          reason: "unknown-command",
        });
      } finally {
        spy.mockRestore();
      }
    },
  },
];
