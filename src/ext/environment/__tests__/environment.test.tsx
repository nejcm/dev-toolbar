/**
 * `/ext/environment` against the real shell, through the same `/testing`
 * surface a stranger writing an extension would use.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { renderWithToolbar } from "@nejcm/dev-toolbar/testing";
import { collectCommands } from "../../../core/commands";
import { environment } from "../index";
import type { EnvironmentOptions } from "../index";

let unmountAll: (() => void)[] = [];
let written: string[] = [];

const mount = (options: EnvironmentOptions = {}) => {
  const extension = environment(options);
  const result = renderWithToolbar(null, {
    extensions: [extension],
    layout: { barWidth: 900, itemWidth: 200 },
  });
  unmountAll.push(result.unmount);
  return { extension, ...result };
};

const text = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, " ").trim() ?? "";

const row = (panel: HTMLElement | null, field: string) =>
  panel?.querySelector<HTMLElement>(`[data-dtb-field="${field}"]`) ?? null;

beforeEach(() => {
  written = [];
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (value: string) => {
        written.push(value);
        return Promise.resolve();
      },
    },
  });
});

afterEach(() => {
  for (const unmount of unmountAll.splice(0)) unmount();
  document.head
    .querySelectorAll('style[data-dev-toolbar-styles="ext-environment"]')
    .forEach((node) => node.remove());
});

describe("the compact chip", () => {
  it("says unknown, not local, when the consumer supplied nothing", () => {
    const { toolbar } = mount();
    const item = toolbar.item("environment");
    expect(text(item?.querySelector('[data-dtb-part="env-value"]'))).toBe("unknown");
    expect(
      item?.querySelector('[data-dtb-part="env-chip"]')?.getAttribute("data-dtb-severity"),
    ).toBe("unknown");
  });

  it("shows the supplied environment and marks production conspicuously", () => {
    const { toolbar } = mount({ context: { environment: "production" } });
    const chip = toolbar.item("environment")?.querySelector('[data-dtb-part="env-chip"]');
    expect(text(chip?.querySelector('[data-dtb-part="env-value"]'))).toBe("production");
    expect(chip?.getAttribute("data-dtb-severity")).toBe("bad");
  });

  it("grades staging as warn and local as ok", () => {
    const staging = mount({ context: { environment: "staging" } });
    expect(
      staging.toolbar
        .item("environment")
        ?.querySelector('[data-dtb-part="env-chip"]')
        ?.getAttribute("data-dtb-severity"),
    ).toBe("warn");

    const local = mount({
      id: "environment-2",
      context: { environment: "local" },
    });
    expect(
      local.toolbar
        .item("environment-2")
        ?.querySelector('[data-dtb-part="env-chip"]')
        ?.getAttribute("data-dtb-severity"),
    ).toBe("ok");
  });

  it("makes impersonation unmistakable in the bar", () => {
    const { toolbar } = mount({
      context: { environment: "local", impersonating: true },
    });
    const chip = toolbar.item("environment")?.querySelector('[data-dtb-part="env-chip"]');
    expect(text(chip?.querySelector('[data-dtb-part="env-alert"]'))).toBe("impersonating");
    // Impersonation outranks the environment: local stops being calm.
    expect(chip?.getAttribute("data-dtb-severity")).toBe("bad");
  });

  it("still reads as an environment when it collapses into the ··· menu", () => {
    const { toolbar } = mount({ context: { environment: "production" } });
    act(() => toolbar.resize(40));
    expect(toolbar.overflowedIds()).toContain("environment");
    toolbar.openOverflow();
    const item = toolbar.item("environment");
    expect(item?.querySelector('[data-dtb-part="env-overflow"]')).not.toBeNull();
    expect(text(item?.querySelector('[data-dtb-part="env-value"]'))).toBe("production");
  });

  it("toggles its own panel through CompactSlotProps.togglePanel", () => {
    const { toolbar } = mount({ context: { environment: "staging" } });
    const trigger = toolbar
      .item("environment")
      ?.querySelector<HTMLButtonElement>('[data-dtb-part="trigger"]');
    act(() => trigger?.click());
    expect(toolbar.panel("environment")).not.toBeNull();
    act(() => trigger?.click());
    expect(toolbar.panel("environment")).toBeNull();
  });
});

describe("the panel", () => {
  const full: EnvironmentOptions = {
    context: {
      environment: "production",
      release: "web-2026.08.28.4",
      commit: "a84c7e1",
      branch: "main",
      deployment: "dpl_9f2",
      region: "ap-southeast-1",
      apiEndpoint: "https://api.example.com/v2",
      builtAt: "2026-08-28T10:04:00.000Z",
      userId: "usr_123",
      workspaceId: "ws_456",
      internal: true,
      roles: ["admin", "support"],
      syncStatus: "connected",
    },
  };

  it("renders §3B's fields with their supplied values", () => {
    const { toolbar } = mount(full);
    toolbar.openPanel("environment");
    const panel = toolbar.panel("environment");
    expect(text(row(panel, "environment"))).toBe("production");
    expect(text(row(panel, "release"))).toBe("web-2026.08.28.4");
    expect(text(row(panel, "commit"))).toBe("a84c7e1");
    expect(text(row(panel, "region"))).toBe("ap-southeast-1");
    expect(text(row(panel, "userId"))).toBe("usr_123");
    expect(text(row(panel, "workspaceId"))).toBe("ws_456");
    expect(text(row(panel, "roles"))).toBe("admin, support");
    expect(text(row(panel, "sync"))).toBe("connected");
    expect(text(row(panel, "internal"))).toBe("yes");
  });

  it("labels what the browser worked out, so it is not read as a deploy fact", () => {
    const { toolbar } = mount(full);
    toolbar.openPanel("environment");
    const panel = toolbar.panel("environment");
    const route = row(panel, "route");
    expect(route?.getAttribute("data-dtb-source")).toBe("detected");
    expect(text(route)).toContain("/");
    expect(text(route)).toContain("detected");
    expect(row(panel, "environment")?.getAttribute("data-dtb-source")).toBe("supplied");
  });

  it("says a missing field is missing rather than inventing one", () => {
    const { toolbar } = mount({ context: { environment: "staging" } });
    toolbar.openPanel("environment");
    const panel = toolbar.panel("environment");
    const release = row(panel, "release");
    expect(release?.getAttribute("data-dtb-source")).toBe("missing");
    expect(text(release)).toBe("not supplied");
  });

  it("explains itself when nothing at all was supplied", () => {
    const { toolbar } = mount({ detect: false });
    toolbar.openPanel("environment");
    const panel = toolbar.panel("environment");
    expect(text(panel?.querySelector('[data-dtb-part="env-empty"]'))).toContain(
      "No environment context was supplied",
    );
  });

  it("banners an active impersonation", () => {
    const { toolbar } = mount({
      context: {
        environment: "production",
        impersonating: { actor: "staff_1", subject: "usr_9" },
      },
    });
    toolbar.openPanel("environment");
    const panel = toolbar.panel("environment");
    expect(
      panel?.querySelector('[data-dtb-part="env-panel"]')?.getAttribute("data-dtb-impersonating"),
    ).toBe("true");
    expect(text(panel?.querySelector('[data-dtb-part="env-banner"]'))).toContain(
      "Impersonation is active",
    );
    expect(text(row(panel, "impersonation"))).toContain("staff_1 → usr_9");
    expect(row(panel, "impersonation")?.getAttribute("data-dtb-alarming")).toBe("true");
  });

  it("drops everything outside a `fields` allowlist", () => {
    const { toolbar } = mount({
      ...full,
      fields: ["environment", "release"],
    });
    toolbar.openPanel("environment");
    const panel = toolbar.panel("environment");
    expect(row(panel, "environment")).not.toBeNull();
    expect(row(panel, "release")).not.toBeNull();
    // Not merely unpainted — the value never reaches the DOM.
    expect(row(panel, "userId")).toBeNull();
    expect(panel?.innerHTML).not.toContain("usr_123");
  });

  it("applies the allowlist to `extra:*` rows as well", () => {
    const { toolbar } = mount({
      detect: false,
      fields: ["environment"],
      context: {
        environment: "production",
        extra: { tenantTier: "enterprise" },
      },
    });
    toolbar.openPanel("environment");
    const panel = toolbar.panel("environment");
    expect(row(panel, "extra:tenantTier")).toBeNull();
    expect(panel?.innerHTML).not.toContain("enterprise");
  });

  it("injects its stylesheet once, keyed on the DOM, and honours injectStyles: false", () => {
    mount();
    mount({ id: "environment-2" });
    expect(
      document.head.querySelectorAll('style[data-dev-toolbar-styles="ext-environment"]').length,
    ).toBe(1);

    document.head
      .querySelectorAll('style[data-dev-toolbar-styles="ext-environment"]')
      .forEach((node) => node.remove());
    mount({ id: "environment-3", injectStyles: false });
    expect(
      document.head.querySelector('style[data-dev-toolbar-styles="ext-environment"]'),
    ).toBeNull();
  });
});

describe("redaction of consumer-supplied data", () => {
  const leaky: EnvironmentOptions = {
    context: {
      environment: "production",
      userId: "nejc.mursic@example.com",
      apiEndpoint: "https://api.example.com/v2?access_token=super-secret",
      extra: {
        authToken: "abcdef123456",
        sessionCookie: "sid=deadbeef",
        buildTool: "vite",
      },
    },
  };

  it("masks credential-shaped values before they reach the DOM", () => {
    const { toolbar } = mount(leaky);
    toolbar.openPanel("environment");
    const panel = toolbar.panel("environment");
    const html = panel?.innerHTML ?? "";
    expect(html).not.toContain("super-secret");
    expect(html).not.toContain("abcdef123456");
    expect(html).not.toContain("deadbeef");
    // The mask lands inside a query string, so it arrives percent-encoded —
    // ugly, and much better than the token.
    expect(text(row(panel, "apiEndpoint"))).toContain("access_token=%5Bredacted%5D");
    expect(text(row(panel, "extra:authToken"))).toContain("[redacted]");
  });

  it("masks email-shaped values", () => {
    const { toolbar } = mount(leaky);
    toolbar.openPanel("environment");
    const panel = toolbar.panel("environment");
    expect(text(row(panel, "userId"))).toContain("n***@example.com");
    expect(panel?.innerHTML).not.toContain("nejc.mursic@");
  });

  it("shows the masking rather than doing it silently", () => {
    const { toolbar } = mount(leaky);
    toolbar.openPanel("environment");
    const panel = toolbar.panel("environment");
    expect(row(panel, "userId")?.getAttribute("data-dtb-masked")).toBe("true");
    expect(text(row(panel, "userId"))).toContain("masked");
    // A value that had nothing to mask is not tagged, or the tag means nothing.
    expect(row(panel, "extra:buildTool")?.getAttribute("data-dtb-masked")).toBe("false");
    expect(text(panel?.querySelector('[data-dtb-part="env-actions"] [role="status"]'))).toContain(
      "masked",
    );
  });

  it("masks a credential nested inside an `extra` object", () => {
    // The row is what a reader trusts, so this is asserted against the DOM and
    // not only against the snapshot: stringifying before redacting used to put
    // the token on screen under a "masked" tag.
    const { toolbar } = mount({
      detect: false,
      context: {
        extra: {
          user: { email: "nejc.mursic@example.com", authToken: "supersecret123" },
        },
      },
    });
    toolbar.openPanel("environment");
    const panel = toolbar.panel("environment");
    expect(panel?.innerHTML).not.toContain("supersecret123");
    expect(text(row(panel, "extra:user"))).toContain("[redacted]");
    expect(text(row(panel, "extra:user"))).toContain("n***@example.com");
  });

  it("does not drop a masked field — the row still says it exists", () => {
    const { toolbar } = mount(leaky);
    toolbar.openPanel("environment");
    const panel = toolbar.panel("environment");
    expect(row(panel, "extra:sessionCookie")?.getAttribute("data-dtb-source")).toBe("supplied");
  });
});

describe("the clipboard path", () => {
  const leaky: EnvironmentOptions = {
    detect: false,
    context: {
      environment: "production",
      release: "web-2026.08.28.4",
      userId: "nejc.mursic@example.com",
      apiEndpoint: "https://api.example.com/v2?access_token=super-secret",
      extra: { authToken: "abcdef123456" },
    },
  };

  it("copies the redacted summary, never the raw context", async () => {
    const { toolbar } = mount(leaky);
    toolbar.openPanel("environment");
    const button = toolbar
      .panel("environment")
      ?.querySelector<HTMLButtonElement>('[data-dtb-action="copy"]');
    await act(async () => {
      button?.click();
    });
    expect(written).toHaveLength(1);
    const copied = written[0] as string;
    expect(copied).toContain("Environment: production");
    expect(copied).toContain("Release: web-2026.08.28.4");
    expect(copied).toContain("n***@example.com");
    expect(copied).toContain("[redacted]");
    expect(copied).not.toContain("super-secret");
    expect(copied).not.toContain("abcdef123456");
    expect(copied).not.toContain("nejc.mursic@");
    expect(copied).toContain("masked before copying");
  });

  it("keeps a nested credential out of the clipboard", async () => {
    const { toolbar } = mount({
      detect: false,
      context: { extra: { user: { authToken: "supersecret123" } } },
    });
    toolbar.openPanel("environment");
    await act(async () => {
      toolbar
        .panel("environment")
        ?.querySelector<HTMLButtonElement>('[data-dtb-action="copy"]')
        ?.click();
    });
    expect(written[0]).not.toContain("supersecret123");
    expect(written[0]).toContain("[redacted]");
  });

  it("copies redacted JSON too", async () => {
    const { toolbar } = mount(leaky);
    toolbar.openPanel("environment");
    const button = toolbar
      .panel("environment")
      ?.querySelector<HTMLButtonElement>('[data-dtb-action="copy-json"]');
    await act(async () => {
      button?.click();
    });
    const parsed = JSON.parse(written[0] as string) as {
      fields: { id: string; value: string }[];
    };
    expect(JSON.stringify(parsed)).not.toContain("super-secret");
    expect(parsed.fields.find((f) => f.id === "userId")?.value).toBe("n***@example.com");
  });

  it("closes the front door: the aggregated command redacts as well", async () => {
    const { extension } = mount(leaky);
    const copy = collectCommands([extension]).find((c) => c.id === "environment.copy");
    await act(async () => {
      await copy?.run();
    });
    expect(written[0]).not.toContain("super-secret");
    expect(written[0]).toContain("[redacted]");
  });

  it("reports a clipboard it cannot reach instead of pretending", async () => {
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    const { toolbar } = mount({ context: { environment: "local" } });
    toolbar.openPanel("environment");
    const panel = toolbar.panel("environment");
    await act(async () => {
      panel?.querySelector<HTMLButtonElement>('[data-dtb-action="copy"]')?.click();
    });
    expect(text(panel?.querySelector('[data-dtb-part="env-actions"] [role="status"]'))).toBe(
      "Clipboard unavailable.",
    );
  });
});

describe("live context", () => {
  it("re-reads a function context and repaints", () => {
    vi.useFakeTimers();
    try {
      let status = "connecting";
      const { toolbar } = mount({
        pollMs: 250,
        context: () => ({ environment: "staging", syncStatus: status }),
      });
      toolbar.openPanel("environment");
      expect(text(row(toolbar.panel("environment"), "sync"))).toBe("connecting");
      status = "connected";
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(text(row(toolbar.panel("environment"), "sync"))).toBe("connected");
    } finally {
      vi.useRealTimers();
    }
  });

  it("survives a throwing getter inside the context without taking the app down", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { toolbar } = mount({
        detect: false,
        context: {
          extra: {
            bad: {
              get boom(): string {
                throw new Error("getter blew up");
              },
            },
          },
        },
      });
      // Not an error chip: the bar rendered normally, because the throw was
      // contained where it happened rather than escaping the factory.
      expect(toolbar.item("environment")).not.toBeNull();
      toolbar.openPanel("environment");
      expect(text(row(toolbar.panel("environment"), "contextError"))).toContain(
        "could not be read",
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("survives a context getter that throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { toolbar } = mount({
        context: () => {
          throw new Error("consumer blew up");
        },
      });
      expect(toolbar.item("environment")).not.toBeNull();
      expect(text(toolbar.item("environment")?.querySelector('[data-dtb-part="env-value"]'))).toBe(
        "unknown",
      );
    } finally {
      spy.mockRestore();
    }
  });
});
