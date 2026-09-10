/**
 * `vitest.setup.ts`'s `afterEach`, tested directly. Vitest stops the remaining
 * hooks once one throws, and files without a local `afterEach` have only this
 * one — so the property is "a throwing step cannot skip a later one", and the
 * error still surfaces.
 */
import { describe, expect, it } from "vitest";
import { resetToolbarTestEnvironment } from "../teardown";

/** Everything the hook is responsible for undoing, other than the injected callables. */
function dirty(): void {
  document.documentElement.style.setProperty("--probe", "1");
  const style = document.createElement("style");
  style.setAttribute("data-dev-toolbar-styles", "");
  document.head.append(style);
  window.localStorage.setItem("probe", "dirty");
}

const world = () => ({
  htmlStyle: document.documentElement.getAttribute("style"),
  styleTags: document.head.querySelectorAll("style[data-dev-toolbar-styles]").length,
  probe: window.localStorage.getItem("probe"),
});

const clean = { htmlStyle: null, styleTags: 0, probe: null };

describe("resetToolbarTestEnvironment", () => {
  it("runs every step and throws nothing when both callables succeed", () => {
    dirty();
    const ran: string[] = [];

    resetToolbarTestEnvironment({
      cleanupToolbar: () => ran.push("cleanupToolbar"),
      cleanup: () => ran.push("cleanup"),
      resetMountedInstances: () => ran.push("resetMountedInstances"),
    });

    // Toolbar mounts go first: RTL's `cleanup()` unmounts the trees the tracked
    // list would otherwise still be holding `unmount` functions for. The
    // registry reset follows the unmounts so it forgets only what they leaked.
    expect(ran).toEqual(["cleanupToolbar", "cleanup", "resetMountedInstances"]);
    expect(world()).toEqual(clean);
  });

  it("still runs cleanup() and the DOM resets when cleanupToolbar() throws", () => {
    dirty();
    const ran: string[] = [];

    expect(() =>
      resetToolbarTestEnvironment({
        cleanupToolbar: () => {
          throw new Error("unmount blew up");
        },
        cleanup: () => ran.push("cleanup"),
        resetMountedInstances: () => ran.push("resetMountedInstances"),
      }),
    ).toThrow("unmount blew up");

    expect(ran).toEqual(["cleanup", "resetMountedInstances"]);
    expect(world()).toEqual(clean);
  });

  it("still runs the DOM resets when Testing Library's cleanup() throws", () => {
    dirty();

    expect(() =>
      resetToolbarTestEnvironment({
        cleanupToolbar: () => {},
        cleanup: () => {
          throw new Error("cleanup blew up");
        },
        resetMountedInstances: () => {},
      }),
    ).toThrow("cleanup blew up");

    expect(world()).toEqual(clean);
  });

  it("reports every failure as an AggregateError when both callables throw", () => {
    dirty();
    let caught: unknown;

    try {
      resetToolbarTestEnvironment({
        cleanupToolbar: () => {
          throw new Error("unmount blew up");
        },
        cleanup: () => {
          throw new Error("cleanup blew up");
        },
        resetMountedInstances: () => {},
      });
    } catch (error) {
      caught = error;
    }

    // In step order, so the earliest failure — the interesting one, since
    // `cleanup()` unmounting a tree `cleanupToolbar()` left half torn down is a
    // consequence rather than a cause — reads first.
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors.map((error: Error) => error.message)).toEqual([
      "unmount blew up",
      "cleanup blew up",
    ]);
    expect(world()).toEqual(clean);
  });
});
