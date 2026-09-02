import type { DevToolbarExtension, ToolbarCommand, ToolbarCommandsInput } from "./contract";

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
function isCommand(value: unknown): value is ToolbarCommand {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ToolbarCommand>;
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
): readonly ToolbarCommand[] {
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
export function collectCommands(extensions: readonly DevToolbarExtension[]): ToolbarCommand[] {
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
    const commands: ToolbarCommand[] = [];
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
  getCommands(): readonly ToolbarCommand[];
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

function findCommand(id: string, scope?: readonly ToolbarCommand[]): ToolbarCommand | undefined {
  if (scope) return scope.find((command) => command.id === id);
  for (const host of [...hosts].reverse()) {
    const found = host.getCommands().find((command) => command.id === id);
    if (found) return found;
  }
  return undefined;
}

/**
 * Runs an aggregated command by id. Resolves `false` when no mounted toolbar
 * declares it. Prefer `useDevToolbar().runCommand` inside React code — this is
 * for call sites with no context (hotkeys, consoles, tests).
 *
 * `scope` is resolved at call time, not from a snapshot, since a list captured
 * a render ago may already be stale with the function form of `commands`.
 *
 * If `run()` throws or returns a rejected promise, this rejects with that same
 * error — callers must catch it.
 */
export async function runCommand(id: string, scope?: readonly ToolbarCommand[]): Promise<boolean> {
  const command = findCommand(id, scope);
  if (!command) {
    // eslint-disable-next-line no-console
    console.warn(`[dev-toolbar] no command registered with id "${id}".`);
    return false;
  }
  await command.run();
  return true;
}
