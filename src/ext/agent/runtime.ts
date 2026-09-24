/**
 * Non-React implementation for `/ext/agent`.
 *
 * The bridge publishes `ExtensionRuntimeApi` through a global and adds no
 * enumeration of its own, so hidden-extension behavior comes from
 * `getCommands()` and `getDiagnostics()`. Installation happens from
 * client-only `start(api)`, not at module evaluation, so importing this
 * module during SSR is inert.
 */
import { describeError } from "../../runtime";
import type { RedactOptions } from "../../runtime";
import { readDiagnosticsRoster, redactForExport } from "@nejcm/dev-toolbar/kit";
import { startAgentReporter, unserialisableResult } from "./report";
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
  /** Optional off-page transport. Absent means the bridge opens no connection and stays only a global for a script already in the page. */
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

/**
 * Mirrors core's `instanceHeightVariable` (`src/core/useHeightVariables.ts`).
 * Kept as a copy — extensions may import only types from core — so update
 * this regex if core's folding rule changes.
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
 * **The only place this extension reads the DOM**, and it is deliberate:
 * position, density, colour scheme, the height variable and bar membership
 * are facts about the shell, which is core and has no extension to publish
 * them through `diagnostics()`. Everything else the bridge reports comes
 * from `api` — an extension's own markup is never scraped; it publishes
 * state instead.
 *
 * There is no document during SSR or in plain Node tests. An unmounted or
 * hidden toolbar has no root, so both return `mounted: false`.
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

  // Match the instance id in JS rather than a CSS attribute selector, which
  // would not escape it safely for every host.
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

/** Flattens one command to data, omitting optional fields that are absent. */
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
 * second mounted toolbar an invisible source of wrong answers.
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
    // Non-enumerable: an enumerable throwing getter would make `{...registry}`,
    // `Object.entries` and `JSON.stringify` throw too.
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

/** A command's throw as a value: `describeError()`'s halves, handed over unjoined. */
const threw = (error: unknown, options: RedactOptions): AgentRunResult => {
  const { name, message } = describeError(error, options);
  return name === undefined
    ? { ok: false, reason: "threw", error: message }
    : { ok: false, reason: "threw", error: message, errorName: name };
};

/** Builds the handle for one mounted toolbar from the runtime API. */
export function createAgentHandle(
  api: ExtensionRuntimeApi,
  options: AgentRuntimeOptions,
): AgentHandle {
  const { instanceId, allowRun, contractVersion } = options;
  const redactOptions: RedactOptions =
    options.extraKeys === undefined ? {} : { extraKeys: options.extraKeys };

  /**
   * A captured handle can outlive its registry entry, so every method checks
   * `api.signal`. Reads throw because an empty snapshot is indistinguishable
   * from a live toolbar with no state.
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
   * Redact again on the way out; extensions must also redact at the source,
   * this is defense in depth (belongs here since core may not import
   * `/runtime`). The kit redacts each contribution at its own root, so **7**
   * levels survive here, as in the bug-report JSON, and **4** in
   * `runCommand("diagnostics.capture").result` (a second pass three levels
   * down). All three numbers are pinned by `__tests__/phase2.test.tsx`.
   */
  const readDiagnostics = (): readonly ExtensionDiagnostics[] => {
    const roster = readDiagnosticsRoster(api, redactOptions);
    if (!roster.gathered) return [];
    // The published status has no "unserialisable", so the value is tagged in place, as redact() tags.
    return roster.entries.map((entry) =>
      entry.status === "unserialisable"
        ? { id: entry.id, label: entry.label, status: "ok", data: "[unserialisable]" }
        : entry,
    );
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

  // With `allowRun` off there is no run path at all.
  if (allowRun) {
    handle.runCommand = async (id: string, input?: unknown): Promise<AgentRunResult> => {
      if (api.signal.aborted) return { ok: false, reason: "torn-down" };
      if (typeof id !== "string") return { ok: false, reason: "unknown-command" };
      try {
        const outcome = await api.invokeCommand(id, input);
        if (!outcome.ok) return { ok: false, reason: "unknown-command" };
        // Same boundary as diagnostics: redact, prove it serialises, omit an `undefined` result.
        const exported = redactForExport(outcome.result, redactOptions);
        if (exported.status === "ok") return { ok: true, result: exported.value };
        if (exported.status === "absent") return { ok: true };
        return unserialisableResult(exported.error);
      } catch (error) {
        return threw(error, redactOptions);
      }
    };
  }

  return handle;
}

/**
 * Installs a handle and returns an idempotent teardown. Refuses a foreign
 * global or duplicate `instanceId` rather than handing an agent the wrong
 * toolbar.
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

  // Start reporting only after registration, so a refused bridge owns no timer.
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
    // An empty registry would falsely say that a toolbar is mounted.
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
