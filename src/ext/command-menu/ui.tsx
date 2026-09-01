import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { ensureCommandMenuStyles } from "./css";
import { describeHotkey, ariaKeyshortcuts } from "./runtime";
import type { CommandMenuRuntime, CommandMenuSnapshot } from "./runtime";
import { sectionsOf } from "./types";

/**
 * The rendered surface. [dev-toolbar/ext/command-menu]
 *
 * A combobox over a listbox, which is what a command palette *is* — so the
 * roles are the ARIA combobox pattern rather than a pile of divs: focus never
 * leaves the text field, the active row is named by `aria-activedescendant`,
 * and the dialog is `aria-modal` with the one focusable element it claims.
 */

function useSnapshot(runtime: CommandMenuRuntime): CommandMenuSnapshot {
  return useSyncExternalStore(
    runtime.store.subscribe,
    runtime.store.getSnapshot,
    runtime.store.getSnapshot,
  );
}

function useStyles(inject: boolean): void {
  useEffect(() => {
    if (inject) ensureCommandMenuStyles();
  }, [inject]);
}

/* -------------------------------------------------------------------------- */
/* Bar trigger                                                                 */
/* -------------------------------------------------------------------------- */

export interface TriggerProps {
  runtime: CommandMenuRuntime;
  label: string;
  isOverflowed: boolean;
  injectStyles: boolean;
  apple: boolean;
}

/**
 * The `⌘` item from the screenshot. It is a convenience, not the way in: the
 * shortcut is bound in `start()`, so it keeps working when this chip collapses
 * into the `···` menu — and so does the palette, which renders from the
 * `overlay` slot core never collapses.
 */
export function CommandMenuTrigger({
  runtime,
  label,
  isOverflowed,
  injectStyles,
  apple,
}: TriggerProps): ReactNode {
  useStyles(injectStyles);
  const snapshot = useSnapshot(runtime);
  const hint = describeHotkey(runtime.shortcut, apple);
  const keyshortcuts = ariaKeyshortcuts(runtime.shortcut, apple);

  return (
    <button
      type="button"
      data-dtb-part="trigger"
      aria-haspopup="dialog"
      aria-expanded={snapshot.open}
      aria-label={`${label}${hint === "" ? "" : ` (${hint})`}`}
      {...(keyshortcuts === undefined ? {} : { "aria-keyshortcuts": keyshortcuts })}
      title={
        hint === "" ? `${label} — search and run every registered command` : `${label} — ${hint}`
      }
      onClick={() => runtime.toggle()}
    >
      <span aria-hidden="true">{"⌘"}</span>
      {isOverflowed || hint === "" ? (
        <span>{label}</span>
      ) : (
        <span data-dtb-part="cmd-trigger">{hint}</span>
      )}
    </button>
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
}

/** Rendered by the `overlay` slot on every toolbar render; `null` while closed. */
export function CommandMenuOverlay(props: OverlayProps): ReactNode {
  useStyles(props.injectStyles);
  const snapshot = useSnapshot(props.runtime);
  if (!snapshot.open) return null;
  return <Dialog {...props} snapshot={snapshot} />;
}

/**
 * Mounted only while the palette is open, which is what makes focus handling a
 * mount effect: focus moves in on mount and back on unmount, so there is no
 * path that opens without focusing or closes without restoring.
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
      // Restore, but only to something still in the document: an extension's
      // command may well have unmounted whatever was focused.
      if (previous && previous.isConnected && typeof previous.focus === "function") {
        previous.focus();
      }
    };
  }, []);

  // Keep the active row on screen. jsdom has no scrollIntoView, hence the guard.
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
        // An IME uses Escape to cancel a composition. Closing the palette on it
        // would discard the whole query over an abandoned candidate.
        if (event.nativeEvent.isComposing) return;
        event.preventDefault();
        // Core's overflow menu also closes on Escape, from a document-level
        // listener. Without this it would close underneath the palette.
        event.stopPropagation();
        runtime.close();
        return;
      case "ArrowDown":
        event.preventDefault();
        runtime.move(1);
        return;
      case "ArrowUp":
        event.preventDefault();
        runtime.move(-1);
        return;
      case "Home":
        event.preventDefault();
        runtime.setActiveIndex(0);
        return;
      case "End":
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
        // `aria-modal` claims focus is trapped, so trap it. The text field is
        // the only focusable thing in here, so there is nowhere to cycle to.
        event.preventDefault();
        return;
      default:
    }
  };

  const sections = sectionsOf(snapshot.results);
  const active = snapshot.results[snapshot.activeIndex];

  return (
    <>
      <div
        data-dtb-part="cmd-scrim"
        // A right-click reaching for a context menu, or a stylus barrel press,
        // is not a dismissal. `> 0` rather than `!== 0` on purpose: jsdom's
        // synthesized pointer events carry no `button` at all, and an
        // environment that cannot tell us which button it was should still be
        // able to dismiss a dialog.
        onPointerDown={(event) => {
          if (event.button > 0) return;
          runtime.close();
        }}
        aria-hidden="true"
      />
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
            <div data-dtb-part="cmd-empty" role="status">
              {emptyMessage}
            </div>
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
                    <div
                      key={match.command.id}
                      id={optionId(index)}
                      data-dtb-part="cmd-option"
                      data-dtb-command-id={match.command.id}
                      role="option"
                      aria-selected={selected}
                      aria-busy={snapshot.running === match.command.id ? true : undefined}
                      // pointerdown, not click: mousedown inside the dialog
                      // would otherwise blur the input first.
                      onPointerDown={(event) => {
                        event.preventDefault();
                        runtime.setActiveIndex(index);
                        void runtime.run(match.command.id);
                      }}
                      onPointerMove={() => runtime.setActiveIndex(index)}
                    >
                      <span data-dtb-part="cmd-option-label">{match.command.label}</span>
                      {match.command.group === undefined || section.section !== "" ? null : (
                        <span data-dtb-part="cmd-option-group">{match.command.group}</span>
                      )}
                      {match.command.shortcut === undefined ? null : (
                        <kbd data-dtb-part="cmd-option-hint">{match.command.shortcut}</kbd>
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
