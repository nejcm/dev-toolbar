/**
 * One assertion, across every first-party extension: the `contractVersion` each
 * one declares equals the `CONTRACT_VERSION` core implements.
 *
 * §7 forbids an extension from importing a *value* from core, so each one
 * hand-maintains its own copy of the number, and a missed bump is silent in
 * tests (`docs/adr/ADR-003-contract-version-policy.md`'s accepted risk).
 * `/ext/diagnostics` and `/ext/theme-editor` already assert this in their own
 * suites; this file covers the rest.
 *
 * **The roster is derived, not restated**: a list of names checked against
 * another hand-written list is a tautology, so the expected set is read from
 * the filesystem *and* from `package.json`'s `exports`, both required to agree
 * with each other and with the factories below.
 *
 * Lives here rather than beside core's contract tests because
 * `src/core/__tests__/boundary.test.ts` forbids anything under `src/core` from
 * naming `ext/`, tests included.
 */
import { describe, expect, it } from "vitest";
import { CONTRACT_VERSION } from "@nejcm/dev-toolbar";
import { a11y } from "../a11y/index";
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

/** Keyed by subpath name so the keys can be compared against the two derived sets. */
const FACTORIES: Record<string, () => DevToolbarExtension> = {
  a11y: () => a11y(),
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
    // Fails for a `src/ext/foo/` nobody added below — comparing two
    // hand-written lists could never catch that.
    expect(Object.keys(FACTORIES).sort()).toEqual(roster.onDisk);
  });

  it("covers exactly the extensions package.json publishes", () => {
    // The other half: a directory never added to `exports` is unpublishable
    // (AGENTS.md), and an export without a directory is broken.
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
