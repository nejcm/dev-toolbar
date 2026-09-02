/**
 * `src/testing/reactTestingLibrary.ts` resolves the optional
 * `@testing-library/react` peer through a dynamic import, started eagerly at
 * module scope and cached — see the module's own doc comment for the full
 * reasoning. That eager, module-scoped state means most of it can only be
 * exercised against a *fresh* copy of the module: `vi.resetModules()` plus a
 * dynamic `import()` gets one, since Vitest resolves that against its own,
 * now-empty module registry rather than the copy already loaded at the top of
 * this file.
 *
 * `requireFromHost()` (the Jest CommonJS fallback) is not exercised directly:
 * it reaches for `module.require`, and `module` does not exist in Vitest's ESM
 * environment, so `requireFromHost()` already returns `null` here without any
 * mocking — which is exactly what lets the "RTL absent" test below reach the
 * thrown error instead of the Jest fallback.
 */
import { act as realAct, render as realRender } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactTestingLibrary } from "../reactTestingLibrary";

/** A fresh copy of the module under test, from a reset registry. */
const freshReactTestingLibraryModule = async () => {
  vi.resetModules();
  return import("../reactTestingLibrary");
};

afterEach(() => {
  // `doUnmock`, not `unmock`: this pairs with `doMock` below, which is the
  // non-hoisted counterpart meant to be called from inside a test body.
  vi.doUnmock("@testing-library/react");
  vi.resetModules();
});

describe("testingLibraryReady", () => {
  it("resolves once the dynamic import of @testing-library/react settles", async () => {
    const mod = await freshReactTestingLibraryModule();

    await expect(mod.testingLibraryReady).resolves.toBeUndefined();

    // Resolving it is what populates the cache: requireTestingLibrary() now
    // returns the real module instead of throwing.
    const lib = mod.requireTestingLibrary();
    expect(typeof lib.render).toBe("function");
    expect(typeof lib.act).toBe("function");
  });
});

describe("setTestingLibrary", () => {
  it("makes requireTestingLibrary() return the supplied implementation immediately", async () => {
    const mod = await freshReactTestingLibraryModule();

    const act = vi.fn((callback: () => void): void => {
      callback();
    });
    const fake: ReactTestingLibrary = { act, render: vi.fn(realRender) };

    mod.setTestingLibrary(fake);

    // No need to await testingLibraryReady first: setTestingLibrary wins
    // synchronously, whether or not the eager import has settled yet.
    expect(mod.requireTestingLibrary()).toBe(fake);
  });

  it("is what subsequent renderWithToolbar() calls use", async () => {
    vi.resetModules();
    const rtlMod = await import("../reactTestingLibrary");

    const fakeRender = vi.fn(realRender);
    const fakeAct = vi.fn((callback: () => void): void => {
      realAct(callback);
    });
    rtlMod.setTestingLibrary({ act: fakeAct, render: fakeRender });

    // renderWithToolbar imports "./reactTestingLibrary" by specifier, so it
    // resolves against the same reset registry and gets this exact instance.
    // It also pulls in a second copy of core through "@nejcm/dev-toolbar" —
    // the very hazard AGENTS.md warns `src/testing/` away from with a relative
    // import — but it is contained here: the tree this second core renders is
    // unmounted before the test ends, and `vitest.setup.ts`'s `afterEach`
    // strips any styles it injected, so nothing leaks into the next test.
    const { renderWithToolbar } = await import("../renderWithToolbar");
    const { toolbar, unmount } = renderWithToolbar(null);

    expect(fakeRender).toHaveBeenCalledTimes(1);

    // Every mutator on the handle runs through act() — toggling visibility
    // is enough to prove the injected act(), not the real module's, is used.
    toolbar.toggleVisible();
    expect(fakeAct).toHaveBeenCalled();

    unmount();
  });
});

describe("requireTestingLibrary", () => {
  it("throws a message naming every remedy when RTL is absent and nothing was injected", async () => {
    vi.resetModules();
    vi.doMock("@testing-library/react", () =>
      Promise.reject(new Error("Cannot find module '@testing-library/react'")),
    );

    const mod = await import("../reactTestingLibrary");
    // The eager import's rejection is swallowed; awaiting it just confirms it
    // settled before requireTestingLibrary() is called below.
    await mod.testingLibraryReady;

    expect(() => mod.requireTestingLibrary()).toThrow(
      /needs @testing-library\/react.*npm install --save-dev @testing-library\/react.*setTestingLibrary\(require\('@testing-library\/react'\)\).*setTestingLibrary\(await import\('@testing-library\/react'\)\).*setupFilesAfterEnv.*Underlying error:/s,
    );
  });
});
