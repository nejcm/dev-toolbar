import { test as base, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The shapes the agent bridge publishes. Mirrors `src/ext/agent/types.ts`;
 * typed loosely on purpose so a test asserts on the fields it is about and
 * the suite does not have to move every time an extension publishes one more.
 */
export interface BarItem {
  id: string;
  align: string | null;
  panelOpen: boolean;
}
export interface Snapshot {
  instanceId: string;
  contractVersion: number;
  visible: boolean;
  allowRun: boolean;
  commands: { id: string; label: string; group?: string; input?: unknown }[];
  shell: {
    mounted: boolean;
    position: string | null;
    density: string | null;
    heightVariable: { name: string; value: string | null };
    bar: BarItem[];
    overflow: { present: boolean; open: boolean; items: string[] };
    activePanel: string | null;
  };
  diagnostics: { id: string; label: string; status: string; data: unknown }[];
}
export type RunResult =
  | { ok: true; result?: unknown }
  | { ok: false; reason: "unknown-command" | "torn-down" }
  | { ok: false; reason: "threw"; error: string; errorName?: string };

/** The playground's `localStorage` namespace. */
export const STORE_PREFIX = "dtb:v1:playground:";

/**
 * Reads and drives the toolbar through what it publishes itself:
 * `window.__DEV_TOOLBAR__.instances.playground`. Every *state* assertion goes
 * through here; selectors are for input and for the few things that are
 * genuinely pixels (see `.claude/skills/verify-dev-toolbar/features/README.md`).
 */
export class Toolbar {
  constructor(readonly page: Page) {}

  /** Loads the playground and waits for the bridge and the shell to be up. */
  async goto(path = "/") {
    await this.page.goto(path);
    await this.ready();
  }

  async ready() {
    await this.page.waitForFunction(
      () => !!(window as any).__DEV_TOOLBAR__?.instances?.playground,
      undefined,
      { timeout: 10_000 },
    );
    await expect.poll(() => this.read().then((s) => s.shell.mounted)).toBe(true);
  }

  read(): Promise<Snapshot> {
    return this.page.evaluate(() => (window as any).__DEV_TOOLBAR__.instances.playground.read());
  }

  /** One extension's `diagnostics()` payload, or `null` when it published nothing. */
  async ext<T = any>(id: string): Promise<T | null> {
    const snapshot = await this.read();
    return (snapshot.diagnostics.find((d) => d.id === id)?.data as T | undefined) ?? null;
  }

  run(id: string, input?: unknown): Promise<RunResult> {
    return this.page.evaluate(
      ([id, input]) => (window as any).__DEV_TOOLBAR__.instances.playground.runCommand(id, input),
      [id, input] as const,
    );
  }

  /** Every `dtb:v1:playground:*` key, with the prefix stripped, raw JSON strings as values. */
  storage(): Promise<Record<string, string>> {
    return this.page.evaluate((prefix) => {
      const out: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        if (key.startsWith(prefix)) out[key.slice(prefix.length)] = localStorage.getItem(key)!;
      }
      return out;
    }, STORE_PREFIX);
  }

  /**
   * The `Mod` key as the toolbar resolves it in *this* page — `Meta` on an
   * Apple platform, `Control` elsewhere — mirroring `isApplePlatform()` in
   * `src/core/shortcut.ts`. Press `${await toolbar.mod()}+K`, never a literal.
   */
  async mod(): Promise<"Meta" | "Control"> {
    const apple = await this.page.evaluate(() => {
      const data = (navigator as any).userAgentData?.platform;
      return /mac|iphone|ipad|ipod|darwin/i.test(String(data ?? navigator.platform ?? ""));
    });
    return apple ? "Meta" : "Control";
  }

  /** The bar's `<toolbar>` region; `Developer toolbar` is its accessible name. */
  get bar() {
    return this.page.getByRole("toolbar", { name: "Developer toolbar" });
  }

  /** An extension's chip trigger, wherever it currently lives (bar or overflow menu). */
  trigger(extId: string) {
    return this.page.locator(`[data-dtb-ext-id="${extId}"] [data-dtb-part="trigger"]`);
  }

  /** The `⋮` button. Only in the document once something has collapsed. */
  get overflowButton() {
    return this.page.getByRole("button", { name: "More developer toolbar items" });
  }
}

export const test = base.extend<{ toolbar: Toolbar }>({
  toolbar: async ({ page }, use) => {
    const toolbar = new Toolbar(page);
    await toolbar.goto();
    await use(toolbar);
  },
});

export { expect };
