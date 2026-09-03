/**
 * `@nejcm/dev-toolbar/ext/command-menu`
 *
 * A command palette over core's command aggregation. Written strictly as a
 * consumer of the public extension contract: only types are imported from
 * `src/core/*`, never a value.
 *
 * ```tsx
 * import { commandMenu } from "@nejcm/dev-toolbar/ext/command-menu";
 *
 * // Build it ONCE, outside render.
 * const extensions = [commandMenu(), flags({ ... }), metrics()];
 * ```
 *
 * `Mod+K` opens it; type to filter; `↑`/`↓` to move, `↵` to run, `esc` to
 * dismiss. It contributes no commands of its own.
 *
 * - **Re-enumerates on every open**, since `commands` may be a function whose
 *   output can change after mount — it never renders a captured list.
 * - **Runs commands by `id`, through core** — a since-removed command reports
 *   *no longer available* rather than running a stale closure, and a `hidden`
 *   extension's commands stay unreachable here too.
 * - **A failing command keeps the palette open**; the throw is caught and
 *   shown in place rather than reaching the host app.
 * - **Lives in the `overlay` slot, not a panel** — a panel would evict
 *   whatever the palette was opened to act on, and the overlay is the one
 *   surface core never collapses into the `⋮` menu, so the shortcut always
 *   works even when the bar chip has collapsed.
 *
 * Swapping in your own `cmdk` is one line: drop this extension and build over
 * `useToolbarCommands()` / `useDevToolbar().getCommands()` instead.
 */
import { createCommandMenuRuntime, isApplePlatform } from "./runtime";
import { CommandMenuOverlay, CommandMenuTrigger } from "./ui";
import type { CommandMenuRuntimeOptions } from "./runtime";
import type { DevToolbarExtension, ExtensionRuntimeApi, ToolbarAlign } from "../../core/contract";

export interface CommandMenuOptions extends CommandMenuRuntimeOptions {
  /** Extension id. Default `"command-menu"`. */
  id?: string;
  /** Bar label and the dialog's accessible name. Default `"Commands"`. */
  label?: string;
  /** Default `"end"`. */
  align?: ToolbarAlign;
  /** Default `-100`, so it leads its region. */
  order?: number;
  /**
   * Overflow collapse order. Default `90` — kept among the last things to
   * collapse since it's the main way people discover the palette exists.
   * Nothing is lost when it does collapse; see the overlay-slot note above.
   */
  priority?: number;
  hidden?: boolean;
  /** Search field placeholder and its accessible name. */
  placeholder?: string;
  /** Shown when nothing matches. */
  emptyMessage?: string;
  /**
   * Inject this extension's stylesheet. Default `true`. Core's `injectStyles`
   * prop isn't visible to extensions, so if you turned that off, turn this off
   * too and ship `COMMAND_MENU_CSS` yourself.
   */
  injectStyles?: boolean;
}

/** Builds the extension. Call once — the result owns the palette's state and, once started, the key binding. */
export function commandMenu(options: CommandMenuOptions = {}): DevToolbarExtension {
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

  // Built here, not in start(api): slot functions run on first render, before any effect fires.
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

    /**
     * Whether the palette is open, and the current query.
     * `plans/agent-readable-toolbar.md` § Phase 1.
     */
    diagnostics: () => runtime.diagnostics(),

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
export { filterCommands, OTHER_SECTION, RECENT_SECTION, scoreCommand, sectionsOf } from "./types";
export type { CommandMatch } from "./types";
