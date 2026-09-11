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
  hasPaintableIcon,
  renderCompact,
  renderCompactParts,
  resolveAccessibleName,
  resolveCompactControl,
  resolveIcon,
  useExtensionSurface,
} from "@nejcm/dev-toolbar/kit";
import type {
  CompactDefaults,
  CompactParts,
  ResolvedCompactPresentation,
} from "@nejcm/dev-toolbar/kit";
import { ensureFlagsStyles } from "./css";
import { formatValue, matchesQuery, parseValue, severityFor } from "./types";
import type { FlagValue, FlagView, FlagsSnapshot } from "./types";
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
 * What `"default"` paints on the flags chip, in each of the two places it
 * appears.
 *
 * The `⋮` row is the same tree as the bar's, down to the word: this chip has
 * always painted `"flags"` in both, unlike the Group A chips that swing to
 * their `label` when overflowed. So `overflow.text` is `"short"` here, which is
 * what keeps the default byte-identical in the menu — and it is exactly why
 * `CompactDefaults` is handed in per extension rather than known to kit.
 * Under any *preset* the menu still forces `"full"`, which is the chip's
 * `label` ("Flags"); that is the documented overflow guarantee, and it only
 * ever applies once a consumer has opted into a preset.
 */
const CHIP_DEFAULTS: CompactDefaults = {
  bar: { icon: false, text: "short", value: true },
  overflow: { icon: false, text: "short", value: true },
};

/**
 * What `"default"` paints on a promoted control.
 *
 * `icon: true` because a promoted flag has *always* been able to paint one —
 * `PromotedFlag.icon`, the string glyph. It occupies the same slot the new
 * `presentation.icon` does, so the back-compat emoji keeps working under
 * `preset: "icon"` instead of being silently dropped. The two suppliers paint
 * two shapes; see `promotedParts`.
 *
 * The bar and the `⋮` menu are the same tree here too — the promoted control
 * is rendered identically in both — so both rows are the same.
 */
const PROMOTED_DEFAULTS: CompactDefaults = {
  bar: { icon: true, text: "short", value: true },
  overflow: { icon: true, text: "short", value: true },
};

/** A control whose consumer configured nothing. Shared, so it is not rebuilt per render. */
const NO_PRESENTATION: ResolvedCompactPresentation<FlagView> = { preset: "default" };

/**
 * The icon and the text of one promoted control.
 *
 * The icon slot has two suppliers and therefore two shapes, and that is
 * deliberate rather than an oversight:
 *
 * - `PromotedFlag.icon` is a **string** — "text, not an asset" — and it has
 *   shipped as a bare `<span aria-hidden="true">` since this control existed.
 *   Routing it through `Glyph` would change the default output, so it keeps its
 *   own node and today's bytes.
 * - `PromotedFlag.presentation.icon` is a `ReactNode`, and gets kit's `Glyph`:
 *   `aria-hidden` by default and clamped, because a 24px `<svg>` handed to an
 *   11px bar would set the bar's height.
 *
 * The text span is deliberately unnamed, which is what it has always been. A
 * promoted control has one text rather than two — the promoted label *is* the
 * identity — so `short` and `full` are the same word and the `⋮` rule is a
 * no-op here.
 */
function promotedParts(
  label: string,
  parts: CompactParts,
  icon: ReactNode,
  legacy: string | undefined,
): ReactNode {
  // No presence check here: `resolveCompactControl` holds "`parts.icon` implies
  // a paintable `icon`" on its own output now, `defaults` included — which is
  // what `PROMOTED_DEFAULTS.icon: true` relies on, since this is the one
  // first-party tree whose `"default"` names an icon slot.
  //
  // `legacy` is only ever the resolved icon when the consumer supplied no
  // usable `presentation.icon`, so this fork is "which supplier", not "which
  // preset".
  const paintsLegacy = parts.icon && legacy !== undefined;
  return (
    <>
      {paintsLegacy ? <span aria-hidden="true">{legacy}</span> : null}
      {renderCompactParts({
        parts: { ...parts, icon: parts.icon && !paintsLegacy },
        icon,
        iconProps: { "data-dtb-part": "flag-promoted-icon" },
        short: label,
        full: label,
      })}
    </>
  );
}

/**
 * The promoted flag itself: one control in the bar.
 *
 * A boolean is a `role="switch"` that flips the flag in place — the point of
 * promoting it during a migration. Anything else opens the panel; a bar is
 * no place to edit a string.
 *
 * Its `presentation` is configured on the `PromotedFlag` itself rather than on
 * `flags()`, because a control's presentation belongs next to that control —
 * the alternative is one flags-level callback receiving
 * `FlagsSnapshot | FlagView` and making the consumer narrow it. It reaches here
 * as a prop, resolved once in the factory closure: a `ReactNode` cannot go
 * anywhere near this extension's signature-based store.
 */
function PromotedControl({
  view,
  presentation,
  writable,
  isOverflowed,
  isPanelOpen,
  onToggle,
  onOpen,
}: {
  view: FlagView;
  presentation: ResolvedCompactPresentation<FlagView>;
  writable: boolean;
  isOverflowed: boolean;
  isPanelOpen: boolean;
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

  // The dot is aria-hidden and the icon is decorative, so the label span is the
  // only thing naming this control. Name it explicitly and keep the value a
  // non-boolean paints — a switch already announces its own on/off state, so
  // repeating it there would be noise. `title` explains; it does not name.
  const accessibleLabel = view.type === "boolean" ? label : `${label}, ${view.effectiveText}`;

  // The rich icon is resolved *first* — a function `icon` may decline for this
  // control and supply for the next — and the back-compat string glyph fills
  // the slot only when nothing usable came back. Testing `presentation.icon`
  // instead would let `icon: () => undefined` drop the legacy glyph silently,
  // though the README promises the rich one merely *wins*. Filling the slot is
  // also what lets `hasIcon` — and so the "an icon-only preset with no icon
  // paints text" guarantee — see the string glyph at all.
  const rich = resolveIcon(presentation.icon, view);
  // Both halves are kit's one emptiness rule, `hasPaintableIcon` — every node
  // React paints nothing for, `""` and `false` included. Over the legacy
  // glyph's `string | undefined` that is exactly the truthiness this control
  // has always applied (`view.promotedIcon ? … : null` since it existed), so
  // `icon: ""` still paints nothing rather than getting a slot: an empty
  // `<span aria-hidden="true">` that eats a `gap`, and — worse — a truthy
  // `hasIcon` under `preset: "icon"`, which would suppress kit's guarantee 1
  // and leave the control blank but for its dot. An empty string is not an
  // icon, and neither is `false`.
  const legacy =
    !hasPaintableIcon(rich) && hasPaintableIcon(view.promotedIcon) ? view.promotedIcon : undefined;
  // The already-resolved node goes back in, so a function `icon` is invoked
  // once per control rather than twice.
  const control = resolveCompactControl({ ...presentation, icon: legacy ?? rich }, view, {
    isOverflowed,
    defaults: PROMOTED_DEFAULTS,
  });

  // A boolean has no value slot: the switch announces its own state, and
  // painting "true" next to it would be noise.
  const paintsValue = control.parts.value && view.type !== "boolean";
  // Kit's guarantee 1 covers `"icon"` alone, because for every other preset
  // "the other part" is always there — except here, where a promoted boolean
  // has no value to paint. `"value"` and an iconless `"icon-value"` would leave
  // a switch that is a bare dot, so the plan's own principle applies: a blank
  // control is worse than an unstyled one. `short` and `full` are the same word
  // on this control, so the `⋮` rule is a no-op either way.
  const parts =
    control.parts.icon || control.parts.text !== "none" || paintsValue
      ? control.parts
      : { ...control.parts, text: "short" as const };

  const fallback = (
    <>
      {promotedParts(label, parts, control.icon, legacy)}
      {paintsValue ? (
        <span data-dtb-part="flag-promoted-value" data-dtb-kind="value">
          {view.effectiveText}
        </span>
      ) : null}
    </>
  );

  return (
    <button
      type="button"
      data-dtb-part="flag-promoted"
      data-dtb-flag={view.key}
      data-dtb-overridden={view.overridden ? "true" : "false"}
      // `presentation.name` overrides it, and a whitespace-only override is
      // ignored so no override can leave this control unnamed. `title`
      // explains; it does not name, so it is not overridable.
      aria-label={resolveAccessibleName(presentation.name, view, accessibleLabel)}
      {...(toggleable ? { role: "switch", "aria-checked": on } : {})}
      onClick={toggleable ? onToggle : onOpen}
      title={title}
    >
      {/* The dot stays outside the preset and outside `render`: it is state,
          not text, and `role="switch"`/`aria-checked`, `data-dtb-flag` and
          `data-dtb-overridden` are on the button for the same reason. A
          callback supplies children only. */}
      <span data-dtb-part="flag-promoted-dot" data-dtb-kind="dot" aria-hidden="true" />
      {renderCompact(
        presentation,
        view,
        { icon: control.icon, isOverflowed, isPanelOpen },
        fallback,
      )}
    </button>
  );
}

export interface ChipProps {
  runtime: FlagsRuntime;
  label: string;
  /** The chip's own, already through `resolvePresentation` in the factory closure. */
  presentation: ResolvedCompactPresentation<FlagsSnapshot>;
  /**
   * Each promoted flag's own, keyed by its **position** in the `promoted`
   * option — `PromotedFlag.presentation` resolved once in the factory.
   *
   * By position rather than by `flagKey` because two entries may name the same
   * key with different `startAt`/`expiresAt`/`audience` windows, and the
   * runtime is the one that knows which is in force: it says so in
   * `FlagView.promotedIndex`, which is what this map is read with. Keyed by
   * key, an expired entry's presentation would paint on the live entry's label.
   *
   * It travels as a prop for the same reason `label` and `injectStyles` do, and
   * for one more: a `ReactNode` cannot enter this extension's store, which
   * republishes on a *string* signature.
   */
  promotedPresentations: ReadonlyMap<number, ResolvedCompactPresentation<FlagView>>;
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
  presentation,
  promotedPresentations,
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

  const control = resolveCompactControl(presentation, snapshot, {
    isOverflowed,
    defaults: CHIP_DEFAULTS,
  });
  // The one construction: handed to a `render` callback as `ctx.fallback` and
  // painted when there is none, so `render: (_, ctx) => ctx.fallback` is exact
  // by construction rather than by two pieces of markup kept in step.
  const contents = (
    <>
      {renderCompactParts({
        parts: control.parts,
        icon: control.icon,
        iconProps: { "data-dtb-part": "flag-icon" },
        short: "flags",
        full: label,
        textProps: { "data-dtb-part": "flag-label", "data-dtb-kind": "label" },
      })}
      {control.parts.value ? <span data-dtb-part="flag-count">{summary}</span> : null}
    </>
  );

  const trigger = (
    <button
      type="button"
      data-dtb-part={isOverflowed ? "flag-overflow-trigger" : "trigger"}
      aria-expanded={isPanelOpen}
      // `presentation.name` overrides it; a whitespace-only override is ignored
      // so no override can leave the trigger unnamed. `title` is not
      // overridable — it explains, it does not name.
      aria-label={resolveAccessibleName(presentation.name, snapshot, label)}
      onClick={onToggle}
      title={title}
    >
      {/* Hand-written, not the kit's <Chip>: this chip has no dot, and the kit
          chip always renders one. An extra node here would move the whole
          summary by a dot and a gap. That is also why a consumer's `render`
          supplies this span's *children*: the span carries
          `data-dtb-overridden`, which is state and not the callback's to lose. */}
      <span
        data-dtb-part="flag-chip"
        data-dtb-kind="chip"
        data-dtb-overridden={snapshot.overriddenCount > 0 ? "true" : "false"}
      >
        {renderCompact(
          presentation,
          snapshot,
          { icon: control.icon, isOverflowed, isPanelOpen },
          contents,
        )}
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
      presentation={promotedPresentations.get(view.promotedIndex ?? -1) ?? NO_PRESENTATION}
      writable={snapshot.writable}
      isOverflowed={isOverflowed}
      isPanelOpen={isPanelOpen}
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
    // Options carry the *index*, never the value: a `<option value>` is DOM
    // text, so a credential variant would sit in the page unmasked next to a
    // row the badge claims is masked. The label comes from the redacted
    // `variantTexts`, and the raw value is resolved back here, on commit.
    const variants = view.variants;
    const texts = view.variantTexts;
    // Same match the old `value={formatValue(view.effective)}` made, kept so a
    // reading whose type differs from its variant still selects its own row.
    const effectiveText = formatValue(view.effective);
    const selected = variants.findIndex((variant) => formatValue(variant) === effectiveText);
    return (
      <>
        <Select
          data-dtb-part="flag-input"
          data-dtb-flag={view.key}
          aria-label={`Override ${view.key}`}
          value={view.masked || selected < 0 ? "" : String(selected)}
          onChange={(next) => {
            // The placeholder is a real option; picking it must not index to 0.
            if (next === "") return;
            const chosen = variants[Number(next)];
            if (chosen !== undefined) commit(chosen);
          }}
        >
          {view.masked || selected < 0 ? (
            <option value="">{view.masked ? "(masked)" : "—"}</option>
          ) : null}
          {variants.map((_variant, index) => (
            <option key={index} value={String(index)}>
              {texts?.[index] ?? `variant ${index + 1}`}
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

      {snapshot.bulkError === null ? null : (
        <Banner
          data-dtb-part="flag-banner"
          data-dtb-tone="error"
          data-dtb-role="bulk-error"
          severity="bad"
          role="alert"
        >
          The override map could not be handed to your application — <code>onOverridesChange</code>{" "}
          threw: {snapshot.bulkError}
        </Banner>
      )}

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
          Read-only: no <code>onOverride</code> or <code>onOverridesChange</code> adapter was
          supplied to <code>flags()</code>, so this panel lists and copies but changes nothing.
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
