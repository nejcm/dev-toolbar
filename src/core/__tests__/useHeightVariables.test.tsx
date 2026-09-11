/**
 * Two independently loaded copies of core — the dual-package hazard — must
 * agree on how many toolbars a page has, or each believes itself alone and
 * both write the unsuffixed `--dev-toolbar-height`. `DevToolbar.test.tsx`'s
 * single module instance can't exercise that, so a second copy is loaded here
 * via `vi.resetModules()` plus a dynamic `import()`.
 */
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DevToolbar } from "../DevToolbar";

const read = (name: string) => document.documentElement.style.getPropertyValue(name);

const stubHeights = (heights: Record<string, number>) =>
  vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement): DOMRect {
      const instance = this.dataset["dtbInstance"];
      const height = instance === undefined ? 0 : (heights[instance] ?? 0);
      return { height, width: 0, top: 0, left: 0, right: 0, bottom: height, x: 0, y: 0 } as DOMRect;
    });

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("the mounted-instance registry across two copies of core", () => {
  it("counts a toolbar mounted through a second copy of the module", async () => {
    vi.resetModules();
    const fresh = await import("../DevToolbar");
    expect(fresh.DevToolbar).not.toBe(DevToolbar);

    stubHeights({ alpha: 24, beta: 36 });
    const alpha = render(
      <DevToolbar instanceId="alpha" extensions={[]}>
        <div />
      </DevToolbar>,
    );
    expect(read("--dev-toolbar-height")).toBe("24px");

    const beta = render(
      <fresh.DevToolbar instanceId="beta" extensions={[]}>
        <div />
      </fresh.DevToolbar>,
    );
    expect(read("--dev-toolbar-height")).toBe("");
    expect(read("--dev-toolbar-height-alpha")).toBe("24px");
    expect(read("--dev-toolbar-height-beta")).toBe("36px");

    alpha.unmount();
    expect(read("--dev-toolbar-height")).toBe("36px");
    beta.unmount();
    expect(read("--dev-toolbar-height")).toBe("");
  });

  it("hands the name to the survivor from either copy", async () => {
    vi.resetModules();
    const fresh = await import("../DevToolbar");

    stubHeights({ alpha: 24, beta: 36 });
    render(
      <DevToolbar instanceId="alpha" extensions={[]}>
        <div />
      </DevToolbar>,
    );
    const beta = render(
      <fresh.DevToolbar instanceId="beta" extensions={[]}>
        <div />
      </fresh.DevToolbar>,
    );
    expect(read("--dev-toolbar-height")).toBe("");
    beta.unmount();
    expect(read("--dev-toolbar-height")).toBe("24px");
  });
});
