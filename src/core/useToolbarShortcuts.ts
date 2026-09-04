import { useEffect, useMemo } from "react";
import type { AnyToolbarCommand } from "./contract";
import { findShortcutCommand, warnShortcutYieldsToToggle } from "./commands";
import { matchesShortcut, parseShortcut } from "./shortcut";

export function useToolbarShortcuts(options: {
  enabled: boolean;
  shortcut: string | null;
  bindCommandShortcuts: boolean;
  toggleVisible(): void;
  getCommands(): readonly AnyToolbarCommand[];
}): void {
  const { enabled, shortcut, bindCommandShortcuts, toggleVisible, getCommands } = options;

  // Toggle shortcut.
  const parsedShortcut = useMemo(
    () =>
      shortcut === null
        ? null
        : parseShortcut(
            shortcut,
            "Pass `shortcut={null}` to disable the toggle shortcut deliberately.",
          ),
    [shortcut],
  );
  // One listener for both shortcut paths — the toggle chord and the opt-in
  // command bindings. Two listeners meant the toggle's `preventDefault()` made
  // the command listener bail on `defaultPrevented` before it could warn about
  // a command shadowed by the toggle, so precedence depended on which effect
  // registered first. Here the toggle wins by construction: the chord is
  // tested before the aggregation is consulted, and the guards run once.
  //
  // Command bindings are opt-in because existing `shortcut` strings are often
  // hints describing a host's own binding. They do not read visibility —
  // hidden extensions already contribute no commands, and a visible-only rule
  // would make the binding depend on UI state the command has nothing to do
  // with. Effective vs store visibility (phase 3) is therefore irrelevant here.
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    if (!parsedShortcut && !bindCommandShortcuts) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isIgnoredShortcutEvent(event)) return;
      if (parsedShortcut !== null && matchesShortcut(event, parsedShortcut)) {
        // Still enumerate: a command that declared this chord is otherwise
        // silently unbound, which is the failure mode rule 3 exists to
        // surface. Warn before toggling, so the report does not depend on
        // what the visibility change does.
        if (bindCommandShortcuts) {
          const shadowed = findShortcutCommand(event, getCommands());
          if (shadowed !== undefined) warnShortcutYieldsToToggle(shadowed.id);
        }
        event.preventDefault();
        toggleVisible();
        return;
      }
      // `parsedShortcut === null` (or unparseable) disables the toggle only;
      // command bindings stay live.
      if (!bindCommandShortcuts) return;
      // Re-enumerated per keypress, so a shortcut a function-form `commands`
      // starts declaring after mount binds without a re-render.
      const command = findShortcutCommand(event, getCommands());
      if (command === undefined) return;
      event.preventDefault();
      try {
        void Promise.resolve(command.run()).catch((error: unknown) => {
          reportShortcutCommandError(command.id, error);
        });
      } catch (error) {
        reportShortcutCommandError(command.id, error);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bindCommandShortcuts, enabled, getCommands, parsedShortcut, toggleVisible]);
}

/**
 * Listener is on `window`, so `document` handlers ran first: `defaultPrevented`
 * is how a host claims the chord. `isComposing` keeps IME out; `repeat` keeps a
 * held chord from auto-firing. Checked once, for both the toggle and the
 * command bindings; the focused element is deliberately not consulted.
 */
function isIgnoredShortcutEvent(event: KeyboardEvent): boolean {
  return event.defaultPrevented || event.isComposing || event.repeat;
}

/** Covers both a synchronous throw from `run()` and a rejected promise. */
function reportShortcutCommandError(id: string, error: unknown): void {
  // eslint-disable-next-line no-console
  console.error(`[dev-toolbar] command "${id}" failed from its shortcut.`, error);
}
