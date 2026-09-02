import type { DevToolbarExtension, ToolbarCommand, ToolbarCommandsInput } from "./contract";

/**
 * Failures already reported, so a broken `commands()` logs once, not per
 * render. Keyed by `<id>:<reason>`, not by id alone: a `commands()` that throws
 * and one that returns the wrong shape are different defects, and sharing a
 * suppression slot means fixing one hides the other.
 */
const warned = new Set<string>();

/**
 * Reentrancy guard. `ExtensionRuntimeApi.getCommands()` aggregates, and an
 * extension could — by accident — call it from inside its own `commands()`.
 * Without this that recurses until the stack ends, inside a render.
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
 * Resolves one extension's `commands`, fail-closed.
 *
 * The function form runs *consumer code during core's render*, outside any
 * error boundary, so a throw here would take down the host application rather
 * than degrade to an error chip. It is contained instead: the extension
 * contributes nothing and core says so once.
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
 * Flattens extension-declared commands. Later duplicates of an id are dropped.
 *
 * Order is extension order, then declaration order, and it is the order a
 * palette renders — so it has to be a pure function of the extension list.
 *
 * `hidden` extensions contribute nothing. `hidden` means the extension does not
 * exist for this actor, so leaving its commands runnable — by `runCommand(id)`,
 * or through the `/ext/command-menu` palette — would hand back exactly what
 * hiding it took away.
 */
export function collectCommands(extensions: readonly DevToolbarExtension[]): ToolbarCommand[] {
  if (aggregating) {
    // Through `warnOnce` like every other failure on this path: it is reached
    // during render, and under StrictMode a recursive `commands()` would
    // otherwise log twice per render for as long as the page is open.
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
 * Mounted instances, most recent last. This is not an extension registry — it
 * only exists so the module-level `runCommand(id)` can reach a mounted
 * toolbar. Entries are added on mount and removed on unmount, so test and
 * multi-root isolation hold.
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
 * declares it. Prefer `useDevToolbar().runCommand` inside React code — this
 * exists for call sites that have no context (hotkeys, consoles, tests).
 *
 * `scope` is resolved *at call time*, not from a snapshot: with the function
 * form of `commands`, a list captured a render ago may already be stale, and
 * "the command is gone" and "the command was never there" must not be told
 * apart by how recently the caller happened to enumerate.
 *
 * If the command's `run()` throws, or returns a promise that rejects, this
 * rejects with that same error instead of resolving — callers must catch it.
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
