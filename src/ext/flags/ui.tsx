import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { writeClipboardText } from "../../runtime";
import { useExtensionSurface } from "../shared/hooks";
import { ensureFlagsStyles } from "./css";
import { formatValue, matchesQuery, parseValue, severityFor } from "./types";
import type { FlagValue, FlagView } from "./types";
import type { FlagsRuntime } from "./runtime";

/**
 * The rendered surface. [dev-toolbar/ext/flags]
 *
 * Slot functions must be cheap, so they return these components, which
 * subscribe to the extension's own store. Everything rendered comes from the
 * snapshot, already redacted before it's built — no component here has
 * access to a raw flag value.
 */

/* Bar */

/**
 * The promoted flag itself: one control in the bar.
 *
 * A boolean is a `role="switch"` that flips the flag in place — the point of
 * promoting it during a migration. Anything else opens the panel; a bar is
 * no place to edit a string.
 */
function PromotedControl({
  view,
  writable,
  onToggle,
  onOpen,
}: {
  view: FlagView;
  writable: boolean;
  onToggle(): void;
  onOpen(): void;
}): ReactNode {
  const label = view.promotedLabel ?? view.label;
  const on = view.effective === true;
  const toggleable = writable && view.type === "boolean";

  const title = [
    `${view.key} = ${view.effectiveText}`,
    view.overridden
      ? `locally overridden — the app's own value is ${view.baseText}`
      : `from ${view.source}`,
    toggleable ? "click to toggle" : "click to open the flags panel",
    view.reloadBehavior === "live" ? null : `changing it needs a ${view.reloadBehavior}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      data-dtb-part="flag-promoted"
      data-dtb-flag={view.key}
      data-dtb-overridden={view.overridden ? "true" : "false"}
      {...(view.type === "boolean" ? { role: "switch", "aria-checked": on } : {})}
      onClick={toggleable ? onToggle : onOpen}
      title={title}
    >
      <span data-dtb-part="flag-promoted-dot" aria-hidden="true" />
      {view.promotedIcon ? <span aria-hidden="true">{view.promotedIcon}</span> : null}
      <span>{label}</span>
      {view.type === "boolean" ? null : (
        <span data-dtb-part="flag-promoted-value">{view.effectiveText}</span>
      )}
    </button>
  );
}

export interface ChipProps {
  runtime: FlagsRuntime;
  label: string;
  isOverflowed: boolean;
  isPanelOpen: boolean;
  injectStyles: boolean;
  onToggle(): void;
  onOpen(): void;
}

export function FlagsChip({
  runtime,
  label,
  isOverflowed,
  isPanelOpen,
  injectStyles,
  onToggle,
  onOpen,
}: ChipProps): ReactNode {
  const snapshot = useExtensionSurface(runtime.store, injectStyles, ensureFlagsStyles);

  const count = snapshot.supplied ? snapshot.flags.length : 0;
  const summary =
    snapshot.overriddenCount > 0 ? `${snapshot.overriddenCount} overridden` : `${count}`;
  const title = snapshot.supplied
    ? `Feature flags: ${count} · ${snapshot.overriddenCount} locally overridden${snapshot.writable ? "" : " · read-only"}`
    : "Feature flags: none supplied to flags()";

  const trigger = (
    <button
      type="button"
      data-dtb-part={isOverflowed ? "flag-overflow-trigger" : "trigger"}
      aria-expanded={isPanelOpen}
      aria-label={label}
      onClick={onToggle}
      title={title}
    >
      <span
        data-dtb-part="flag-chip"
        data-dtb-overridden={snapshot.overriddenCount > 0 ? "true" : "false"}
      >
        <span data-dtb-part="flag-label">flags</span>
        <span data-dtb-part="flag-count">{summary}</span>
      </span>
    </button>
  );

  // The shell collapses whole extensions, not parts of them, so a collapsed
  // `/ext/flags` takes its promoted flag with it. Rendered here too, as the
  // same working switch, so collapsing doesn't cost the capability.
  const promoted = snapshot.promoted.map((view) => (
    <PromotedControl
      key={view.key}
      view={view}
      writable={snapshot.writable}
      onToggle={() => runtime.toggle(view.key)}
      onOpen={onOpen}
    />
  ));

  if (isOverflowed) {
    return (
      <div data-dtb-part="flag-overflow" aria-label={label}>
        {promoted}
        {trigger}
      </div>
    );
  }

  return (
    <>
      {promoted}
      {trigger}
    </>
  );
}

/* Panel */

function Editor({
  view,
  writable,
  runtime,
}: {
  view: FlagView;
  writable: boolean;
  runtime: FlagsRuntime;
}): ReactNode {
  // Uncontrolled between commits: the store republishes while you type, and
  // a controlled input fed from it would fight the caret.
  const [draft, setDraft] = useState("");
  const [rejected, setRejected] = useState(false);

  if (!writable) {
    return (
      <span data-dtb-part="flag-note" data-dtb-role="read-only">
        read-only
      </span>
    );
  }

  const commit = (value: FlagValue) => runtime.setOverride(view.key, value);

  // An orphan has no definition to edit against — only an override to remove.
  if (view.orphaned) {
    return <ClearButton view={view} runtime={runtime} />;
  }

  if (view.type === "boolean") {
    return (
      <>
        <button
          type="button"
          role="switch"
          aria-checked={view.effective === true}
          aria-label={`Toggle ${view.key}`}
          data-dtb-part="flag-switch"
          data-dtb-flag={view.key}
          onClick={() => runtime.toggle(view.key)}
        >
          {view.effectiveText}
        </button>
        <ClearButton view={view} runtime={runtime} />
      </>
    );
  }

  if (view.type === "variant" && view.variants && view.variants.length > 0) {
    return (
      <>
        <select
          data-dtb-part="flag-input"
          data-dtb-flag={view.key}
          aria-label={`Override ${view.key}`}
          value={view.masked ? "" : formatValue(view.effective)}
          onChange={(event) => {
            const chosen = view.variants?.find(
              (variant) => formatValue(variant) === event.target.value,
            );
            if (chosen !== undefined) commit(chosen);
          }}
        >
          {view.masked ? <option value="">(masked)</option> : null}
          {view.variants.map((variant) => (
            <option key={formatValue(variant)} value={formatValue(variant)}>
              {formatValue(variant)}
            </option>
          ))}
        </select>
        <ClearButton view={view} runtime={runtime} />
      </>
    );
  }

  // A refused edit keeps the draft so it can be fixed, rather than coercing
  // ("abc" -> `0`) and applying a value nobody typed.
  const tryCommit = () => {
    if (draft === "") return;
    const parsed = parseValue(view.type, draft);
    if (parsed === undefined) {
      setRejected(true);
      return;
    }
    setRejected(false);
    commit(parsed);
    setDraft("");
  };

  return (
    <>
      <input
        data-dtb-part="flag-input"
        data-dtb-flag={view.key}
        aria-label={`Override ${view.key}`}
        aria-invalid={rejected}
        data-dtb-invalid={rejected ? "true" : "false"}
        // `text` with a numeric keypad hint, not `type="number"`: a number
        // input silently discards unparseable text (e.g. "1e" becomes "",
        // and `Number("")` is `0`), so we parse it ourselves and let the row
        // say no instead of silently pinning the flag to zero.
        type="text"
        {...(view.type === "number" ? { inputMode: "decimal" as const } : {})}
        // A masked value never round-trips through the editor — that would be
        // the one place the redacted snapshot leaked back out.
        placeholder={view.masked ? "masked — type a new value" : view.effectiveText}
        title={rejected ? `Not a ${view.type} — nothing was applied.` : `Override ${view.key}`}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setRejected(false);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          tryCommit();
        }}
        onBlur={tryCommit}
      />
      {rejected ? (
        <span data-dtb-part="flag-tag" data-dtb-tag="rejected" role="alert">
          not a {view.type}
        </span>
      ) : null}
      <ClearButton view={view} runtime={runtime} />
    </>
  );
}

function ClearButton({ view, runtime }: { view: FlagView; runtime: FlagsRuntime }): ReactNode {
  return (
    <button
      type="button"
      data-dtb-part="flag-action"
      data-dtb-action="clear"
      data-dtb-flag={view.key}
      disabled={!view.overridden}
      title={`Drop the local override on ${view.key} and go back to the application's own value`}
      onClick={() => runtime.clearOverride(view.key)}
    >
      clear
    </button>
  );
}

function Row({
  view,
  writable,
  runtime,
  reloadPending,
}: {
  view: FlagView;
  writable: boolean;
  runtime: FlagsRuntime;
  reloadPending: boolean;
}): ReactNode {
  return (
    <li
      data-dtb-part="flag-row"
      data-dtb-flag={view.key}
      data-dtb-overridden={view.overridden ? "true" : "false"}
      data-dtb-orphaned={view.orphaned ? "true" : "false"}
      data-dtb-severity={severityFor(view)}
      data-dtb-type={view.type}
      data-dtb-source={view.source}
    >
      <div data-dtb-part="flag-name">
        <span>{view.label}</span>
        <code data-dtb-part="flag-key">{view.key}</code>
        {view.overridden ? (
          <span data-dtb-part="flag-tag" data-dtb-tag="override">
            overridden
          </span>
        ) : null}
        {view.applyError ? (
          <span data-dtb-part="flag-tag" data-dtb-tag="not-applied" title={view.applyError}>
            {/* Same slot also records a failed clear, where "override not applied" would read backwards. */}
            {view.overridden ? "override not applied" : "clear not applied"}
          </span>
        ) : null}
        {view.orphaned ? (
          <span
            data-dtb-part="flag-tag"
            data-dtb-tag="orphaned"
            title="Your application still receives this override, but no flag in the current catalogue has this key — usually a renamed or deleted flag."
          >
            no longer in the catalogue
          </span>
        ) : null}
        {view.promoted ? (
          <span data-dtb-part="flag-tag" data-dtb-tag="promoted">
            promoted
          </span>
        ) : null}
        {view.masked ? (
          <span
            data-dtb-part="flag-tag"
            data-dtb-tag="masked"
            title="This value was masked before it was rendered or copied."
          >
            masked
          </span>
        ) : null}
        {view.expired ? (
          <span data-dtb-part="flag-tag" data-dtb-tag="expired">
            expired {view.expiresAt}
          </span>
        ) : null}
        {reloadPending ? (
          <span data-dtb-part="flag-tag" data-dtb-tag="reload">
            reload required
          </span>
        ) : view.reloadBehavior === "live" ? null : (
          <span data-dtb-part="flag-tag" data-dtb-tag="reload-behavior">
            {view.reloadBehavior}
          </span>
        )}
      </div>

      <div data-dtb-part="flag-editor">
        <Editor view={view} writable={writable} runtime={runtime} />
      </div>

      <div data-dtb-part="flag-values">
        <span>
          now{" "}
          <span
            data-dtb-part="flag-value"
            data-dtb-role="effective"
            data-dtb-overridden={view.overridden ? "true" : "false"}
          >
            {view.effectiveText}
          </span>
        </span>
        {/* App's own value stays visible next to the override, so nobody debugs against a number the server never sent. */}
        <span>
          app{" "}
          <span data-dtb-part="flag-value" data-dtb-role="base">
            {view.baseText}
          </span>
        </span>
        <span>
          default{" "}
          <span data-dtb-part="flag-value" data-dtb-role="default">
            {view.defaultText}
          </span>
        </span>
        <span data-dtb-part="flag-source">source {view.source}</span>
      </div>

      {view.description || view.owner || view.projectUrl ? (
        <p data-dtb-part="flag-meta">
          {view.description}
          {view.owner ? ` · owner ${view.owner}` : ""}
          {view.projectUrl ? (
            <>
              {" · "}
              <a href={view.projectUrl} target="_blank" rel="noreferrer">
                project
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </li>
  );
}

export interface PanelProps {
  runtime: FlagsRuntime;
  label: string;
  injectStyles: boolean;
}

export function FlagsPanel({ runtime, label, injectStyles }: PanelProps): ReactNode {
  const snapshot = useExtensionSurface(runtime.store, injectStyles, ensureFlagsStyles);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");

  const visible = useMemo(
    () => snapshot.flags.filter((view) => matchesQuery(view, query)),
    [snapshot.flags, query],
  );
  const pending = new Set(snapshot.reloadPending);
  const failed = Object.keys(snapshot.adapterErrors);

  // `/runtime`'s shared writer: a missing clipboard API and a rejected write
  // are the same answer to this panel, so no need to hand-roll it here.
  const copy = (text: string) => {
    void writeClipboardText(text).then((ok) => setCopied(ok ? "ok" : "failed"));
  };

  return (
    <div
      data-dtb-part="flag-panel"
      data-dtb-writable={snapshot.writable ? "true" : "false"}
      aria-label={label}
    >
      <div data-dtb-part="flag-toolbar">
        <input
          data-dtb-part="flag-search"
          type="search"
          aria-label="Search flags"
          placeholder={`Search ${snapshot.flags.length} flags`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          type="button"
          data-dtb-part="flag-action"
          data-dtb-action="clear-all"
          disabled={!snapshot.writable || snapshot.overriddenCount === 0}
          onClick={() => runtime.clearAll()}
          title="Drop every local override and go back to what the application resolves on its own"
        >
          Clear all overrides ({snapshot.overriddenCount})
        </button>
        <button
          type="button"
          data-dtb-part="flag-action"
          data-dtb-action="copy-recipe"
          onClick={() => copy(runtime.recipeText())}
        >
          Copy recipe
        </button>
        <span data-dtb-part="flag-note" role="status">
          {copied === "failed"
            ? "Clipboard unavailable."
            : copied === "ok"
              ? `Copied — ${snapshot.maskedCount} value${snapshot.maskedCount === 1 ? "" : "s"} masked.`
              : `Credential-shaped keys and values are masked before anything is copied${snapshot.maskedCount > 0 ? ` (${snapshot.maskedCount} here)` : ""}.`}
        </span>
      </div>

      {snapshot.readError ? (
        <p data-dtb-part="flag-banner" data-dtb-tone="error" role="alert">
          {snapshot.readError}
        </p>
      ) : null}

      {failed.length > 0 ? (
        <p data-dtb-part="flag-banner" data-dtb-tone="error" role="alert">
          {failed.length} override{failed.length === 1 ? "" : "s"} could not be applied:{" "}
          {failed.join(", ")}. Those rows are marked; your application did not pick them up.
        </p>
      ) : null}

      {pending.size > 0 ? (
        <p data-dtb-part="flag-banner" data-dtb-tone="warn" role="status">
          {pending.size} override{pending.size === 1 ? " needs" : "s need"} a reload to take effect:{" "}
          {[...pending].join(", ")}.{" "}
          <button
            type="button"
            data-dtb-part="flag-action"
            data-dtb-action="reload"
            onClick={() => globalThis.location?.reload?.()}
          >
            Reload
          </button>{" "}
          <button
            type="button"
            data-dtb-part="flag-action"
            data-dtb-action="acknowledge"
            onClick={() => runtime.acknowledgeReload()}
          >
            Dismiss
          </button>
        </p>
      ) : null}

      {snapshot.writable ? null : (
        <p data-dtb-part="flag-note" data-dtb-role="read-only-note">
          Read-only: no <code>onOverride</code> adapter was supplied to <code>flags()</code>, so
          this panel lists and copies but changes nothing.
        </p>
      )}

      {snapshot.supplied ? null : (
        <div data-dtb-part="flag-empty">
          <p data-dtb-part="flag-note">
            No flags were supplied. This extension owns no flag store and integrates no provider —
            pass what your application resolved:{" "}
            <code>{"flags({ flags: () => myFlags, onOverride: (k, v) => …  })"}</code>.
          </p>
        </div>
      )}

      <ul data-dtb-part="flag-list">
        {visible.map((view) => (
          <Row
            key={view.key}
            view={view}
            writable={snapshot.writable}
            runtime={runtime}
            reloadPending={pending.has(view.key)}
          />
        ))}
      </ul>

      {snapshot.writable ? (
        <p data-dtb-part="flag-note" data-dtb-role="escape-hatch">
          Overrides persist across reloads in this browser. Clear them all above, or load any page
          with <code>?dtb-flags=reset</code> if an override has broken the app badly enough that you
          cannot reach this panel.
        </p>
      ) : null}
    </div>
  );
}
