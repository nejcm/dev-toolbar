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
import { AGENT_MARKER, AGENT_PROTOCOL_VERSION } from "./types";
import type { AgentCommandView, AgentHandle, AgentRegistry, AgentRunResult } from "./types";
import type {
  ExtensionDiagnostics,
  ExtensionRuntimeApi,
  ToolbarCommand,
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

/** One command, flattened to data. Optional fields are omitted rather than set to `undefined`. */
export function toCommandView(command: ToolbarCommand): AgentCommandView {
  const view: AgentCommandView = { id: command.id, label: command.label };
  if (command.group !== undefined) view.group = command.group;
  if (command.keywords !== undefined) view.keywords = [...command.keywords];
  if (command.shortcut !== undefined) view.shortcut = command.shortcut;
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
        diagnostics: readDiagnostics(),
      };
    },
  };

  // Absent, not refusing: with `allowRun` off there is to be no way to run
  // anything at all (decision 2).
  if (allowRun) {
    handle.runCommand = async (id: string): Promise<AgentRunResult> => {
      // The one method that keeps the errors-are-values rule instead of
      // throwing: a caller awaiting a result branches on it, and a dead
      // toolbar is just another reason nothing ran.
      if (api.signal.aborted) return { ok: false, reason: "torn-down" };
      if (typeof id !== "string") return { ok: false, reason: "unknown-command" };
      try {
        const found = await api.runCommand(id);
        return found ? { ok: true } : { ok: false, reason: "unknown-command" };
      } catch (error) {
        // `runCommand` rejects with whatever `run()` threw. An agent reads the
        // return value, so the throw becomes a value here.
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

  let torn = false;
  const teardown = (): void => {
    if (torn) return;
    torn = true;
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
