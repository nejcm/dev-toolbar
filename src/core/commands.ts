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

/** Keeps only non-empty ids with runnable commands. */
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
 * Resolves one extension's `commands`, fail-closed. A throwing function form
 * contributes nothing and is logged once because it runs during render.
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
 * Flattens extension commands, dropping later duplicates. Order follows the
 * extension list and each declaration list. Hidden extensions contribute nothing
 * because their commands must not remain runnable.
 */
export function collectCommands(extensions: readonly DevToolbarExtension[]): AnyToolbarCommand[] {
  if (aggregating) {
    // Use warnOnce because StrictMode can encounter this more than once.
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
 * Mounted instances, most recent last, for module-level `runCommand(id)`.
 * Mounting adds a host; unmounting removes it.
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
  /** Handed to `run()` unchanged. */
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
 * If `run()` throws or rejects, this rejects with the same error. `/ext/agent`
 * converts that rejection to a value at its page boundary.
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
  // The roster erases each command's `In`/`Out`; restore the selected command's
  // call signature once. `Out` is unchecked by construction.
  const run = command.run as (input: unknown) => Out | Promise<Out>;
  return { ok: true, result: await run(options.input) };
}

/**
 * Runs an aggregated command by id. Resolves `false` when no mounted toolbar
 * declares it. Use this from call sites without React context.
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
