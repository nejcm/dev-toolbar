import type {
  AnyToolbarCommand,
  CommandInvocation,
  DevToolbarExtension,
  ToolbarCommandsInput,
} from "./contract";

/**
 * Failures already reported, so a broken `commands()` logs once, not per render.
 * Keyed by `<id>:<reason>` — a throw and a wrong-shape return are different
 * defects and shouldn't share a suppression slot.
 */
const warned = new Set<string>();

/**
 * Reentrancy guard against an extension accidentally calling
 * `ExtensionRuntimeApi.getCommands()` from inside its own `commands()`, which
 * would otherwise recurse until the stack ends, inside a render.
 */
let aggregating = false;

/** Only ids and runnable commands survive. A function form can return anything. */
function isCommand(value: unknown): value is AnyToolbarCommand {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AnyToolbarCommand>;
  return (
    typeof candidate.id === "string" && candidate.id !== "" && typeof candidate.run === "function"
  );
}

function warnOnce(key: string, message: string, error?: unknown): void {
  if (warned.has(key)) return;
  warned.add(key);
  // eslint-disable-next-line no-console
  console.error(`[dev-toolbar] ${message}`, ...(error === undefined ? [] : [error]));
}

/** Test seam: `warnOnce` is per process, which would leak between test cases. */
export function resetCommandWarnings(): void {
  warned.clear();
}

/**
 * Resolves one extension's `commands`, fail-closed. The function form runs
 * consumer code during core's render, outside any error boundary, so a throw is
 * contained here instead: the extension contributes nothing and core logs it once.
 */
export function resolveExtensionCommands(
  extension: DevToolbarExtension,
): readonly AnyToolbarCommand[] {
  const input: ToolbarCommandsInput | undefined = extension.commands;
  if (input === undefined) return [];
  if (typeof input !== "function") {
    return Array.isArray(input) ? input.filter(isCommand) : [];
  }
  let produced: unknown;
  try {
    produced = input();
  } catch (error) {
    warnOnce(
      `${extension.id}:throw`,
      `extension "${extension.id}" threw from commands(). It contributes no ` +
        "commands. commands() must be a pure, cheap enumeration — it runs " +
        "during render.",
      error,
    );
    return [];
  }
  if (!Array.isArray(produced)) {
    warnOnce(
      `${extension.id}:shape`,
      `extension "${extension.id}" returned ${typeof produced} from commands(); ` +
        "an array was expected. It contributes no commands.",
    );
    return [];
  }
  return produced.filter(isCommand);
}

/**
 * Flattens extension-declared commands, dropping later duplicates of an id.
 * Order is extension order then declaration order — the order a palette
 * renders, so this must be a pure function of the extension list. `hidden`
 * extensions contribute nothing, since a hidden extension's commands must not
 * stay runnable via `runCommand(id)` or the palette.
 */
export function collectCommands(extensions: readonly DevToolbarExtension[]): AnyToolbarCommand[] {
  if (aggregating) {
    // warnOnce, not console directly: under StrictMode a recursive commands()
    // would otherwise log twice per render for as long as the page is open.
    warnOnce(
      "*:reentrant",
      "getCommands() was called from inside a commands() enumeration. The " +
        "nested call returns nothing rather than recursing.",
    );
    return [];
  }
  aggregating = true;
  try {
    const seen = new Set<string>();
    const commands: AnyToolbarCommand[] = [];
    for (const extension of extensions) {
      if (extension.hidden === true) continue;
      for (const command of resolveExtensionCommands(extension)) {
        if (seen.has(command.id)) continue;
        seen.add(command.id);
        commands.push(command);
      }
    }
    return commands;
  } finally {
    aggregating = false;
  }
}

export interface CommandHost {
  getCommands(): readonly AnyToolbarCommand[];
}

/**
 * Mounted instances, most recent last — exists only so the module-level
 * `runCommand(id)` can reach a mounted toolbar. Added on mount, removed on
 * unmount, so test and multi-root isolation hold.
 */
const hosts = new Set<CommandHost>();

export function registerCommandHost(host: CommandHost): () => void {
  hosts.add(host);
  return () => {
    hosts.delete(host);
  };
}

function findCommand(
  id: string,
  scope?: readonly AnyToolbarCommand[],
): AnyToolbarCommand | undefined {
  if (scope) return scope.find((command) => command.id === id);
  for (const host of [...hosts].reverse()) {
    const found = host.getCommands().find((command) => command.id === id);
    if (found) return found;
  }
  return undefined;
}

export interface InvokeCommandOptions {
  /** Handed to `run()` unchanged. A command with no `input` schema ignores it. */
  input?: unknown;
  /**
   * Resolved at call time, not from a snapshot, since a list captured a render
   * ago may already be stale with the function form of `commands`.
   */
  scope?: readonly AnyToolbarCommand[];
}

/**
 * Runs an aggregated command by id and resolves **what it returned**
 * (contract v2). `{ ok: false, reason: "unknown-command" }` when no mounted
 * toolbar declares the id.
 *
 * An options bag rather than a third positional argument: `runCommand(id, scope)`
 * already spent position two, and `runCommand(id, input, scope)` would silently
 * reinterpret every existing two-argument call.
 *
 * If `run()` throws or returns a rejected promise, this rejects with that same
 * error — callers must catch it. Turning that into a value is `/ext/agent`'s
 * job, at the boundary where a rejection would arrive as a bare string.
 */
export async function invokeCommand<Out = unknown>(
  id: string,
  options: InvokeCommandOptions = {},
): Promise<CommandInvocation<Out>> {
  const command = findCommand(id, options.scope);
  if (!command) {
    // eslint-disable-next-line no-console
    console.warn(`[dev-toolbar] no command registered with id "${id}".`);
    return { ok: false, reason: "unknown-command" };
  }
  // The one cast in the aggregation. A roster is erased to `AnyToolbarCommand`
  // so commands with different `In`/`Out` share an element type; this restores
  // the call signature the erasure gave up. `Out` is unchecked by construction
  // — only the command itself knows what it returns.
  const run = command.run as (input: unknown) => Out | Promise<Out>;
  return { ok: true, result: await run(options.input) };
}

/**
 * Runs an aggregated command by id. Resolves `false` when no mounted toolbar
 * declares it. Prefer `useDevToolbar().runCommand` inside React code — this is
 * for call sites with no context (hotkeys, consoles, tests).
 *
 * Kept resolving a `boolean` through the contract v2 change on purpose: it is a
 * published export, and widening it to `invokeCommand`'s object would make
 * every `if (await runCommand(id))` pass silently. Reach for `invokeCommand`
 * when the result matters.
 *
 * If `run()` throws or returns a rejected promise, this rejects with that same
 * error — callers must catch it.
 */
export async function runCommand(
  id: string,
  scope?: readonly AnyToolbarCommand[],
): Promise<boolean> {
  const outcome = await invokeCommand(id, scope === undefined ? {} : { scope });
  return outcome.ok;
}
