/**
 * One assertion, across every first-party extension: the `contractVersion` each
 * one declares equals the `CONTRACT_VERSION` core implements.
 *
 * It exists because §7 forbids an extension from importing a *value* from core,
 * so each of the eight hand-maintains its own copy of the number and a bump has
 * to be propagated by hand. A missed one is silent in tests and surfaces only as
 * a mount-time `console.warn` that nothing asserts the absence of — the risk
 * `docs/adr/ADR-003-contract-version-policy.md` records under "Risk accepted",
 * and the reason that record asks for the equality assertion to be copied
 * alongside the constant.
 *
 * `/ext/diagnostics` and `/ext/theme-editor` already assert this inside their
 * own suites. This file is what covers the other six.
 *
 * **The roster is derived, not restated.** A list of names checked against
 * another list of names is a tautology: a ninth `src/ext/foo/` added to neither
 * would pass it. So the expected set is read from the filesystem *and* from
 * `package.json`'s `exports`, and the two are required to agree with each other
 * and with the factories below. A new extension therefore cannot reach `main`
 * without being listed here, whichever half of the work its author forgot.
 *
 * It lives at `src/ext/__tests__/` rather than next to core's contract tests
 * because `src/core/__tests__/boundary.test.ts` forbids anything under
 * `src/core` from naming `ext/` at all, tests included.
 */
import { describe, expect, it } from "vitest";
import { CONTRACT_VERSION } from "@nejcm/dev-toolbar";
import { agentBridge } from "../agent/index";
import { commandMenu } from "../command-menu/index";
import { diagnostics } from "../diagnostics/index";
import { TARGET_CONTRACT_VERSION } from "../diagnostics/runtime";
import { environment } from "../environment/index";
import { flags } from "../flags/index";
import { metrics } from "../metrics/index";
import { overlays } from "../overlays/index";
import { themeEditor } from "../theme-editor/index";
import { extensionRoster } from "../../test-utils/extension-roster";
import type { DevToolbarExtension } from "../../core/contract";

const roster = extensionRoster();

/** Keyed by subpath name, so the keys can be compared against the two derived sets. */
const FACTORIES: Record<string, () => DevToolbarExtension> = {
  agent: () => agentBridge({ instanceId: "version-probe" }),
  "command-menu": () => commandMenu(),
  diagnostics: () => diagnostics(),
  environment: () => environment(),
  flags: () => flags(),
  metrics: () => metrics(),
  overlays: () => overlays(),
  "theme-editor": () => themeEditor(),
};

describe("every first-party extension declares core's contract version", () => {
  it("covers exactly the extensions that exist on disk", () => {
    // Fails for a ninth `src/ext/foo/` that nobody added below — which is the
    // whole point, and is not something comparing two hand-written lists can do.
    expect(Object.keys(FACTORIES).sort()).toEqual(roster.onDisk);
  });

  it("covers exactly the extensions package.json publishes", () => {
    // The other half: a directory that exists but was never added to `exports`
    // is unpublishable (AGENTS.md), and one that is exported without a
    // directory is broken. Requiring both to match these factories catches
    // either mistake here rather than at `bun run build`.
    expect(Object.keys(FACTORIES).sort()).toEqual(roster.published);
  });

  it.each(Object.entries(FACTORIES))("%s", (name, build) => {
    const extension = build();
    expect(extension.contractVersion, `${name} declares a stale contractVersion`).toBe(
      CONTRACT_VERSION,
    );
  });

  it("keeps the one non-factory copy in step too", () => {
    // Printed into every outbound bug report, so drift here is a wrong fact in
    // somebody's ticket about a version they cannot check.
    expect(TARGET_CONTRACT_VERSION).toBe(CONTRACT_VERSION);
  });
});
