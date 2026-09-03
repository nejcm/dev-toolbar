/**
 * Everything `/ext/agent` owns that is not React — which is all of it.
 * [dev-toolbar/ext/agent]
 *
 * The bridge is a transport, not a feature: it closes over the
 * `ExtensionRuntimeApi` core handed it and publishes those three verbs on a
 * global so a script inside the page (`page.evaluate`, CDP, a computer-use
 * agent) can reach them. It adds no enumeration path of its own, which is how
 * `hidden` is inherited rather than reimplemented — `getCommands()` and
 * `getDiagnostics()` already drop hidden extensions
 * (`plans/agent-readable-toolbar.md` § Phase 0, decision 6).
 *
 * Nothing here runs at module evaluation. `installAgentBridge` is called from
 * `start(api)`, which is client-only, so importing this module on a server is
 * inert (decision 5).
 */
import { redact } from "../../runtime";
import type { RedactOptions } from "../../runtime";
import { startAgentReporter } from "./report";
import type { AgentReportOptions } from "./report";
import { AGENT_MARKER, AGENT_PROTOCOL_VERSION } from "./types";
import type {
  AgentBarItemView,
  AgentCommandView,
  AgentHandle,
  AgentRegistry,
  AgentRunResult,
  AgentShellView,
} from "./types";
import type {
  AnyToolbarCommand,
  ExtensionDiagnostics,
  ExtensionRuntimeApi,
} from "../../core/contract";

export interface AgentRuntimeOptions {
  /** The `instanceId` of the `<DevToolbar>` this bridge is mounted in. Keys the registry. */
  instanceId: string;
  /** Global name to install the registry at. */
  globalName: string;
  /** When false, the handle carries no `runCommand` at all. */
  allowRun: boolean;
  /** Extra `redact()` keys for consumer-supplied diagnostics. */
  extraKeys?: readonly string[];
  /** Reported in the snapshot so a reader can branch on it. */
  contractVersion: number;
  /**
   * Optional off-page transport (Phase 3). Absent means the bridge opens no
   * connection to anything and stays exactly what Phases 0–2 made it: a
   * global for a script that is already in the page.
   */
  report?: AgentReportOptions;
}

/** `globalThis`, or `null` where there isn't one (no `window` read, on purpose). */
function host(): Record<string, unknown> | null {
  return typeof globalThis === "undefined"
    ? null
    : (globalThis as unknown as Record<string, unknown>);
}

const warn = (message: string): void => {
  // eslint-disable-next-line no-console -- the only channel an extension has.
  console.warn(`${AGENT_MARKER} ${message}`);
};

/** `Object.defineProperty`, so an `instanceId` of `__proto__` stores a key rather than invoking a setter. */
function define(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/* -------------------------------------------------------------------------- */
/* The one DOM read                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Mirrors core's `instanceHeightVariable` (`src/core/DevToolbar.tsx`).
 *
 * A copy rather than an import because an extension may import only *types*
 * from core — a value import is not guaranteed by the bundler to resolve to
 * the host's copy (AGENTS.md). Six characters of regex; if core's folding
 * rule changes, this changes with it.
 */
function heightVariableName(instanceId: string): string {
  return `--dev-toolbar-height-${instanceId.replace(/[^A-Za-z0-9_-]+/g, "_")}`;
}

const PART = (name: string): string => `[data-dtb-part="${name}"]`;

/** `data-dtb-ext-id`, or `null` on a node that somehow has none. */
const extIdOf = (element: Element): string | null => element.getAttribute("data-dtb-ext-id");

function toBarItem(element: Element): AgentBarItemView {
  return {
    id: extIdOf(element) ?? "",
    align: element.getAttribute("data-dtb-align"),
    panelOpen: element.getAttribute("data-dtb-panel-open") === "true",
  };
}

/**
 * **The only place this extension reads the DOM**, and it is deliberate.
 *
 * Position, density, colour scheme, the height variable and bar membership
 * are facts about the *shell*, and the shell is core: there is no extension
 * to publish them through `diagnostics()`, and giving core one would be a
 * core change and a `CONTRACT_VERSION` conversation
 * (`plans/agent-readable-toolbar.md` § Phase 1, open question 3 — the answer
 * for this phase is the bridge). Everything else the bridge reports comes
 * from `api`, and nothing here reads an extension's own markup: an extension
 * that wants to be readable publishes state, it does not get scraped.
 *
 * Read-only and fail-soft. There is no document during SSR and none in a
 * plain Node test, and an unmounted (or hidden — core removes the root
 * rather than hiding it) toolbar has no root, so both answer `mounted:
 * false` rather than throwing.
 */
export function readShell(instanceId: string): AgentShellView {
  const name = heightVariableName(instanceId);
  const empty: AgentShellView = {
    mounted: false,
    position: null,
    density: null,
    colorScheme: null,
    heightVariable: { name, value: null },
    bar: [],
    overflow: { present: false, open: false, items: [] },
    activePanel: null,
  };
  if (typeof document === "undefined" || document.documentElement === null) return empty;

  // Matched by attribute value in JS rather than in the selector: `instanceId`
  // is an arbitrary string and a CSS attribute selector would need escaping
  // that `CSS.escape` does not cover for every host.
  const root = [...document.querySelectorAll(PART("root"))].find(
    (candidate) => candidate.getAttribute("data-dtb-instance") === instanceId,
  );

  const value = document.documentElement.style.getPropertyValue(name).trim();
  const heightVariable = { name, value: value === "" ? null : value };
  if (root === undefined) return { ...empty, heightVariable };

  const button = root.querySelector(PART("overflow-button"));
  const menu = root.querySelector(PART("overflow-menu"));

  return {
    mounted: true,
    position: root.getAttribute("data-dtb-position"),
    density: root.getAttribute("data-dtb-density"),
    colorScheme: root.getAttribute("data-dtb-color-scheme"),
    heightVariable,
    bar: [...root.querySelectorAll(`${PART("region")} > ${PART("item")}[data-dtb-ext-id]`)].map(
      toBarItem,
    ),
    overflow: {
      present: button !== null,
      open: menu !== null,
      items: [...root.querySelectorAll(`${PART("overflow-menu-item")}[data-dtb-ext-id]`)]
        .map(extIdOf)
        .filter((id): id is string => id !== null),
    },
    activePanel:
      root
        .querySelector(`${PART("panel")}[data-dtb-active="true"]`)
        ?.getAttribute("data-dtb-ext-id") ?? null,
  };
}

/**
 * One command, flattened to data. Optional fields are omitted rather than set
 * to `undefined`.
 *
 * `description` and `input` are contract v2 and are what make this list a tool
 * listing rather than a menu: `description` says whether to call it, `input`
 * says what to pass. `input` is copied by reference — it is the extension's own
 * frozen-by-convention description, and cloning a schema per read would cost
 * more than it protects.
 */
export function toCommandView(command: AnyToolbarCommand): AgentCommandView {
  const view: AgentCommandView = { id: command.id, label: command.label };
  if (command.description !== undefined) view.description = command.description;
  if (command.group !== undefined) view.group = command.group;
  if (command.keywords !== undefined) view.keywords = [...command.keywords];
  if (command.shortcut !== undefined) view.shortcut = command.shortcut;
  if (command.input !== undefined) view.input = command.input;
  return view;
}

/**
 * The registry object. A plain `instances` map plus a `default` accessor that
 * throws a message naming the ids to choose from — a guess would make the
 * second mounted toolbar an invisible source of wrong answers (decision 1).
 */
export function createAgentRegistry(): AgentRegistry {
  const instances: Record<string, AgentHandle> = {};
  const registry = { protocolVersion: AGENT_PROTOCOL_VERSION, instances };
  Object.defineProperty(registry, "default", {
    get(): AgentHandle {
      const ids = Object.keys(instances);
      if (ids.length === 1) return instances[ids[0] as string] as AgentHandle;
      throw new Error(
        ids.length === 0
          ? `${AGENT_MARKER} no toolbar is mounted with the agent bridge — is it in the extensions array, and has it rendered yet?`
          : `${AGENT_MARKER} ${ids.length} toolbars are mounted (${ids.join(", ")}); ` +
              `there is no default. Pick one: instances[${JSON.stringify(ids[0])}].`,
      );
    },
    // Non-enumerable on purpose: the getter throws whenever the instance
    // count is not exactly one, and an enumerable throwing getter would make
    // `{...registry}`, `Object.entries(registry)` and `JSON.stringify(registry)`
    // throw too — a trap for any in-page tooling that walks the global.
    enumerable: false,
    configurable: true,
  });
  return registry as AgentRegistry;
}

/** True for an object this bridge (or another copy of it) installed. */
function isAgentRegistry(value: unknown): value is AgentRegistry {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { protocolVersion?: unknown; instances?: unknown };
  return (
    candidate.protocolVersion === AGENT_PROTOCOL_VERSION &&
    typeof candidate.instances === "object" &&
    candidate.instances !== null
  );
}

const describeError = (error: unknown, options: RedactOptions): AgentRunResult => {
  // Message and name are redacted separately and never pre-joined: the
  // redactors match value shapes anchored to the whole string, so a message
  // that *is* a credential-carrying URL stops being maskable the moment
  // `"TypeError: "` sits in front of it (`core/contract.ts`).
  const message = error instanceof Error ? error.message : String(error);
  const result: AgentRunResult = {
    ok: false,
    reason: "threw",
    error: redact(message, options),
  };
  if (error instanceof Error && typeof error.name === "string") {
    result.errorName = redact(error.name, options);
  }
  return result;
};

/**
 * Builds the handle for one mounted toolbar. Every value comes from `api`, so
 * a hidden extension contributes nothing here for exactly the reason it
 * contributes nothing to the bar.
 */
export function createAgentHandle(
  api: ExtensionRuntimeApi,
  options: AgentRuntimeOptions,
): AgentHandle {
  const { instanceId, allowRun, contractVersion } = options;
  const redactOptions: RedactOptions =
    options.extraKeys === undefined ? {} : { extraKeys: options.extraKeys };

  /**
   * Decision 4, from the handle's own side. Deleting the registry entry stops
   * anyone *finding* a dead handle; it does nothing about one already held in
   * a variable, and `api` outlives the mount — `getCommands()` would keep
   * answering out of an unmounted root's refs. So every method asks first.
   *
   * Reads throw rather than answering: the only value-shaped answer available
   * is an empty snapshot, which an agent cannot tell from a live toolbar with
   * nothing in it.
   */
  const assertLive = (verb: string): void => {
    if (!api.signal.aborted) return;
    throw new Error(
      `${AGENT_MARKER} ${verb}() was called on instance "${instanceId}" after its toolbar ` +
        `unmounted. Re-read the handle from the registry; this one is dead.`,
    );
  };

  const listCommands = (): readonly AgentCommandView[] => {
    assertLive("listCommands");
    return api.getCommands().map(toCommandView);
  };

  /**
   * Redact on the way out (decision 3). Defence in depth on top of the
   * contract's requirement that an extension's `diagnostics()` already returns
   * data safe to leave the machine — the same two-layer argument
   * `/ext/diagnostics` makes, and the reason this bridge is an extension
   * rather than a core feature: core may not import `/runtime`.
   *
   * The second pass costs depth, and the cost is a consumer's to know about.
   * `redact()` walks from depth 0 and substitutes `"[truncated]"` at
   * `maxDepth` (8), so how much of a contribution survives depends on how far
   * inside the redacted root it sits. Three surfaces, three answers, in levels
   * kept below a contribution's own root:
   *
   * - **5** here: `data` sits at depth 2 (array -> entry -> `data`).
   * - **4** in `runCommand("diagnostics.capture").result`: depth 3
   *   (snapshot -> `contributions` -> entry -> `data`), and it is a *second*
   *   pass over a snapshot whose contributions were already redacted.
   * - **7** in the bug-report JSON: `/ext/diagnostics` redacts each
   *   contribution at its own root inside `finish()` and never re-redacts the
   *   assembly, and `renderJson` is a plain `JSON.stringify`.
   *
   * So the bug report is the most permissive surface and the bridge's capture
   * result the strictest — a deeply nested consumer `sources` entry can arrive
   * intact in a ticket and truncated through this handle. Nothing first-party
   * comes close to any of the three; a consumer that nests that far should
   * flatten, or raise `maxDepth` at the source. All three are pinned by
   * `__tests__/phase2.test.tsx`.
   */
  const readDiagnostics = (): readonly ExtensionDiagnostics[] => {
    const redacted = redact(api.getDiagnostics(), redactOptions);
    // `redact()` returns a tag string for a cycle or an exhausted budget.
    // Neither can happen for core's own array, but the cast would be a lie.
    return Array.isArray(redacted) ? (redacted as ExtensionDiagnostics[]) : [];
  };

  const handle: AgentHandle = {
    instanceId,
    contractVersion,
    allowRun,
    listCommands,
    read: () => {
      assertLive("read");
      return {
        instanceId,
        contractVersion,
        visible: api.isVisible(),
        allowRun,
        commands: api.getCommands().map(toCommandView),
        shell: readShell(instanceId),
        diagnostics: readDiagnostics(),
      };
    },
  };

  // Absent, not refusing: with `allowRun` off there is to be no way to run
  // anything at all (decision 2).
  if (allowRun) {
    handle.runCommand = async (id: string, input?: unknown): Promise<AgentRunResult> => {
      // The one method that keeps the errors-are-values rule instead of
      // throwing: a caller awaiting a result branches on it, and a dead
      // toolbar is just another reason nothing ran.
      if (api.signal.aborted) return { ok: false, reason: "torn-down" };
      if (typeof id !== "string") return { ok: false, reason: "unknown-command" };
      try {
        // `invokeCommand`, not `runCommand`: the boolean says only that
        // something ran, and a caller who is not looking at the screen needs
        // what it produced (`plans/agent-readable-toolbar.md` § Phase 2).
        const outcome = await api.invokeCommand(id, input);
        if (!outcome.ok) return { ok: false, reason: "unknown-command" };
        // Redacted on the way out, exactly like `read()` (decision 3). A
        // command's result crosses the same boundary a diagnostics read does,
        // and `undefined` is left off rather than published as a key.
        //
        // `redact()`'s depth and node budgets apply, so a deep enough result
        // comes back with `"[truncated]"` in the deep branch — and this is the
        // strictest of the three surfaces, since `diagnostics.capture`'s
        // snapshot arrives already redacted and is re-walked from three levels
        // up (see `readDiagnostics` for all three measured depths). Nothing
        // first-party reaches the limit; a deeply nested consumer contribution
        // can, and would still be intact in the bug-report JSON.
        const result = redact(outcome.result, redactOptions);
        return result === undefined ? { ok: true } : { ok: true, result };
      } catch (error) {
        // `invokeCommand` rejects with whatever `run()` threw — including the
        // refusals `flags.set` and `theme-editor.setToken` raise for bad input.
        // An agent reads the return value, so the throw becomes a value here.
        return describeError(error, redactOptions);
      }
    };
  }

  return handle;
}

/**
 * Installs the handle and returns the teardown. Idempotent teardown: it is
 * wired both to `api.signal` and to `start()`'s return value, and core may
 * call either, both, or the same one twice.
 *
 * Refuses rather than clobbers in the two collision cases — a foreign value
 * already at `globalName`, and a second toolbar claiming the same
 * `instanceId` — because overwriting either would hand an agent a handle onto
 * the wrong toolbar (decision 4's inverse: a live handle for a dead `api` is
 * worse than no handle, and so is a handle for somebody else's).
 */
export function installAgentBridge(
  api: ExtensionRuntimeApi,
  options: AgentRuntimeOptions,
): () => void {
  const scope = host();
  if (scope === null) return () => {};

  const { globalName, instanceId } = options;
  const existing = scope[globalName];
  if (existing !== undefined && !isAgentRegistry(existing)) {
    warn(
      `"${globalName}" is already taken by something else; the bridge was not installed. ` +
        `Pass a different \`globalName\` to agentBridge().`,
    );
    return () => {};
  }

  const registry = isAgentRegistry(existing) ? existing : createAgentRegistry();
  if (Object.prototype.hasOwnProperty.call(registry.instances, instanceId)) {
    warn(
      `instanceId "${instanceId}" is already registered; the second bridge was not installed. ` +
        `Give each <DevToolbar> its own instanceId, and pass the same one to agentBridge().`,
    );
    return () => {};
  }

  const handle = createAgentHandle(api, options);
  define(registry.instances as unknown as Record<string, unknown>, instanceId, handle);
  if (existing === undefined) define(scope, globalName, registry);

  // Started only once the handle is actually registered, so neither refusal
  // above leaves a timer posting the state of a bridge that was not installed.
  const stopReporter =
    options.report === undefined ? null : startAgentReporter(handle, options.report);

  let torn = false;
  const teardown = (): void => {
    if (torn) return;
    torn = true;
    stopReporter?.();
    if (registry.instances[instanceId] === handle) {
      delete registry.instances[instanceId];
    }
    // The last instance takes the global with it — a name left behind holding
    // an empty registry reads as "a toolbar is mounted" to anyone probing.
    if (Object.keys(registry.instances).length === 0 && scope[globalName] === registry) {
      delete scope[globalName];
    }
  };

  if (api.signal.aborted) {
    teardown();
    return teardown;
  }
  api.signal.addEventListener("abort", teardown, { once: true });
  return teardown;
}
