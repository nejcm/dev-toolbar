import { Fragment, useEffect, useId, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import {
  EmptyState,
  Glyph,
  hasPaintableIcon,
  resolveAccessibleName,
  resolveIcon,
  useExtensionSurface,
} from "@nejcm/dev-toolbar/kit";
import type { ResolvedCompactPresentation } from "@nejcm/dev-toolbar/kit";
import { ensureCommandMenuStyles } from "./css";
import { describeHotkey, ariaKeyshortcuts } from "./runtime";
import type { CommandMenuRuntime, CommandMenuSnapshot } from "./runtime";
import { sectionsOf } from "./types";

/**
 * The rendered surface. [dev-toolbar/ext/command-menu]
 *
 * Uses the ARIA combobox pattern (a combobox over a listbox), not a pile of
 * divs: focus never leaves the text field, the active row is named by
 * `aria-activedescendant`, and the dialog is `aria-modal` with the one
 * focusable element it claims.
 */

/* -------------------------------------------------------------------------- */
/* Bar trigger                                                                 */
/* -------------------------------------------------------------------------- */

export interface TriggerProps {
  runtime: CommandMenuRuntime;
  label: string;
  /** Already through `resolvePresentation`, in the factory closure. */
  presentation: ResolvedCompactPresentation<CommandMenuSnapshot>;
  isOverflowed: boolean;
  injectStyles: boolean;
  styleNonce?: string;
  apple: boolean;
}

/**
 * The `⌘` bar item. A convenience, not the way in — the shortcut is bound in
 * `start()`, so it (and the palette, rendered from the never-collapsed
 * `overlay` slot) keeps working even after this chip collapses into `⋮`.
 */
export function CommandMenuTrigger({
  runtime,
  label,
  presentation,
  isOverflowed,
  injectStyles,
  styleNonce,
  apple,
}: TriggerProps): ReactNode {
  const snapshot = useExtensionSurface(
    runtime.store,
    injectStyles,
    ensureCommandMenuStyles,
    styleNonce,
  );
  const hint = describeHotkey(runtime.shortcut, apple);
  const keyshortcuts = ariaKeyshortcuts(runtime.shortcut, apple);
  const icon = resolveIcon(presentation.icon, snapshot);
  // Kit's one emptiness rule: a function `icon` that returns nothing for this
  // render leaves the hardcoded symbol in place rather than a gap — and
  // "nothing" is every node React paints nothing for, so
  // `icon: (s) => s.open && <X />` falls back to the `⌘` rather than to an
  // empty glyph where the symbol used to be.
  const hasIcon = hasPaintableIcon(icon);

  return (
    <button
      type="button"
      data-dtb-part="trigger"
      aria-haspopup="dialog"
      aria-expanded={snapshot.open}
      // A whitespace-only override is ignored, so no override can leave the
      // trigger unnamed. `title` explains; it does not name, so it is not
      // overridable — and it is the only place the hint is spelled out once the
      // hotkey hint has been swapped for an icon.
      aria-label={resolveAccessibleName(
        presentation.name,
        snapshot,
        `${label}${hint === "" ? "" : ` (${hint})`}`,
      )}
      {...(keyshortcuts === undefined ? {} : { "aria-keyshortcuts": keyshortcuts })}
      title={
        hint === "" ? `${label} — search and run every registered command` : `${label} — ${hint}`
      }
      onClick={() => runtime.toggle()}
    >
      {/* The icon replaces the hardcoded `⌘` and nothing else: the hotkey hint
          and the label are still painted after it.

          It takes a part of its own rather than `cmd-glyph`, and that is the
          decision worth knowing. `cmd-glyph` is not "the leading symbol" — it
          is *every* Apple modifier symbol this extension paints, including the
          ones inside each palette row's `cmd-option-hint`, and it exists to set
          those in the UI face at 1.18em because the monospace faces have no
          such glyph. That is type-setting for text. Giving it
          `data-dtb-kind="glyph"` (which `Glyph` pins) would put kit's
          `--dtb-glyph-size` line box and its `> *` size clamp on text spans
          down in the dialog, and would scale a consumer's `<svg>` by the 1.18em
          meant for a font fallback. So the kind lands here, on the one node that is a
          foreign element — which is what the clamp exists for — and the `⌘`
          keeps the bytes and the rules it has always had. */}
      {hasIcon ? (
        <Glyph data-dtb-part="cmd-icon">{icon}</Glyph>
      ) : (
        <span aria-hidden="true" data-dtb-part="cmd-glyph">
          {"⌘"}
        </span>
      )}
      {isOverflowed || hint === "" ? (
        <span>{label}</span>
      ) : (
        <span data-dtb-part="cmd-trigger">
          <HotkeyHint hint={hint} />
        </span>
      )}
    </button>
  );
}

/** The Apple modifier symbols `describeHotkey()` can emit. */
const MODIFIER_GLYPHS = /([⌘⌃⌥⇧])/;

/**
 * The hint with each modifier symbol in its own `cmd-glyph` span. Monospace
 * fonts have no `⌘`, so the glyph falls back to another face at a visibly
 * smaller size than the `K` beside it; the span lets the stylesheet set it in
 * the UI face, where the symbols are drawn to match the letters.
 */
function HotkeyHint({ hint }: { hint: string }): ReactNode {
  return hint
    .split(MODIFIER_GLYPHS)
    .filter((part) => part !== "")
    .map((part, index) =>
      MODIFIER_GLYPHS.test(part) ? (
        <span key={index} data-dtb-part="cmd-glyph">
          {part}
        </span>
      ) : (
        <Fragment key={index}>{part}</Fragment>
      ),
    );
}

/* -------------------------------------------------------------------------- */
/* Overlay                                                                     */
/* -------------------------------------------------------------------------- */

export interface OverlayProps {
  runtime: CommandMenuRuntime;
  label: string;
  placeholder: string;
  emptyMessage: string;
  injectStyles: boolean;
  styleNonce?: string;
}

/** Rendered by the `overlay` slot on every toolbar render; `null` while closed. */
export function CommandMenuOverlay(props: OverlayProps): ReactNode {
  const snapshot = useExtensionSurface(
    props.runtime.store,
    props.injectStyles,
    ensureCommandMenuStyles,
    props.styleNonce,
  );
  if (!snapshot.open) return null;
  return <Dialog {...props} snapshot={snapshot} />;
}

/**
 * Mounted only while open, so focus handling is a mount effect: it moves in
 * on mount and back on unmount, with no path that opens without focusing or
 * closes without restoring.
 */
function Dialog({
  runtime,
  label,
  placeholder,
  emptyMessage,
  snapshot,
}: OverlayProps & { snapshot: CommandMenuSnapshot }): ReactNode {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  useEffect(() => {
    const previous =
      typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null);
    inputRef.current?.focus();
    return () => {
      // Restore only if still in the document — a command may have unmounted whatever was focused.
      if (previous && previous.isConnected && typeof previous.focus === "function") {
        previous.focus();
      }
    };
  }, []);

  // Keep the active row on screen; jsdom has no scrollIntoView, hence the guard.
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(
      '[data-dtb-part="cmd-option"][aria-selected="true"]',
    );
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "nearest" });
    }
  }, [snapshot.activeIndex, snapshot.results]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "Escape":
        // An IME uses Escape to cancel a composition; don't discard the query over an abandoned candidate.
        if (event.nativeEvent.isComposing) return;
        event.preventDefault();
        // Core's overflow menu also closes on Escape via a document-level listener; stop it closing underneath the palette.
        event.stopPropagation();
        runtime.close();
        return;
      case "ArrowDown":
        if (event.nativeEvent.isComposing) return;
        event.preventDefault();
        runtime.move(1);
        return;
      case "ArrowUp":
        if (event.nativeEvent.isComposing) return;
        event.preventDefault();
        runtime.move(-1);
        return;
      case "Home":
        if (event.nativeEvent.isComposing) return;
        event.preventDefault();
        runtime.setActiveIndex(0);
        return;
      case "End":
        if (event.nativeEvent.isComposing) return;
        event.preventDefault();
        runtime.setActiveIndex(snapshot.results.length - 1);
        return;
      case "Enter":
        // An IME composing a candidate uses Enter to commit it.
        if (event.nativeEvent.isComposing) return;
        event.preventDefault();
        void runtime.run();
        return;
      case "Tab":
        // `aria-modal` claims focus is trapped; the input is the only focusable thing in here, so nowhere to cycle to.
        event.preventDefault();
        return;
      default:
    }
  };

  const sections = sectionsOf(snapshot.results);
  const active = snapshot.results[snapshot.activeIndex];

  return (
    <>
      {/* Decorative click-catcher; Escape and the dialog's own controls are the keyboard path out. */}
      <div
        data-dtb-part="cmd-scrim"
        // A right-click or stylus barrel press isn't a dismissal. `> 0` rather
        // than `!== 0`: jsdom's synthesized pointer events carry no `button`
        // at all, and should still be able to dismiss the dialog.
        onPointerDown={(event) => {
          if (event.button > 0) return;
          runtime.close();
        }}
        aria-hidden="true"
      />
      {/* The dialog owns key handling (arrows, Enter, Escape) since focus stays in the input, not the option list. */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        data-dtb-part="cmd-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          data-dtb-part="cmd-input"
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-label={placeholder}
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          {...(active === undefined
            ? {}
            : { "aria-activedescendant": optionId(snapshot.activeIndex) })}
          placeholder={placeholder}
          value={snapshot.query}
          onChange={(event) => runtime.setQuery(event.target.value)}
        />
        <div ref={listRef} id={listId} data-dtb-part="cmd-list" role="listbox" aria-label={label}>
          {snapshot.results.length === 0 ? (
            <EmptyState data-dtb-part="cmd-empty" role="status">
              {emptyMessage}
            </EmptyState>
          ) : (
            sections.map((section) => (
              <div
                key={`${section.section}-${section.from}`}
                {...(section.section === ""
                  ? { role: "presentation" }
                  : { role: "group", "aria-label": section.section })}
              >
                {section.section === "" ? null : (
                  <div data-dtb-part="cmd-section" aria-hidden="true">
                    {section.section}
                  </div>
                )}
                {snapshot.results.slice(section.from, section.to + 1).map((match, offset) => {
                  const index = section.from + offset;
                  const selected = index === snapshot.activeIndex;
                  return (
                    // Keyboard run is Enter on the dialog; pointer run is click, not pointerdown.
                    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
                    <div
                      key={match.command.id}
                      id={optionId(index)}
                      data-dtb-part="cmd-option"
                      data-dtb-command-id={match.command.id}
                      role="option"
                      aria-selected={selected}
                      aria-busy={snapshot.running === match.command.id ? true : undefined}
                      // pointerdown, not click: mousedown would otherwise blur the input first.
                      onPointerDown={(event) => {
                        event.preventDefault();
                        runtime.setActiveIndex(index);
                      }}
                      onClick={() => {
                        void runtime.run(match.command.id);
                      }}
                      onPointerMove={() => runtime.setActiveIndex(index)}
                    >
                      <span data-dtb-part="cmd-option-label">{match.command.label}</span>
                      {match.command.group === undefined || section.section !== "" ? null : (
                        <span data-dtb-part="cmd-option-group">{match.command.group}</span>
                      )}
                      {match.command.shortcut === undefined ? null : (
                        <kbd data-dtb-part="cmd-option-hint">
                          <HotkeyHint hint={match.command.shortcut} />
                        </kbd>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
        {snapshot.error === null ? null : (
          <div data-dtb-part="cmd-error" role="alert">
            {snapshot.error}
          </div>
        )}
        <div data-dtb-part="cmd-footer" aria-hidden="true">
          <span>
            <kbd>{"↑↓"}</kbd> navigate
          </span>
          <span>
            <kbd>{"↵"}</kbd> run
          </span>
          <span>
            <kbd>esc</kbd> dismiss
          </span>
          <span style={{ marginLeft: "auto" }}>
            {snapshot.results.length}/{snapshot.commands.length}
          </span>
        </div>
      </div>
    </>
  );
}
