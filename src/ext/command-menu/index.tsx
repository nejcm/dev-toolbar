/**
 * `@nejcm/dev-toolbar/ext/command-menu`
 *
 * The palette over the commands core has been aggregating since P0. Written
 * strictly as a consumer of the public extension contract: nothing here imports
 * a *value* from `src/core/*`, only types, which erase at build time.
 *
 * ```tsx
 * import { commandMenu } from "@nejcm/dev-toolbar/ext/command-menu";
 *
 * // Build it ONCE, outside render.
 * const extensions = [commandMenu(), flags({ ... }), metrics()];
 * ```
 *
 * `Mod+K` opens it; type to filter; `↑`/`↓` to move, `↵` to run, `esc` to
 * dismiss. It contributes no commands of its own — it is the one extension in
 * this repo that only reads.
 *
 * Four things are worth knowing before you rely on it.
 *
 * - **It re-enumerates every time it opens.** `commands` may be a function
 *   (added in P2), so an extension can begin contributing one after mount — a
 *   feature flag that appeared, a route that registered a tool. The palette
 *   asks core again on each open rather than rendering a list it captured.
 * - **It runs commands by `id`, through core.** So a command that was listed
 *   and has since gone reports *no longer available* instead of running a stale
 *   closure, and a `hidden` extension's commands are unreachable here for the
 *   same reason they are unreachable everywhere else.
 * - **A failing command keeps the palette open.** It runs somebody else's code;
 *   the throw is caught, shown in place, and never reaches the host app.
 * - **It lives in the `overlay` slot, not a panel.** Three reasons: core hosts
 *   one panel at a time, so a palette in a panel would evict whatever you
 *   opened it to act on; a panel is a 320px drawer with a resizer, not a modal;
 *   and the overlay slot is the one surface core never collapses into the `···`
 *   menu, so the shortcut cannot be lost by narrowing the window. The bar chip
 *   is a convenience — the key binding lives in `start()` and works without it.
 *
 * Replacing it with your team's own `cmdk` is one line: drop this extension,
 * write your own over `useToolbarCommands()` / `useDevToolbar().getCommands()`.
 * That is the whole point of core aggregating and rendering nothing.
 */
import { createCommandMenuRuntime, isApplePlatform } from "./runtime";
import { CommandMenuOverlay, CommandMenuTrigger } from "./ui";
import type { CommandMenuRuntimeOptions } from "./runtime";
import type {
  DevToolbarExtension,
  ExtensionRuntimeApi,
  ToolbarAlign,
} from "../../core/contract";

export interface CommandMenuOptions extends CommandMenuRuntimeOptions {
  /** Extension id. Default `"command-menu"`. */
  id?: string;
  /** Bar label and the dialog's accessible name. Default `"Commands"`. */
  label?: string;
  /** Default `"end"` — the `⌘` in the screenshot sits with the metrics. */
  align?: ToolbarAlign;
  /** Default `-100`, so it leads its region. */
  order?: number;
  /**
   * Overflow collapse order. Default `90`: the chip is small and it is the way
   * most people will discover the palette exists, so it should be among the
   * last things to collapse. Nothing is lost when it does — see the note on the
   * overlay slot above.
   */
  priority?: number;
  hidden?: boolean;
  /** Search field placeholder and its accessible name. */
  placeholder?: string;
  /** Shown when nothing matches. */
  emptyMessage?: string;
  /**
   * Inject this extension's stylesheet. Default `true`. Core's own
   * `injectStyles` prop is not visible to extensions, so if you turned that off
   * turn this off too and ship `COMMAND_MENU_CSS` yourself.
   */
  injectStyles?: boolean;
}

/**
 * Builds the extension. Call it once — the returned object owns the palette's
 * state and, once started, the key binding.
 */
export function commandMenu(
  options: CommandMenuOptions = {},
): DevToolbarExtension {
  const {
    id = "command-menu",
    label = "Commands",
    align = "end",
    order = -100,
    priority = 90,
    hidden,
    placeholder = "Search commands…",
    emptyMessage = "No matching command.",
    injectStyles = true,
    shortcut,
    apple = isApplePlatform(),
    rememberRecent,
  } = options;

  // Built here, not in start(api): slot functions run during the toolbar's
  // first render, which is before any effect fires.
  const runtime = createCommandMenuRuntime({
    ...(shortcut === undefined ? {} : { shortcut }),
    apple,
    ...(rememberRecent === undefined ? {} : { rememberRecent }),
  });

  return {
    id,
    label,
    contractVersion: 1,
    align,
    order,
    priority,
    ...(hidden === undefined ? {} : { hidden }),

    start(api: ExtensionRuntimeApi) {
      return runtime.start(api);
    },

    compact: ({ isOverflowed }) => (
      <CommandMenuTrigger
        runtime={runtime}
        label={label}
        isOverflowed={isOverflowed}
        injectStyles={injectStyles}
        apple={apple}
      />
    ),

    overlay: () => (
      <CommandMenuOverlay
        runtime={runtime}
        label={label}
        placeholder={placeholder}
        emptyMessage={emptyMessage}
        injectStyles={injectStyles}
      />
    ),
  };
}

export { COMMAND_MENU_CSS, ensureCommandMenuStyles } from "./css";
export {
  ariaKeyshortcuts,
  createCommandMenuRuntime,
  describeHotkey,
  DEFAULT_SHORTCUT,
  isApplePlatform,
  matchesHotkey,
  parseHotkey,
  RECENT_KEY,
  RECENT_LIMIT,
} from "./runtime";
export type {
  CommandMenuRuntime,
  CommandMenuRuntimeOptions,
  CommandMenuSnapshot,
  ParsedHotkey,
} from "./runtime";
export {
  filterCommands,
  OTHER_SECTION,
  RECENT_SECTION,
  scoreCommand,
  sectionsOf,
} from "./types";
export type { CommandMatch } from "./types";
