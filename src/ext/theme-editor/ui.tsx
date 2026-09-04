import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { writeClipboardText } from "../../runtime";
import { useExtensionSurface } from "@nejcm/dev-toolbar/kit";
import { ensureThemeEditorStyles } from "./css";
import {
  describeRefusal,
  describeValueRefusal,
  isHexColor,
  matchesQuery,
  severityFor,
  toColorInputValue,
} from "./types";
import type { TokenView } from "./types";
import type { ThemeEditorRuntime } from "./runtime";

/**
 * The rendered surface. [dev-toolbar/ext/theme-editor]
 *
 * Slot functions must be cheap, so they return these components, which
 * subscribe to the extension's own store. Everything rendered comes from the
 * snapshot, already redacted — no component here has access to a raw token
 * value.
 */

/* -------------------------------------------------------------------------- */
/* Bar                                                                         */
/* -------------------------------------------------------------------------- */

export interface ChipProps {
  runtime: ThemeEditorRuntime;
  label: string;
  isOverflowed: boolean;
  isPanelOpen: boolean;
  injectStyles: boolean;
  styleNonce?: string;
  onToggle(): void;
}

export function ThemeChip({
  runtime,
  label,
  isOverflowed,
  isPanelOpen,
  injectStyles,
  styleNonce,
  onToggle,
}: ChipProps): ReactNode {
  const snapshot = useExtensionSurface(
    runtime.store,
    injectStyles,
    ensureThemeEditorStyles,
    styleNonce,
  );

  const edited = snapshot.overriddenCount > 0;
  const summary = !snapshot.preview
    ? "paused"
    : edited
      ? `${snapshot.overriddenCount} edited`
      : String(snapshot.tokens.length);

  const title = snapshot.supplied
    ? [
        `Design tokens: ${snapshot.tokens.length}`,
        `${snapshot.overriddenCount} edited locally`,
        snapshot.preview ? null : "preview paused — the app is showing its own values",
        snapshot.writable ? null : `nothing matches the "${snapshot.surface.id}" surface`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Design tokens: none supplied to themeEditor()";
  const accessibleLabel = edited ? `${label}, ${snapshot.overriddenCount} edited` : label;

  return (
    <button
      type="button"
      data-dtb-part={isOverflowed ? "thm-overflow-trigger" : "trigger"}
      aria-expanded={isPanelOpen}
      aria-label={accessibleLabel}
      onClick={onToggle}
      title={title}
    >
      <span
        data-dtb-part="thm-chip"
        data-dtb-edited={edited ? "true" : "false"}
        data-dtb-preview={snapshot.preview ? "true" : "false"}
      >
        <span data-dtb-part="thm-dot" aria-hidden="true" />
        <span>theme</span>
        <span data-dtb-part="thm-count">{summary}</span>
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The native colour input, holding its own draft.
 *
 * A colour input fires `change` for every step of a drag, and committing each
 * one wrote, persisted and published a hundred overrides for one colour
 * choice. The draft commits on blur, the way the text field's commits on
 * Enter. Its own component so that a `key` can throw the draft away — see the
 * call site.
 */
function ColourPicker({
  view,
  writable,
  commit,
}: {
  view: TokenView;
  writable: boolean;
  commit: (raw: string) => void;
}): ReactNode {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="color"
      data-dtb-part="thm-color"
      data-dtb-token={view.name}
      aria-label={`Pick a colour for ${view.name}`}
      value={draft ?? toColorInputValue(view.effective as string)}
      disabled={!writable}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft === null) return;
        commit(draft);
        setDraft(null);
      }}
    />
  );
}

function Editor({
  view,
  runtime,
  writable,
}: {
  view: TokenView;
  runtime: ThemeEditorRuntime;
  writable: boolean;
}): ReactNode {
  // Uncontrolled between commits on purpose: the store republishes while you
  // type, and a controlled input fed from it would fight the caret.
  const [draft, setDraft] = useState("");
  const [rejected, setRejected] = useState<string | null>(null);

  const clear = (
    <button
      type="button"
      data-dtb-part="thm-action"
      data-dtb-action="clear"
      data-dtb-token={view.name}
      disabled={!view.overridden}
      title={`Drop the local edit on ${view.name} and go back to the application's own value`}
      onClick={() => runtime.clearOverride(view.name)}
    >
      reset
    </button>
  );

  if (view.refusal !== null) {
    return (
      <>
        <span data-dtb-part="thm-tag" data-dtb-tag="refused" title={describeRefusal(view.refusal)}>
          {view.refusal === "reserved" ? "reserved name" : "unusable name"}
        </span>
        {/* No clear button: a refused row can never be overridden — every door
            into the override map (setOverride, sanitize, vetStored) already
            drops a refused name. */}
      </>
    );
  }

  const commit = (raw: string) => {
    if (raw.trim() === "") return;
    const refusal = runtime.setOverride(view.name, raw);
    if (refusal !== null) {
      setRejected(describeValueRefusal(refusal, view.type));
      return;
    }
    setRejected(null);
    setDraft("");
  };

  if (view.orphaned) {
    // Nothing to edit against — the catalogue does not declare it any more —
    // but the page is still receiving it, so there is something to remove.
    return clear;
  }

  return (
    <>
      {view.type === "color" && !view.masked && isHexColor(view.effective) ? (
        // Keyed on `writable`, which is how the held draft is discarded when
        // the surface goes away: Chrome fires no blur on a focused element
        // that *becomes* disabled, so the draft would otherwise sit there
        // showing a colour nothing on the page is wearing. Remounting is the
        // reset — no effect, and nothing to keep in sync.
        <ColourPicker
          key={writable ? "writable" : "locked"}
          view={view}
          writable={writable}
          commit={commit}
        />
      ) : null}
      {view.type === "color" && !view.masked && view.effective !== null ? (
        <span
          data-dtb-part="thm-swatch"
          aria-hidden="true"
          // The one inline style in this file, unavoidably: a swatch paints an
          // arbitrary value no stylesheet can enumerate. Our own element,
          // inside the toolbar root — never a host node.
          style={{ background: view.effective }}
        />
      ) : null}
      <input
        type="text"
        data-dtb-part="thm-input"
        data-dtb-token={view.name}
        aria-label={`Edit ${view.name}`}
        aria-invalid={rejected !== null}
        data-dtb-invalid={rejected === null ? "false" : "true"}
        disabled={!writable}
        // A masked value never round-trips through the editor: seeding the
        // input with it is the one place a redacted value could leak back
        // onto the screen and out again through the next copy.
        placeholder={view.masked ? "masked — type a new value" : (view.effectiveText ?? "")}
        title={rejected ?? `Edit ${view.name}`}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setRejected(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit(draft);
        }}
        onBlur={() => commit(draft)}
      />
      {rejected === null ? null : (
        <span data-dtb-part="thm-tag" data-dtb-tag="rejected" role="alert">
          {rejected}
        </span>
      )}
      {clear}
    </>
  );
}

function Row({
  view,
  runtime,
  writable,
}: {
  view: TokenView;
  runtime: ThemeEditorRuntime;
  writable: boolean;
}): ReactNode {
  return (
    <li
      data-dtb-part="thm-row"
      data-dtb-token={view.name}
      data-dtb-overridden={view.overridden ? "true" : "false"}
      data-dtb-severity={severityFor(view)}
      data-dtb-type={view.type}
    >
      <div data-dtb-part="thm-name">
        <span>{view.label}</span>
        <code data-dtb-part="thm-token">{view.name}</code>
        {view.overridden ? (
          <span data-dtb-part="thm-tag" data-dtb-tag="edited">
            edited
          </span>
        ) : null}
        {view.applyError ? (
          <span data-dtb-part="thm-tag" data-dtb-tag="not-applied" title={view.applyError}>
            not applied
          </span>
        ) : null}
        {view.orphaned ? (
          <span
            data-dtb-part="thm-tag"
            data-dtb-tag="orphaned"
            title="Your page is still receiving this edit, but the token catalogue no longer declares it — usually a renamed or deleted token."
          >
            no longer declared
          </span>
        ) : null}
        {view.masked ? (
          <span
            data-dtb-part="thm-tag"
            data-dtb-tag="masked"
            title="This value was masked before it was rendered or exported."
          >
            masked
          </span>
        ) : null}
      </div>

      <div data-dtb-part="thm-editor">
        <Editor view={view} runtime={runtime} writable={writable} />
      </div>

      {/* Before/after, per row: now, the app's own value, and the design
          system's default, side by side. */}
      <div data-dtb-part="thm-values">
        <span>
          now{" "}
          <span
            data-dtb-part="thm-value"
            data-dtb-role="effective"
            data-dtb-overridden={view.overridden ? "true" : "false"}
          >
            {view.effectiveText}
          </span>
        </span>
        <span>
          app{" "}
          <span data-dtb-part="thm-value" data-dtb-role="base">
            {view.baseText}
          </span>
        </span>
        <span>
          default{" "}
          <span data-dtb-part="thm-value" data-dtb-role="default">
            {view.defaultText}
          </span>
        </span>
      </div>

      {view.description ? <p data-dtb-part="thm-meta">{view.description}</p> : null}
    </li>
  );
}

type ExportFormat = "css" | "json" | "figma";

const FORMAT_LABEL: Readonly<Record<ExportFormat, string>> = {
  css: "CSS variables",
  json: "Recipe JSON",
  figma: "Figma / design-tokens JSON",
};

export interface PanelProps {
  runtime: ThemeEditorRuntime;
  label: string;
  injectStyles: boolean;
  styleNonce?: string;
}

export function ThemePanel({ runtime, label, injectStyles, styleNonce }: PanelProps): ReactNode {
  const snapshot = useExtensionSurface(
    runtime.store,
    injectStyles,
    ensureThemeEditorStyles,
    styleNonce,
  );
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState<ExportFormat>("css");
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");
  const [importText, setImportText] = useState("");

  const visible = useMemo(
    () =>
      snapshot.groups
        .map((group) => ({
          name: group.name,
          tokens: group.tokens.filter((view) => matchesQuery(view, query)),
        }))
        .filter((group) => group.tokens.length > 0),
    [snapshot.groups, query],
  );

  // Every export re-serialises the whole catalogue, and this component
  // re-renders on each keystroke in the search and import boxes. `revision`
  // advances on publish and only on publish, so it is a complete key for
  // anything an export can read.
  const output = useMemo(
    () =>
      format === "css"
        ? runtime.cssText()
        : format === "json"
          ? runtime.recipeText()
          : runtime.figmaText(),
    // `revision` is not read in the body — that is the point. It is the
    // publish counter, and a publish is the only thing that can change what
    // these three helpers return, so it stands in for state the linter cannot
    // see inside the runtime closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runtime, snapshot.revision, format],
  );

  const failed = Object.keys(snapshot.applyErrors);
  const presets = runtime.presets();

  const copy = (text: string) => {
    void writeClipboardText(text).then((ok) => setCopied(ok ? "ok" : "failed"));
  };

  return (
    <div
      data-dtb-part="thm-panel"
      data-dtb-writable={snapshot.writable ? "true" : "false"}
      data-dtb-preview={snapshot.preview ? "true" : "false"}
      aria-label={label}
    >
      <div data-dtb-part="thm-toolbar">
        <input
          data-dtb-part="thm-search"
          type="search"
          aria-label="Search tokens"
          placeholder={`Search ${snapshot.tokens.length} tokens`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        {snapshot.surfaces.length > 1 ? (
          <label data-dtb-part="thm-note">
            surface{" "}
            <select
              data-dtb-part="thm-select"
              data-dtb-role="surface"
              aria-label="Surface the edits apply to"
              value={snapshot.surface.id}
              onChange={(event) => runtime.selectSurface(event.target.value)}
            >
              {snapshot.surfaces.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label ?? entry.id}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <button
          type="button"
          data-dtb-part="thm-action"
          data-dtb-action="preview"
          data-dtb-on={snapshot.preview ? "true" : "false"}
          aria-pressed={snapshot.preview}
          title="Hold the edits back without discarding them, so you can see the application's own values. Press again to put them back."
          onClick={() => runtime.togglePreview()}
        >
          {snapshot.preview ? "Preview: on" : "Preview: off (before)"}
        </button>

        <button
          type="button"
          data-dtb-part="thm-action"
          data-dtb-action="reset-all"
          disabled={snapshot.overriddenCount === 0}
          title="Remove every edit and restore the surface exactly as it was, including the style attribute this extension created."
          onClick={() => runtime.resetAll()}
        >
          Reset everything ({snapshot.overriddenCount})
        </button>

        {snapshot.mode === null ? null : (
          <button
            type="button"
            data-dtb-part="thm-action"
            data-dtb-action="mode"
            disabled={!snapshot.modeWritable}
            title={
              snapshot.modeWritable
                ? "Flip the application's own colour mode through the adapter you supplied."
                : "Read-only: themeEditor({ mode }) had no set(), so the mode is reported rather than driven."
            }
            onClick={() => runtime.setMode(snapshot.mode === "dark" ? "light" : "dark")}
          >
            mode: {snapshot.mode}
          </button>
        )}
      </div>

      {snapshot.readError ? (
        <p data-dtb-part="thm-banner" data-dtb-tone="error" role="alert">
          {snapshot.readError}
        </p>
      ) : null}

      {failed.length > 0 ? (
        <p data-dtb-part="thm-banner" data-dtb-tone="error" role="alert">
          {failed.length} edit{failed.length === 1 ? "" : "s"} could not be applied:{" "}
          {failed.join(", ")}. Those rows are marked; the page did not take them.
        </p>
      ) : null}

      {snapshot.writable || snapshot.overriddenCount > 0 ? null : (
        <p data-dtb-part="thm-banner" data-dtb-tone="warn" role="status">
          Nothing on this page matches the <code>{snapshot.surface.selector}</code> surface, so
          edits are stored but not shown.
        </p>
      )}

      {/* The surface went away while edits were held on it. They are kept and
          will be re-applied when it comes back, but nothing on the page is
          wearing them right now — and the rows carry no per-token error,
          deliberately, because a surface missing for one render would
          otherwise mark every row failed. */}
      {!snapshot.writable && snapshot.overriddenCount > 0 ? (
        <p data-dtb-part="thm-banner" data-dtb-tone="warn" data-dtb-detached="true" role="status">
          Nothing matches the <code>{snapshot.surface.selector}</code> surface any more, so{" "}
          {snapshot.overriddenCount} edit{snapshot.overriddenCount === 1 ? " is" : "s are"} no
          longer on the page. They are kept, and go back on when it returns.
        </p>
      ) : null}

      {snapshot.notice ? (
        <p data-dtb-part="thm-banner" data-dtb-tone="info" role="status">
          {snapshot.notice}
        </p>
      ) : null}

      {snapshot.supplied ? null : (
        <p data-dtb-part="thm-note">
          No tokens were supplied. This extension owns no design system and generates no palette —
          pass the tokens your application publishes:{" "}
          <code>{'themeEditor({ tokens: [{ name: "--brand-500", type: "color" }] })'}</code>.
        </p>
      )}

      {visible.map((group) => (
        <section key={group.name}>
          <h3 data-dtb-part="thm-group-name" data-dtb-legend="">
            {group.name}
          </h3>
          <ul data-dtb-part="thm-list">
            {group.tokens.map((view) => (
              <Row key={view.name} view={view} runtime={runtime} writable={snapshot.writable} />
            ))}
          </ul>
        </section>
      ))}

      {presets.length > 0 ? (
        <div data-dtb-part="thm-actions" data-dtb-role="presets">
          <span data-dtb-part="thm-note">presets</span>
          {presets.map((preset) => (
            <button
              key={preset.name}
              type="button"
              data-dtb-part="thm-action"
              data-dtb-action="preset"
              data-dtb-preset={preset.name}
              onClick={() => runtime.applyPreset(preset.name)}
            >
              {preset.name}
            </button>
          ))}
        </div>
      ) : null}

      {/* The panel's largest element is the payload itself — the exact string
          the buttons copy, not a summary of it. */}
      <div data-dtb-part="thm-actions" data-dtb-role="export">
        <label data-dtb-part="thm-note">
          export{" "}
          <select
            data-dtb-part="thm-select"
            data-dtb-role="format"
            aria-label="Export format"
            value={format}
            onChange={(event) => setFormat(event.target.value as ExportFormat)}
          >
            {(Object.keys(FORMAT_LABEL) as ExportFormat[]).map((key) => (
              <option key={key} value={key}>
                {FORMAT_LABEL[key]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          data-dtb-part="thm-action"
          data-dtb-action="copy"
          onClick={() => copy(output)}
        >
          Copy
        </button>
        <button
          type="button"
          data-dtb-part="thm-action"
          data-dtb-action="copy-link"
          title="A link to this page carrying the recipe. Masked values are left out of it — a document a machine applies must not contain a value that is not a value."
          onClick={() => {
            const link = runtime.shareLink();
            if (link === null) setCopied("failed");
            else copy(link);
          }}
        >
          Copy share link
        </button>
        <span data-dtb-part="thm-note" role="status">
          {copied === "failed"
            ? "Clipboard unavailable — select the text below instead."
            : copied === "ok"
              ? `Copied — ${snapshot.maskedCount} value${snapshot.maskedCount === 1 ? "" : "s"} masked.`
              : `Credential-shaped values are masked before anything leaves this panel${snapshot.maskedCount > 0 ? ` (${snapshot.maskedCount} here)` : ""}.`}
        </span>
      </div>

      <pre data-dtb-part="thm-output" data-dtb-format={format}>
        {output}
      </pre>

      <div data-dtb-part="thm-actions" data-dtb-role="import">
        <textarea
          data-dtb-part="thm-import"
          aria-label="Paste a recipe to import"
          placeholder='Paste a recipe: { "schemaVersion": 1, "overrides": { "--brand-500": "#f00" } }'
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
        />
        <button
          type="button"
          data-dtb-part="thm-action"
          data-dtb-action="import"
          disabled={importText.trim() === ""}
          onClick={() => runtime.importRecipe(importText)}
        >
          Import
        </button>
      </div>

      {/* What was left out, and what leaving it out costs, stated next to the
          thing itself. */}
      <p data-dtb-part="thm-note" data-dtb-role="limits">
        Edits are written as inline custom properties on <code>{snapshot.surface.selector}</code>,
        so an application rule marked <code>!important</code> still wins and this panel will show an
        edit the page is not honouring. Nothing here generates a palette from a base colour: this
        editor changes the tokens your design system already publishes, and a generated scale
        belongs in a <code>preset</code> your code computes. The Figma export is the W3C
        design-tokens shape — the deterministic, versioned half of §3H's pipeline; no plugin ships
        here. Names beginning <code>--dtb-</code> or <code>--dev-toolbar</code> are never written,
        so an edit cannot restyle this toolbar; restyle the bar from your own stylesheet instead.
      </p>

      {snapshot.overriddenCount > 0 ? (
        <p data-dtb-part="thm-note" data-dtb-role="escape-hatch">
          Edits persist across reloads in this browser. Reset them above, or load any page with{" "}
          <code>?dtb-theme=reset</code> if an edit has made the app unreadable enough that you
          cannot reach this panel.
        </p>
      ) : null}
    </div>
  );
}
