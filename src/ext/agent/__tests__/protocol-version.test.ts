/**
 * The playground's dev-server middleware restates `AGENT_PROTOCOL_VERSION` as a
 * local constant, because that file is loaded by `vite.config.ts` and may only
 * depend on Vite's own types — it cannot import from this package. That makes it
 * the same species of hand-copied constant as an extension's `contractVersion`,
 * and `docs/adr/ADR-003-contract-version-policy.md` asks for the equality
 * assertion to be copied alongside the constant rather than left implied.
 *
 * Without this, a bump to 3 here leaves both sides' tests green — they each pin
 * the literal `2` — and the drift surfaces only as a `400 protocol-mismatch` on
 * the first check-in in a browser.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_PROTOCOL_VERSION } from "../types";

// Resolved from the repo root, the way `src/core/__tests__/boundary.test.ts`
// reaches files outside its own directory.
const PLUGIN = resolve(process.cwd(), "examples/playground/plugins/devToolbarAgent.ts");

describe("the playground middleware's copy of the agent protocol version", () => {
  it("equals the one the bridge reports", () => {
    const source = readFileSync(PLUGIN, "utf8");
    const match = /^const PROTOCOL_VERSION = (\d+);$/m.exec(source);

    // A rename is as much a drift as a stale number: if the constant moves, this
    // must fail loudly rather than quietly stop checking anything.
    expect(match, `no \`const PROTOCOL_VERSION = <n>;\` found in ${PLUGIN}`).not.toBeNull();
    expect(Number(match?.[1])).toBe(AGENT_PROTOCOL_VERSION);
  });
});
