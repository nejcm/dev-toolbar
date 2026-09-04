import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Action,
  Banner,
  CopyButton,
  EmptyState,
  Note,
  SearchField,
  Select,
  Tag,
  TextInput,
  useExtensionSurface,
} from "@nejcm/dev-toolbar/kit";
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
      {...(toggleable ? { role: "switch", "aria-checked": on } : {})}
      onClick={toggleable ? onToggle : onOpen}
      title={title}
    >
      <span data-dtb-part="flag-promoted-dot" data-dtb-kind="dot" aria-hidden="true" />
      {view.promotedIcon ? <span aria-hidden="true">{view.promotedIcon}</span> : null}
      <span>{label}</span>
      {view.type === "boolean" ? null : (
        <span data-dtb-part="flag-promoted-value" data-dtb-kind="value">
          {view.effectiveText}
        </span>
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
  styleNonce?: string;
  onToggle(): void;
  onOpen(): void;
}

export function FlagsChip({
  runtime,
  label,
  isOverflowed,
  isPanelOpen,
  injectStyles,
  styleNonce,
  onToggle,
  onOpen,
}: ChipProps): ReactNode {
  const snapshot = useExtensionSurface(runtime.store, injectStyles, ensureFlagsStyles, styleNonce);

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
      {/* Hand-written, not the kit's <Chip>: this chip has no dot, and the kit
          chip always renders one. An extra node here would move the whole
          summary by a dot and a gap. */}
      <span
        data-dtb-part="flag-chip"
        data-dtb-kind="chip"
        data-dtb-overridden={snapshot.overriddenCount > 0 ? "true" : "false"}
      >
        <span data-dtb-part="flag-label" data-dtb-kind="label">
          flags
        </span>
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
      <div data-dtb-part="flag-overflow">
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
      <Note as="span" data-dtb-part="flag-note" data-dtb-role="read-only">
        read-only
      </Note>
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
        <Select
          data-dtb-part="flag-input"
          data-dtb-flag={view.key}
          aria-label={`Override ${view.key}`}
          value={view.masked ? "" : formatValue(view.effective)}
          onChange={(next) => {
            const chosen = view.variants?.find((variant) => formatValue(variant) === next);
            if (chosen !== undefined) commit(chosen);
          }}
        >
          {view.masked ? <option value="">(masked)</option> : null}
          {view.variants.map((variant) => (
            <option key={formatValue(variant)} value={formatValue(variant)}>
              {formatValue(variant)}
            </option>
          ))}
        </Select>
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
      <TextInput
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
        onChange={(next) => {
          setDraft(next);
          setRejected(false);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          tryCommit();
        }}
        onBlur={tryCommit}
      />
      {rejected ? (
        <Tag data-dtb-part="flag-tag" data-dtb-tag="rejected" role="alert">
          not a {view.type}
        </Tag>
      ) : null}
      <ClearButton view={view} runtime={runtime} />
    </>
  );
}

function ClearButton({ view, runtime }: { view: FlagView; runtime: FlagsRuntime }): ReactNode {
  return (
    <Action
      data-dtb-part="flag-action"
      data-dtb-action="clear"
      data-dtb-flag={view.key}
      disabled={!view.overridden}
      title={`Drop the local override on ${view.key} and go back to the application's own value`}
      onClick={() => runtime.clearOverride(view.key)}
    >
      clear
    </Action>
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
      data-dtb-kind="row"
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
          <Tag data-dtb-part="flag-tag" data-dtb-tag="override">
            overridden
          </Tag>
        ) : null}
        {view.applyError ? (
          <Tag data-dtb-part="flag-tag" data-dtb-tag="not-applied" title={view.applyError}>
            {/* Same slot also records a failed clear, where "override not applied" would read backwards. */}
            {view.overridden ? "override not applied" : "clear not applied"}
          </Tag>
        ) : null}
        {view.orphaned ? (
          <Tag
            data-dtb-part="flag-tag"
            data-dtb-tag="orphaned"
            title="Your application still receives this override, but no flag in the current catalogue has this key — usually a renamed or deleted flag."
          >
            no longer in the catalogue
          </Tag>
        ) : null}
        {view.promoted ? (
          <Tag data-dtb-part="flag-tag" data-dtb-tag="promoted">
            promoted
          </Tag>
        ) : null}
        {view.masked ? (
          <Tag
            data-dtb-part="flag-tag"
            data-dtb-tag="masked"
            title="This value was masked before it was rendered or copied."
          >
            masked
          </Tag>
        ) : null}
        {view.expired ? (
          <Tag data-dtb-part="flag-tag" data-dtb-tag="expired">
            expired {view.expiresAt}
          </Tag>
        ) : null}
        {reloadPending ? (
          <Tag data-dtb-part="flag-tag" data-dtb-tag="reload">
            reload required
          </Tag>
        ) : view.reloadBehavior === "live" ? null : (
          <Tag data-dtb-part="flag-tag" data-dtb-tag="reload-behavior">
            {view.reloadBehavior}
          </Tag>
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
            data-dtb-kind="value"
            data-dtb-role="effective"
            data-dtb-overridden={view.overridden ? "true" : "false"}
          >
            {view.effectiveText}
          </span>
        </span>
        {/* App's own value stays visible next to the override, so nobody debugs against a number the server never sent. */}
        <span>
          app{" "}
          <span data-dtb-part="flag-value" data-dtb-kind="value" data-dtb-role="base">
            {view.baseText}
          </span>
        </span>
        <span>
          default{" "}
          <span data-dtb-part="flag-value" data-dtb-kind="value" data-dtb-role="default">
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
  styleNonce?: string;
}

export function FlagsPanel({ runtime, label, injectStyles, styleNonce }: PanelProps): ReactNode {
  const snapshot = useExtensionSurface(runtime.store, injectStyles, ensureFlagsStyles, styleNonce);
  const [query, setQuery] = useState("");

  const visible = useMemo(
    () => snapshot.flags.filter((view) => matchesQuery(view, query)),
    [snapshot.flags, query],
  );
  const pending = new Set(snapshot.reloadPending);
  const failed = Object.keys(snapshot.adapterErrors);

  return (
    <div
      data-dtb-part="flag-panel"
      data-dtb-writable={snapshot.writable ? "true" : "false"}
      aria-label={label}
    >
      <div data-dtb-part="flag-toolbar" data-dtb-kind="toolbar" data-dtb-bleed="">
        <SearchField
          data-dtb-part="flag-search"
          label="Search flags"
          placeholder={`Search ${snapshot.flags.length} flags`}
          value={query}
          onChange={setQuery}
        />
        <Action
          data-dtb-part="flag-action"
          data-dtb-action="clear-all"
          disabled={!snapshot.writable || snapshot.overriddenCount === 0}
          onClick={() => runtime.clearAll()}
          title="Drop every local override and go back to what the application resolves on its own"
        >
          Clear all overrides ({snapshot.overriddenCount})
        </Action>
        <CopyButton
          text={() => runtime.recipeText()}
          statusText={{
            failed: "Clipboard unavailable.",
            ok: `Copied — ${snapshot.maskedCount} value${snapshot.maskedCount === 1 ? "" : "s"} masked.`,
            idle: `Credential-shaped keys and values are masked before anything is copied${snapshot.maskedCount > 0 ? ` (${snapshot.maskedCount} here)` : ""}.`,
          }}
          statusProps={{ "data-dtb-part": "flag-note" }}
          data-dtb-part="flag-action"
          data-dtb-action="copy-recipe"
        >
          Copy recipe
        </CopyButton>
      </div>

      {snapshot.readError ? (
        <Banner data-dtb-part="flag-banner" data-dtb-tone="error" severity="bad" role="alert">
          {snapshot.readError}
        </Banner>
      ) : null}

      {failed.length > 0 ? (
        <Banner data-dtb-part="flag-banner" data-dtb-tone="error" severity="bad" role="alert">
          {failed.length} override{failed.length === 1 ? "" : "s"} could not be applied:{" "}
          {failed.join(", ")}. Those rows are marked; your application did not pick them up.
        </Banner>
      ) : null}

      {pending.size > 0 ? (
        <Banner data-dtb-part="flag-banner" data-dtb-tone="warn" severity="warn" role="status">
          {pending.size} override{pending.size === 1 ? " needs" : "s need"} a reload to take effect:{" "}
          {[...pending].join(", ")}.{" "}
          <Action
            data-dtb-part="flag-action"
            data-dtb-action="reload"
            onClick={() => globalThis.location?.reload?.()}
          >
            Reload
          </Action>{" "}
          <Action
            data-dtb-part="flag-action"
            data-dtb-action="acknowledge"
            onClick={() => runtime.acknowledgeReload()}
          >
            Dismiss
          </Action>
        </Banner>
      ) : null}

      {snapshot.writable ? null : (
        <Note data-dtb-part="flag-note" data-dtb-role="read-only-note">
          Read-only: no <code>onOverride</code> adapter was supplied to <code>flags()</code>, so
          this panel lists and copies but changes nothing.
        </Note>
      )}

      {snapshot.supplied ? null : (
        <EmptyState data-dtb-part="flag-empty">
          <Note data-dtb-part="flag-note">
            No flags were supplied. This extension owns no flag store and integrates no provider —
            pass what your application resolved:{" "}
            <code>{"flags({ flags: () => myFlags, onOverride: (k, v) => …  })"}</code>.
          </Note>
        </EmptyState>
      )}

      <ul data-dtb-part="flag-list" data-dtb-kind="list" data-dtb-bleed="">
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
        <Note data-dtb-part="flag-note" data-dtb-role="escape-hatch" data-dtb-bleed="">
          Overrides persist across reloads in this browser. Clear them all above, or load any page
          with <code>?dtb-flags=reset</code> if an override has broken the app badly enough that you
          cannot reach this panel.
        </Note>
      ) : null}
    </div>
  );
}
