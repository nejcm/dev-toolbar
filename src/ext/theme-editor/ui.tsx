import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Action,
  Banner,
  Chip,
  Field,
  Glyph,
  Note,
  SearchField,
  Select,
  Tag,
  TextInput,
  renderCompact,
  resolveAccessibleName,
  resolveCompactControl,
  useCopyStatus,
  useExtensionSurface,
} from "@nejcm/dev-toolbar/kit";
import type {
  CompactDefaults,
  CompactParts,
  ResolvedCompactPresentation,
} from "@nejcm/dev-toolbar/kit";
import { ensureThemeEditorStyles } from "./css";
import {
  describeRefusal,
  describeValueRefusal,
  isHexColor,
  matchesQuery,
  severityFor,
  toColorInputValue,
} from "./types";
import type { ThemeEditorBarView, TokenView } from "./types";
import type { ThemeEditorRuntime } from "./runtime";

/**
 * The rendered surface. [dev-toolbar/ext/theme-editor]
 *
 * Slot functions must be cheap, so they return these components, which
 * subscribe to the extension's own store. Everything rendered comes from the
 * snapshot, already redacted — no component here has access to a raw token
 * value.
 *
 * `presentation` arrives already resolved and is read through `/kit`'s
 * `resolveCompactControl` and `renderCompact`, so the `hasIcon` guard, the
 * `"default"` fallback, the `CompactRenderContext` and the `undefined`
 * fall-through live in one place for all nine extensions rather than nine.
 * What stays here is the DOM: a consumer's `render` supplies the children of
 * the chip carrying `data-dtb-edited` and `data-dtb-preview`, and `Chip`
 * paints the dot before them, so no callback can cost the control its state
 * attributes or its dot — which matters more here than anywhere else in Group
 * A, because this chip colours its own dot from those two attributes rather
 * than from a `severity`
 * (`plans/bar-presentation-icons-v1.md`, invariant 1).
 */

/* -------------------------------------------------------------------------- */
/* Bar                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The short word the bar paints, and the reason there is one.
 *
 * `label` is the extension's identity — the panel's accessible name, the
 * trigger's `aria-label` — and the chip has always painted this lowercase word
 * instead, in the bar *and* in the `⋮` row. Presets operate on *this* word;
 * `label` stays the accessible-name identity, which is what makes the text
 * axis `"none" | "short" | "full"` rather than a boolean
 * (`plans/bar-presentation-icons-v1.md`, "Which text").
 */
const SHORT_LABEL = "theme";

/**
 * Today's tree, expressed as parts.
 *
 * `resolveCompactControl` answers the preset's parts, or these when the preset
 * is `"default"` — handed in rather than known to kit, because `"default"`
 * means *whatever this extension renders today* and that differs across the
 * nine. Like `/ext/environment` and unlike the other three Group A chips, this
 * one paints the same short word in both places, so `overflow.text` is
 * `"short"`. A preset still forces `"full"` in the menu; only `"default"` is
 * pinned to what shipped.
 */
const DEFAULTS: CompactDefaults = {
  bar: { icon: false, text: "short", value: true },
  overflow: { icon: false, text: "short", value: true },
};

/**
 * The icon and the text.
 *
 * These are the chip's *children* rather than `Chip`'s `icon` / `label` /
 * `value` slots — the same call the rest of Group A and `/ext/metrics` made,
 * and the reason is recorded in
 * `docs/adr/ADR-004-per-extension-bar-presentation.md`. `Chip` renders its
 * children straight after the dot, in the slots' own position, so nothing
 * about today's output moves.
 */
function iconAndText(
  label: string,
  { icon: paintIcon, text }: CompactParts,
  icon: ReactNode,
): ReactNode {
  return (
    <>
      {paintIcon ? <Glyph data-dtb-part="thm-icon">{icon}</Glyph> : null}
      {/* A bare `<span>`, which is what `Chip`'s `label` slot wrote before this
          moved into the chip's children — no `data-dtb-part`, because adding
          one would change today's bytes. */}
      {text === "none" ? null : <span>{text === "full" ? label : SHORT_LABEL}</span>}
    </>
  );
}

export interface ChipProps {
  runtime: ThemeEditorRuntime;
  label: string;
  /** Already through `resolvePresentation`, in the factory closure. */
  presentation: ResolvedCompactPresentation<ThemeEditorBarView>;
  isOverflowed: boolean;
  isPanelOpen: boolean;
  injectStyles: boolean;
  styleNonce?: string;
  onToggle(): void;
}

export function ThemeChip({
  runtime,
  label,
  presentation,
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

  // The narrow view the consumer's knobs see — the facts the chip paints, not
  // the editor's working state behind them. See `ThemeEditorBarView`.
  const view: ThemeEditorBarView = {
    tokenCount: snapshot.tokens.length,
    overriddenCount: snapshot.overriddenCount,
    preview: snapshot.preview,
    supplied: snapshot.supplied,
    writable: snapshot.writable,
  };
  const control = resolveCompactControl(presentation, view, { isOverflowed, defaults: DEFAULTS });
  const fallback = (
    <>
      {iconAndText(label, control.parts, control.icon)}
      {/* The order `Chip`'s own value slot wrote before this moved into the
          chip's children — with the kit's `value` kind opted *out* of, which is
          what `valueProps={{ "data-dtb-kind": undefined }}` did before: the
          count is unstyled here, and the chip's colour comes from
          `data-dtb-edited`/`-preview` rather than from a `severity`. */}
      {control.parts.value ? <span data-dtb-part="thm-count">{summary}</span> : null}
    </>
  );

  return (
    <button
      type="button"
      data-dtb-part={isOverflowed ? "thm-overflow-trigger" : "trigger"}
      aria-expanded={isPanelOpen}
      // `presentation.name` overrides it, and a whitespace-only override is
      // ignored so no override can leave the trigger unnamed. `title`
      // explains; it does not name, so it is not overridable.
      aria-label={resolveAccessibleName(presentation.name, view, accessibleLabel)}
      onClick={onToggle}
      title={title}
    >
      {/* The chip colours its own dot from data-dtb-edited/-preview, and the
          label and count are unstyled here, so the kit adds no kind or
          severity to those two slots. Invariant 1: those two attributes are
          state, and no preset and no `render` can move them — they are written
          on the `Chip` itself, above the children a consumer supplies. */}
      <Chip
        data-dtb-part="thm-chip"
        data-dtb-edited={edited ? "true" : "false"}
        data-dtb-preview={snapshot.preview ? "true" : "false"}
        dotProps={{ "data-dtb-part": "thm-dot" }}
      >
        {renderCompact(
          presentation,
          view,
          { icon: control.icon, isOverflowed, isPanelOpen },
          fallback,
        )}
      </Chip>
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
    <Action
      data-dtb-part="thm-action"
      data-dtb-action="clear"
      data-dtb-token={view.name}
      disabled={!view.overridden}
      title={`Drop the local edit on ${view.name} and go back to the application's own value`}
      onClick={() => runtime.clearOverride(view.name)}
    >
      reset
    </Action>
  );

  if (view.refusal !== null) {
    return (
      <>
        <Tag data-dtb-part="thm-tag" data-dtb-tag="refused" title={describeRefusal(view.refusal)}>
          {view.refusal === "reserved" ? "reserved name" : "unusable name"}
        </Tag>
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
      <TextInput
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
        onChange={(next) => {
          setDraft(next);
          setRejected(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit(draft);
        }}
        onBlur={() => commit(draft)}
      />
      {rejected === null ? null : (
        <Tag data-dtb-part="thm-tag" data-dtb-tag="rejected" role="alert">
          {rejected}
        </Tag>
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
      data-dtb-kind="row"
      data-dtb-token={view.name}
      data-dtb-overridden={view.overridden ? "true" : "false"}
      data-dtb-severity={severityFor(view)}
      data-dtb-type={view.type}
    >
      <div data-dtb-part="thm-name">
        <span>{view.label}</span>
        <code data-dtb-part="thm-token">{view.name}</code>
        {view.overridden ? (
          <Tag data-dtb-part="thm-tag" data-dtb-tag="edited">
            edited
          </Tag>
        ) : null}
        {view.applyError ? (
          <Tag data-dtb-part="thm-tag" data-dtb-tag="not-applied" title={view.applyError}>
            not applied
          </Tag>
        ) : null}
        {view.orphaned ? (
          <Tag
            data-dtb-part="thm-tag"
            data-dtb-tag="orphaned"
            title="Your page is still receiving this edit, but the token catalogue no longer declares it — usually a renamed or deleted token."
          >
            no longer declared
          </Tag>
        ) : null}
        {view.masked ? (
          <Tag
            data-dtb-part="thm-tag"
            data-dtb-tag="masked"
            title="This value was masked before it was rendered or exported."
          >
            masked
          </Tag>
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
            data-dtb-kind="value"
            data-dtb-role="effective"
            data-dtb-overridden={view.overridden ? "true" : "false"}
          >
            {view.effectiveText}
          </span>
        </span>
        <span>
          app{" "}
          <span data-dtb-part="thm-value" data-dtb-kind="value" data-dtb-role="base">
            {view.baseText}
          </span>
        </span>
        <span>
          default{" "}
          <span data-dtb-part="thm-value" data-dtb-kind="value" data-dtb-role="default">
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
  const [importText, setImportText] = useState("");
  const { status: copyStatus, copy } = useCopyStatus();

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

  return (
    <div
      data-dtb-part="thm-panel"
      data-dtb-writable={snapshot.writable ? "true" : "false"}
      data-dtb-preview={snapshot.preview ? "true" : "false"}
      aria-label={label}
    >
      {/* This masthead deliberately omits data-dtb-bleed: the panel caps itself at 860px,
          so its rule must stop at the same measure as the content below it. */}
      <div data-dtb-part="thm-toolbar" data-dtb-kind="toolbar">
        <SearchField
          data-dtb-part="thm-search"
          label="Search tokens"
          placeholder={`Search ${snapshot.tokens.length} tokens`}
          value={query}
          onChange={setQuery}
        />

        {snapshot.surfaces.length > 1 ? (
          <Field label="surface" data-dtb-part="thm-note">
            <Select
              data-dtb-part="thm-select"
              data-dtb-role="surface"
              aria-label="Surface the edits apply to"
              value={snapshot.surface.id}
              onChange={(next) => runtime.selectSurface(next)}
            >
              {snapshot.surfaces.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label ?? entry.id}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <Action
          data-dtb-part="thm-action"
          data-dtb-action="preview"
          data-dtb-on={snapshot.preview ? "true" : "false"}
          aria-pressed={snapshot.preview}
          title="Hold the edits back without discarding them, so you can see the application's own values. Press again to put them back."
          onClick={() => runtime.togglePreview()}
        >
          {snapshot.preview ? "Preview: on" : "Preview: off (before)"}
        </Action>

        <Action
          data-dtb-part="thm-action"
          data-dtb-action="reset-all"
          disabled={snapshot.overriddenCount === 0}
          title="Remove every edit and restore the surface exactly as it was, including the style attribute this extension created."
          onClick={() => runtime.resetAll()}
        >
          Reset everything ({snapshot.overriddenCount})
        </Action>

        {snapshot.mode === null ? null : (
          <Action
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
          </Action>
        )}
      </div>

      {snapshot.readError ? (
        <Banner data-dtb-part="thm-banner" data-dtb-tone="error" role="alert">
          {snapshot.readError}
        </Banner>
      ) : null}

      {failed.length > 0 ? (
        <Banner data-dtb-part="thm-banner" data-dtb-tone="error" role="alert">
          {failed.length} edit{failed.length === 1 ? "" : "s"} could not be applied:{" "}
          {failed.join(", ")}. Those rows are marked; the page did not take them.
        </Banner>
      ) : null}

      {snapshot.writable || snapshot.overriddenCount > 0 ? null : (
        <Banner data-dtb-part="thm-banner" data-dtb-tone="warn" role="status">
          Nothing on this page matches the <code>{snapshot.surface.selector}</code> surface, so
          edits are stored but not shown.
        </Banner>
      )}

      {/* The surface went away while edits were held on it. They are kept and
          will be re-applied when it comes back, but nothing on the page is
          wearing them right now — and the rows carry no per-token error,
          deliberately, because a surface missing for one render would
          otherwise mark every row failed. */}
      {!snapshot.writable && snapshot.overriddenCount > 0 ? (
        <Banner
          data-dtb-part="thm-banner"
          data-dtb-tone="warn"
          data-dtb-detached="true"
          role="status"
        >
          Nothing matches the <code>{snapshot.surface.selector}</code> surface any more, so{" "}
          {snapshot.overriddenCount} edit{snapshot.overriddenCount === 1 ? " is" : "s are"} no
          longer on the page. They are kept, and go back on when it returns.
        </Banner>
      ) : null}

      {snapshot.notice ? (
        <Banner data-dtb-part="thm-banner" data-dtb-tone="info" role="status">
          {snapshot.notice}
        </Banner>
      ) : null}

      {snapshot.supplied ? null : (
        <Note data-dtb-part="thm-note">
          No tokens were supplied. This extension owns no design system and generates no palette —
          pass the tokens your application publishes:{" "}
          <code>{'themeEditor({ tokens: [{ name: "--brand-500", type: "color" }] })'}</code>.
        </Note>
      )}

      {visible.map((group) => (
        <section key={group.name}>
          <h3 data-dtb-part="thm-group-name" data-dtb-legend="">
            {group.name}
          </h3>
          <ul data-dtb-part="thm-list" data-dtb-kind="list">
            {group.tokens.map((view) => (
              <Row key={view.name} view={view} runtime={runtime} writable={snapshot.writable} />
            ))}
          </ul>
        </section>
      ))}

      {presets.length > 0 ? (
        <div data-dtb-part="thm-actions" data-dtb-role="presets">
          <Note as="span" data-dtb-part="thm-note">
            presets
          </Note>
          {presets.map((preset) => (
            <Action
              key={preset.name}
              data-dtb-part="thm-action"
              data-dtb-action="preset"
              data-dtb-preset={preset.name}
              onClick={() => runtime.applyPreset(preset.name)}
            >
              {preset.name}
            </Action>
          ))}
        </div>
      ) : null}

      {/* The panel's largest element is the payload itself — the exact string
          the buttons copy, not a summary of it. */}
      <div data-dtb-part="thm-actions" data-dtb-role="export">
        <Field label="export" data-dtb-part="thm-note">
          <Select
            data-dtb-part="thm-select"
            data-dtb-role="format"
            aria-label="Export format"
            value={format}
            onChange={(next) => setFormat(next as ExportFormat)}
          >
            {(Object.keys(FORMAT_LABEL) as ExportFormat[]).map((key) => (
              <option key={key} value={key}>
                {FORMAT_LABEL[key]}
              </option>
            ))}
          </Select>
        </Field>
        <Action data-dtb-part="thm-action" data-dtb-action="copy" onClick={() => copy(output)}>
          Copy
        </Action>
        <Action
          data-dtb-part="thm-action"
          data-dtb-action="copy-link"
          title="A link to this page carrying the recipe. Masked values are left out of it — a document a machine applies must not contain a value that is not a value."
          onClick={() => copy(runtime.shareLink())}
        >
          Copy share link
        </Action>
        <Note as="span" data-dtb-part="thm-note" role="status">
          {copyStatus === "failed"
            ? "Clipboard unavailable — select the text below instead."
            : copyStatus === "ok"
              ? `Copied — ${snapshot.maskedCount} value${snapshot.maskedCount === 1 ? "" : "s"} masked.`
              : `Credential-shaped values are masked before anything leaves this panel${snapshot.maskedCount > 0 ? ` (${snapshot.maskedCount} here)` : ""}.`}
        </Note>
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
        <Action
          data-dtb-part="thm-action"
          data-dtb-action="import"
          disabled={importText.trim() === ""}
          onClick={() => runtime.importRecipe(importText)}
        >
          Import
        </Action>
      </div>

      {/* What was left out, and what leaving it out costs, stated next to the
          thing itself. */}
      <Note data-dtb-part="thm-note" data-dtb-role="limits">
        Edits are written as inline custom properties on <code>{snapshot.surface.selector}</code>,
        so an application rule marked <code>!important</code> still wins and this panel will show an
        edit the page is not honouring. Nothing here generates a palette from a base colour: this
        editor changes the tokens your design system already publishes, and a generated scale
        belongs in a <code>preset</code> your code computes. The Figma export is the W3C
        design-tokens shape — the deterministic, versioned half of §3H's pipeline; no plugin ships
        here. Names beginning <code>--dtb-</code> or <code>--dev-toolbar</code> are never written,
        so an edit cannot restyle this toolbar; restyle the bar from your own stylesheet instead.
      </Note>

      {snapshot.overriddenCount > 0 ? (
        <Note data-dtb-part="thm-note" data-dtb-role="escape-hatch">
          Edits persist across reloads in this browser. Reset them above, or load any page with{" "}
          <code>?dtb-theme=reset</code> if an edit has made the app unreadable enough that you
          cannot reach this panel.
        </Note>
      ) : null}
    </div>
  );
}
