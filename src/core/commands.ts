import type { DevToolbarExtension, ToolbarCommand } from "./contract";

/**
 * Flattens extension-declared commands. Later duplicates of an id are dropped.
 *
 * `hidden` extensions contribute nothing. `hidden` means the extension does not
 * exist for this actor, so leaving its commands runnable — by `runCommand(id)`
 * today, and by the `/ext/command-menu` palette in P2 — would hand back exactly
 * what hiding it took away.
 */
export function collectCommands(
  extensions: readonly DevToolbarExtension[],
): ToolbarCommand[] {
  const seen = new Set<string>();
  const commands: ToolbarCommand[] = [];
  for (const extension of extensions) {
    if (extension.hidden === true) continue;
    for (const command of extension.commands ?? []) {
      if (seen.has(command.id)) continue;
      seen.add(command.id);
      commands.push(command);
    }
  }
  return commands;
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

export function findCommand(
  id: string,
  scope?: readonly ToolbarCommand[],
): ToolbarCommand | undefined {
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
 */
export async function runCommand(
  id: string,
  scope?: readonly ToolbarCommand[],
): Promise<boolean> {
  const command = findCommand(id, scope);
  if (!command) {
    // eslint-disable-next-line no-console
    console.warn(`[dev-toolbar] no command registered with id "${id}".`);
    return false;
  }
  await command.run();
  return true;
}
