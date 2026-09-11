/**
 * The playground's dev-server middleware restates `AGENT_PROTOCOL_VERSION` as
 * a local constant, since that file is loaded by `vite.config.ts` and cannot
 * import from this package. Without this test, a bump to 3 here leaves both
 * sides' tests green — each pins its own literal `2` — and the drift would
 * surface only as a `400 protocol-mismatch` in a browser.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_PROTOCOL_VERSION } from "../types";

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
