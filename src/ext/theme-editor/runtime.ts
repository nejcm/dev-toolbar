/**
 * Everything `/ext/theme-editor` owns that is not React.
 *
 * Built by `themeEditor()`, not `start(api)`: slot functions run during the
 * toolbar's first render, before any effect fires, so the store must exist by
 * the time the factory returns.
 *
 * An edit outlives the tab, so a kill switch (`?dtb-theme=reset`) runs before
 * any override is applied — the edit that makes the page unreadable is
 * exactly the one you can't see the panel to remove. Reversal is exact: the
 * inline value each property had before we wrote it is recorded and
 * restored.
 *
 * Unlike `/ext/overlays`, hiding the bar does not revert the edits — an
 * override is a state the developer chose, not a drawing tied to visibility.
 */
import { createDerivedStore, describeError, redact } from "../../runtime";
import {
  createPoller,
  parseRecord,
  readPreference,
  readPreferenceIfReadable,
  readStoredRecord,
  stripResetParam,
  writePreference,
} from "@nejcm/dev-toolbar/kit";
import type { Preference } from "@nejcm/dev-toolbar/kit";
import type { RedactOptions, ThrottledStore } from "../../runtime";
import type { ExtensionRuntimeApi, ToolbarStorage } from "../../core/contract";
import {
  DEFAULT_SURFACE,
  MASK_SENTINEL,
  checkStoredEntry,
  checkTokenName,
  checkTokenValue,
  humanise,
  inferType,
  isPrintableSelector,
  parseRecipe,
} from "./types";
import type {
  DesignTokenDefinition,
  ThemeRecipe,
  ThemeSnapshot,
  ThemeSurface,
  TokenType,
  TokenView,
  TokensInput,
  ValueRefusal,
} from "./types";

/** Keys, inside the extension's own storage scope. */
export const OVERRIDES_KEY = "overrides";
export const SURFACE_KEY = "surface";
export const PREVIEW_KEY = "preview";

/**
 * The edit map as it is laid down in storage: this extension's own JSON, stored
 * byte-for-byte, so the raw-string encoding never changes what a consumer
 * already has persisted. The serialised empty map is the fallback, which is
 * what makes "no edits left" remove the key.
 */
const OVERRIDES_PREFERENCE: Preference<string> = {
  key: OVERRIDES_KEY,
  encoding: "string",
  fallback: "{}",
  isValue: (value): value is string => typeof value === "string",
};

/** `"0"` is the only value that turns preview off; anything else reads as on. */
const PREVIEW_PREFERENCE: Preference<"0" | "1"> = {
  key: PREVIEW_KEY,
  encoding: "string",
  fallback: "1",
  isValue: (value): value is "0" | "1" => value === "0" || value === "1",
};

/** Query parameter carrying a shared recipe, or the word `reset`. */
export const DEFAULT_THEME_PARAM = "dtb-theme";

export type ThemeMode = "light" | "dark";

export interface ThemeModeAdapter {
  /** Your application's current colour mode. Wrapped; a throw is survivable. */
  read(): ThemeMode;
  /** Omit and the panel reports the mode without offering to change it. */
  set?(next: ThemeMode): void;
}

export interface ThemeEditorRuntimeOptions {
  /**
   * The design tokens your application publishes.
   *
   * Pass a function for a catalogue that changes; it is re-read on demand and
   * every `pollMs`. Names must be custom properties (`--like-this`) and must
   * not be the toolbar's own `--dtb-*` — see `RESERVED_PREFIXES`.
   */
  tokens?: TokensInput;
  /**
   * Apply an edit yourself instead of letting the extension write the custom
   * property onto the surface element. `value === undefined` means the token
   * no longer has a local edit.
   *
   * Does **not** stop the extension from writing to the surface — it runs
   * alongside, so you can mirror the edit into your own theme provider
   * without losing the live preview.
   */
  onApply?(name: string, value: string | undefined): void;
  /** Surfaces the edits may be applied to. Default: `:root` only. */
  surfaces?: readonly ThemeSurface[];
  /** Named recipes a consumer computed. §3H's "presets". */
  presets?: readonly ThemeRecipe[] | (() => readonly ThemeRecipe[]);
  /** The application's colour mode. Read-only unless `set` is supplied. */
  mode?: ThemeModeAdapter;
  /** Re-read a function `tokens` this often, in ms. Default `1000`. */
  pollMs?: number;
  /** Merged into every `redact()` call. `allowKeys` is the usual reason here. */
  redactOptions?: RedactOptions;
  /** Query parameter carrying a shared recipe. Default `"dtb-theme"`. `null` disables. */
  themeParam?: string | null;
  /**
   * Persist edits through `api.storage`. Default `true`.
   *
   * `true` also keeps edits across a `stop()`/`start()` when the adapter throws
   * and nothing could be written; `false` resets the map on every `start()`.
   */
  persist?: boolean;
  /** Clock, injectable for tests. Default `Date.now`. */
  now?: () => number;
  /** Document to write to. Default the ambient one. Injectable for tests. */
  document?: Document;
  /** Author recorded in an exported recipe. */
  createdBy?: string;
}

export interface ThemeEditorRuntime {
  readonly store: ThrottledStore<ThemeSnapshot>;
  /**
   * `null` until `start(api)` runs.
   *
   * @deprecated Nothing in the package reads it any more: every persisted
   * preference goes through `readPreferenceIfReadable`, `readPreference` or
   * `writePreference` from `@nejcm/dev-toolbar/kit`, which guard the adapter for
   * you. Use those with `api.storage` instead. Removal is a published-API change
   * and waits for the next major.
   */
  storage(): ToolbarStorage | null;
  start(api: ExtensionRuntimeApi): () => void;
  /** Re-read the tokens and publish. */
  refresh(): void;
  /** The current edit map. A copy. */
  overrides(): Record<string, string>;
  /**
   * Sets one token's value. Returns `null` on success, or why it was refused —
   * the editor shows the reason and keeps the draft rather than coercing it.
   */
  setOverride(name: string, value: string): ValueRefusal | null;
  clearOverride(name: string): void;
  /** Removes every edit and restores the surface exactly. */
  resetAll(): void;
  /** Holds the edits back without discarding them. §3H's before/after. */
  setPreview(on: boolean): void;
  togglePreview(): void;
  selectSurface(id: string): void;
  setMode(next: ThemeMode): void;
  /** Applies a recipe, keeping only tokens the current catalogue declares. */
  importRecipe(raw: string): { applied: number; dropped: number; error: string | null };
  applyPreset(name: string): boolean;
  presets(): readonly ThemeRecipe[];
  /** §3H's export formats. All redacted. */
  cssText(): string;
  recipeText(): string;
  figmaText(): string;
  /** `null` when there is no `location` to build one from. */
  shareLink(): string | null;
  /** JSON-safe, redacted. Same source as everything above. */
  diagnostics(): unknown;
}

/* -------------------------------------------------------------------------- */
/* Small guards                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Reads one consumer redaction property once; a throw yields the default.
 * Guarded because this runs inside `themeEditor()`, before core mounts, where
 * an uncaught throw takes down the host app's render rather than an error
 * chip. Read once and reused, so a changing getter can't make the panel
 * disagree with itself mid-render.
 */
function readRedactionProperty<T, K extends keyof T>(
  options: T | undefined,
  key: K,
): T[K] | undefined {
  try {
    return options?.[key];
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      `[dev-toolbar/ext/theme-editor] the supplied ${String(key)} getter threw. Using the default.`,
      error,
    );
    return undefined;
  }
}

const nowIso = (at: number): string => {
  // A patched/broken `Date` must not throw out of a click handler.
  try {
    return new Date(at).toISOString();
  } catch {
    return "unknown";
  }
};

const emptyMap = (): Record<string, string> => Object.create(null) as Record<string, string>;

const cloneMap = (source: Record<string, string>): Record<string, string> =>
  Object.assign(emptyMap(), source);

/** Own data property, by definition rather than assignment (avoids `__proto__` hazards). */
function define(target: Record<string, string>, key: string, value: string): void {
  defineAny(target as Record<string, unknown>, key, value);
}

/** The same, for a payload whose values are not all strings. */
function defineAny(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/**
 * True when the URL asks for every edit to be dropped — an escape hatch for
 * when a broken edit hides the panel you'd use to remove it.
 */
export function themeParamValue(param: string | null): string | null {
  if (param === null) return null;
  try {
    if (typeof location === "undefined" || typeof location.search !== "string") {
      return null;
    }
    return new URLSearchParams(location.search).get(param);
  } catch {
    return null;
  }
}

export function resetRequested(param: string | null): boolean {
  const value = themeParamValue(param);
  return value === "reset" || value === "clear" || value === "off";
}

/** Parses a persisted edit map, dropping anything that is not a string. */
export function parseOverrides(raw: string | null): Record<string, string> {
  return parseRecord(raw, (value): value is string => typeof value === "string");
}

/**
 * Reads the persisted edit map without mounting anything, so an app building
 * its own theme object before React mounts doesn't disagree with the panel
 * for one paint. Honours `?dtb-theme=reset` the same as `start()`.
 */
export function readStoredThemeOverrides(
  options: {
    instanceId?: string;
    id?: string;
    storage?: ToolbarStorage;
    themeParam?: string | null;
    /**
     * The same catalogue you pass to `themeEditor()`. Supply it and this
     * helper reaches parity with the mounted runtime's own vetting; omit it
     * and every entry is checked as a `"string"`, the loosest type — the
     * whole security-relevant pass still runs either way.
     */
    tokens?: TokensInput;
    /** `redactOptions.mask`, when you changed it. Default `"[redacted]"`. */
    mask?: string;
  } = {},
): Record<string, string> {
  const {
    instanceId = "default",
    id = "theme-editor",
    storage,
    themeParam = DEFAULT_THEME_PARAM,
    tokens,
  } = options;
  const mask = readRedactionProperty(options, "mask") ?? MASK_SENTINEL;
  try {
    const declared = declaredTypesOf(tokens);
    // Same entry policy `start()` applies to the same bytes, so a consumer
    // seeding its own theme provider from this doesn't disagree with the panel.
    const accepted = readStoredRecord(
      { instanceId, extensionId: id, key: OVERRIDES_KEY, storage, resetParam: themeParam },
      (value, name): value is string =>
        typeof value === "string" &&
        checkStoredEntry(name, value, { type: declared.get(name), mask }) === null,
    );
    const output: Record<string, string> = {};
    for (const [name, value] of Object.entries(accepted)) define(output, name, value.trim());
    return output;
  } catch {
    return {};
  }
}

/**
 * `name → inferred type` for a catalogue supplied to a pre-mount helper.
 * Wrapped since `tokens` may be a throwing getter; a throw degrades to the
 * type-independent half of the check rather than to no check at all.
 */
function declaredTypesOf(tokens: TokensInput | undefined): Map<string, TokenType> {
  const declared = new Map<string, TokenType>();
  if (tokens === undefined) return declared;
  try {
    const list = typeof tokens === "function" ? tokens() : tokens;
    if (!Array.isArray(list)) return declared;
    for (const definition of list as readonly DesignTokenDefinition[]) {
      if (typeof definition?.name !== "string" || declared.has(definition.name)) continue;
      declared.set(definition.name, inferType(definition));
    }
  } catch {
    /* see above */
  }
  return declared;
}

/* -------------------------------------------------------------------------- */
/* The surface — the one place this extension touches the host document        */
/* -------------------------------------------------------------------------- */

interface PriorDeclaration {
  value: string;
  priority: string;
}

/**
 * Owns the inline custom properties written to one element, and what that
 * element's inline style said before we touched it. Not module state: two
 * toolbars, or two bundled copies of this extension, are separate closures
 * sharing only the element, each restoring only what it displaced.
 *
 * Weaker for the *same* token edited by two holders: if A writes `--x`
 * (prior `""`) and B then writes `--x` (prior: A's value), tearing down A
 * before B leaves A's value live with nobody holding it. Accepted limitation
 * of any per-closure inline-restore scheme, not a bug.
 */
class SurfaceHold {
  readonly element: HTMLElement;
  /**
   * Whether the element already had a `style` attribute (even empty) when
   * this hold was created. Not redundant with `tidy()`'s `style.length`
   * check: `style=""` isn't ours to remove — `[style]` is a legal selector.
   */
  private readonly hadStyleAttribute: boolean;
  private readonly prior = new Map<string, PriorDeclaration>();

  constructor(element: HTMLElement) {
    this.element = element;
    this.hadStyleAttribute = element.hasAttribute("style");
  }

  write(name: string, value: string): void {
    if (!this.prior.has(name)) {
      this.prior.set(name, {
        value: this.element.style.getPropertyValue(name),
        priority: this.element.style.getPropertyPriority(name),
      });
    }
    this.element.style.setProperty(name, value);
  }

  release(name: string): void {
    const prior = this.prior.get(name);
    if (prior === undefined) return;
    this.prior.delete(name);
    if (prior.value === "") this.element.style.removeProperty(name);
    else this.element.style.setProperty(name, prior.value, prior.priority);
    this.tidy();
  }

  releaseAll(): void {
    // Copied: `release` deletes from the map being iterated.
    for (const name of Array.from(this.prior.keys())) this.release(name);
    this.tidy();
  }

  get size(): number {
    return this.prior.size;
  }

  /**
   * `removeProperty` empties `style` but leaves `style=""` behind — residue
   * that fails a byte-for-byte exact-reversal check.
   */
  private tidy(): void {
    if (this.hadStyleAttribute) return;
    if (this.element.style.length > 0) return;
    this.element.removeAttribute("style");
  }
}

/* -------------------------------------------------------------------------- */
/* The runtime                                                                 */
/* -------------------------------------------------------------------------- */

export function createThemeEditorRuntime(
  options: ThemeEditorRuntimeOptions = {},
): ThemeEditorRuntime {
  const {
    tokens,
    onApply,
    surfaces: surfaceOption,
    presets: presetOption,
    mode,
    pollMs = 1000,
    themeParam = DEFAULT_THEME_PARAM,
    persist = true,
    now = Date.now,
    document: injectedDocument,
    createdBy,
  } = options;

  const surfaces: readonly ThemeSurface[] =
    surfaceOption && surfaceOption.length > 0 ? surfaceOption : [DEFAULT_SURFACE];

  const copySurface = (candidate: ThemeSurface): ThemeSurface => ({
    id: candidate.id,
    ...(candidate.label === undefined ? {} : { label: candidate.label }),
    selector: candidate.selector,
  });

  const suppliedRedactOptions = readRedactionProperty(options, "redactOptions");
  const redactOptions: RedactOptions = {
    mask: readRedactionProperty(suppliedRedactOptions, "mask") ?? MASK_SENTINEL,
    keys: readRedactionProperty(suppliedRedactOptions, "keys"),
    extraKeys: readRedactionProperty(suppliedRedactOptions, "extraKeys"),
    allowKeys: readRedactionProperty(suppliedRedactOptions, "allowKeys"),
    maxDepth: readRedactionProperty(suppliedRedactOptions, "maxDepth"),
    maxArrayLength: readRedactionProperty(suppliedRedactOptions, "maxArrayLength"),
    maxNodes: readRedactionProperty(suppliedRedactOptions, "maxNodes"),
    values: readRedactionProperty(suppliedRedactOptions, "values"),
  };
  const maskText = redactOptions.mask ?? MASK_SENTINEL;

  let storage: ToolbarStorage | null = null;
  let overrides = emptyMap();
  let surface: ThemeSurface = surfaces[0] as ThemeSurface;
  let preview = true;
  let hold: SurfaceHold | null = null;
  let notice: string | null = null;
  let readError: string | null = null;
  /** Per token, not one slot — one failure must not hide another's. */
  const applyErrors = new Map<string, string>();
  /**
   * The application's own computed value, captured the last time the token was
   * *not* overridden. Once the override is on the element the computed value is
   * the override, and re-reading would make every row claim the app agreed.
   */
  const capturedBase = new Map<string, string>();

  const doc = (): Document | null =>
    injectedDocument ?? (typeof document === "undefined" ? null : document);

  /* ------------------------------------------------------------------ */
  /* Reading the consumer's catalogue. Never throws.                      */
  /* ------------------------------------------------------------------ */

  const readTokens = (): readonly DesignTokenDefinition[] => {
    try {
      const value = typeof tokens === "function" ? tokens() : tokens;
      if (value === undefined || value === null) return [];
      if (!Array.isArray(value)) return [];
      readError = null;
      return value as readonly DesignTokenDefinition[];
    } catch (error) {
      readError = "The token list could not be read — it threw. See the console.";
      // eslint-disable-next-line no-console
      console.error(
        "[dev-toolbar/ext/theme-editor] the supplied tokens getter threw. " +
          "Showing an empty list.",
        error,
      );
      return [];
    }
  };

  const readPresets = (): readonly ThemeRecipe[] => {
    try {
      const value = typeof presetOption === "function" ? presetOption() : presetOption;
      return Array.isArray(value) ? (value as readonly ThemeRecipe[]) : [];
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[dev-toolbar/ext/theme-editor] the supplied presets getter threw.", error);
      return [];
    }
  };

  const readMode = (): ThemeMode | null => {
    if (mode === undefined) return null;
    try {
      return mode.read() === "dark" ? "dark" : "light";
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[dev-toolbar/ext/theme-editor] the mode adapter's read() threw.", error);
      return null;
    }
  };

  /* ------------------------------------------------------------------ */
  /* Applying                                                             */
  /* ------------------------------------------------------------------ */

  const resolveElement = (): HTMLElement | null => {
    const target = doc();
    if (target === null) return null;
    try {
      const found =
        surface.selector === ":root"
          ? target.documentElement
          : target.querySelector<HTMLElement>(surface.selector);
      if (found === null) return null;
      // Belt and braces on top of the name guard: a surface inside any dev
      // toolbar is refused, since "write the app's tokens onto the toolbar"
      // is never what was meant.
      if (typeof found.closest === "function" && found.closest("[data-dev-toolbar]") !== null) {
        return null;
      }
      return found;
    } catch {
      // An invalid selector throws from `querySelector`.
      return null;
    }
  };

  const currentHold = (): SurfaceHold | null => {
    const element = resolveElement();
    if (element === null) return null;
    if (hold !== null && hold.element === element) return hold;
    // A replacement, not the first acquisition — release the old hold or its
    // edits strand on a node no longer in the document.
    if (hold !== null) hold.releaseAll();
    hold = new SurfaceHold(element);
    return hold;
  };

  /**
   * Reentrancy latch: migration re-applies every edit through `writeOne`,
   * which reconciles again. Against a resolver that doesn't return the same
   * element twice (a proxy, a test double), that re-entry would otherwise be
   * exponential rather than a fast stack overflow; this latch bounds it.
   */
  let migrating = false;

  /** False before `start()` and after teardown, when writing to the page must stop. */
  let active = false;

  /**
   * Keeps the edits on whatever element the surface selector resolves to
   * *now*. Called from `publish()` and as `writeOne()`'s first statement —
   * deliberately not from `buildSnapshot()`, since export helpers build a
   * snapshot without publishing and a read that repaints the page would be
   * worse than what this fixes.
   *
   * Compares element identity, not `isConnected`: an SPA re-render can swap
   * in a live element while the old one is still connected, so identity is
   * what catches it and makes releasing the old element mandatory.
   */
  const reconcileSurface = (): void => {
    if (migrating || !active) return;
    const element = resolveElement();
    if (hold !== null && hold.element === element) return;
    if (hold !== null) releaseAll();
    // No per-token applyError here: a transient null between renders would
    // otherwise spam every row, and `writable: false` already reports it.
    if (element === null || !preview) return;
    migrating = true;
    try {
      hold = new SurfaceHold(element);
      for (const [name, value] of Object.entries(overrides)) writeOne(name, value);
    } finally {
      migrating = false;
    }
  };

  /**
   * Calls the consumer's optional adapter. Wrapped since it's consumer code
   * running inside our click handler, and the failure is recorded, never
   * swallowed — a row saying "edited" while the app never heard about it
   * would be a lie.
   */
  const notifyConsumer = (name: string, value: string | undefined): void => {
    if (typeof onApply !== "function") return;
    try {
      onApply(name, value);
    } catch (error) {
      // Rendered as a row title, so it's redacted before this sentence is built.
      applyErrors.set(
        name,
        `${describeError(error, redactOptions).message} — your application's own onApply did not accept this edit.`,
      );
      // eslint-disable-next-line no-console
      console.error(
        `[dev-toolbar/ext/theme-editor] the onApply adapter threw for "${name}".`,
        error,
      );
    }
  };

  /** Whitespace is the only difference CSSOM is allowed to introduce here. */
  const normalise = (text: string): string => text.trim().replace(/\s+/g, " ");

  const writeOne = (name: string, value: string): void => {
    reconcileSurface();
    // Unreachable today — every door into `overrides` already stops a
    // reserved name earlier — but kept as the invariant at the boundary that
    // actually matters, so a door added later is covered automatically.
    if (checkTokenName(name) !== null) return;
    try {
      if (preview) {
        // Capture what the app resolves *before* the write lands: once the
        // custom property is on the element, re-reading would falsely show
        // "app" and "now" agreeing.
        if (!capturedBase.has(name)) {
          const before = computedBase(name);
          if (before !== null) capturedBase.set(name, before);
        }
        const target = currentHold();
        if (target === null) {
          applyErrors.set(
            name,
            `No element matches the "${surface.id}" surface, so nothing was written to the page.`,
          );
          return;
        }
        target.write(name, value);
        // Read it back: `setProperty` reports nothing when CSSOM silently
        // rejects a declaration (e.g. `red !important`), and without this
        // check that refusal would launder into a reported success.
        //
        // Safe only because this writes custom properties exclusively
        // (`checkTokenName`'s `^--` shape): those round-trip their specified
        // value verbatim, unlike a standard property where e.g. `1.0px`
        // legitimately normalises to `1px`.
        const applied = target.element.style.getPropertyValue(name);
        if (normalise(applied) !== normalise(value)) {
          applyErrors.set(
            name,
            `The page refused this value — it reads back as ${
              applied.trim() === "" ? "empty" : `"${applied.trim()}"`
            }.`,
          );
          return;
        }
      }
      applyErrors.delete(name);
    } catch (error) {
      applyErrors.set(
        name,
        `${describeError(error, redactOptions).message} — the page did not take this value.`,
      );
      // eslint-disable-next-line no-console
      console.error(
        `[dev-toolbar/ext/theme-editor] writing "${name}" to the surface threw.`,
        error,
      );
    }
  };

  const releaseOne = (name: string): void => {
    try {
      hold?.release(name);
    } catch {
      /* the element went away; there is nothing left to restore */
    }
  };

  /**
   * Every stored edit, on. The first `writeOne` reconciles, which already
   * writes every override, so this loop rewrites them — harmless since
   * `write` records `prior` only on the first write of a name.
   */
  const applyAll = (): void => {
    for (const [name, value] of Object.entries(overrides)) writeOne(name, value);
  };

  /** Exact reversal. Used on reset, on surface change, on preview off, on teardown. */
  const releaseAll = (): void => {
    try {
      hold?.releaseAll();
    } catch {
      /* nothing left to restore */
    }
    hold = null;
  };

  /* ------------------------------------------------------------------ */
  /* Redaction — once, on the way in                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Renders one token value as the single line every surface shows. Only a
   * free `string` type is matched on its *name* too — `redact()` strips `-`
   * from keys, so an innocent `--session-panel-bg` would otherwise mask on
   * "session", but a colour/length/number can't carry a credential by name.
   * Every type still matches on the value's shape; `sensitive: true` masks
   * unconditionally.
   */
  const render = (
    name: string,
    type: TokenType,
    value: string | null,
    sensitive: boolean | undefined,
  ): { text: string; masked: boolean } => {
    if (value === null) return { text: "—", masked: false };
    if (sensitive) return { text: maskText, masked: true };
    // Kept as `unknown`, not asserted: a hostile `redactOptions` (e.g.
    // `maxDepth: 0`) can make the object walk return a tag string instead of
    // a record, hence the `typeof` guard below.
    const after: unknown =
      type === "string"
        ? (redact({ [name]: value }, redactOptions) as Record<string, unknown>)[name]
        : redact(value, redactOptions);
    const text = typeof after === "string" ? after : maskText;
    return { text, masked: text !== value };
  };

  /* ------------------------------------------------------------------ */
  /* Snapshot                                                             */
  /* ------------------------------------------------------------------ */

  const computedBase = (name: string): string | null => {
    const target = doc();
    const element = resolveElement();
    if (target === null || element === null) return null;
    const view = (target.defaultView ?? null) as Window | null;
    if (view === null || typeof view.getComputedStyle !== "function") {
      return null;
    }
    try {
      const raw = view.getComputedStyle(element).getPropertyValue(name).trim();
      return raw === "" ? null : raw;
    } catch {
      return null;
    }
  };

  const baseFor = (definition: DesignTokenDefinition, overridden: boolean): string | null => {
    if (typeof definition.value === "string") return definition.value;
    if (overridden) return capturedBase.get(definition.name) ?? null;
    const read = computedBase(definition.name);
    if (read === null) capturedBase.delete(definition.name);
    else capturedBase.set(definition.name, read);
    return read;
  };

  const buildSnapshot = (
    revision: number,
    surfaceSnapshot: ThemeSurface,
    surfaceSnapshots: readonly ThemeSurface[],
  ): ThemeSnapshot => {
    const definitions = readTokens();
    const views: TokenView[] = [];
    const seen = new Set<string>();
    let maskedCount = 0;
    let refusedCount = 0;

    for (const definition of definitions) {
      const name = definition.name;
      if (typeof name !== "string" || name === "" || seen.has(name)) continue;
      seen.add(name);
      const refusal = checkTokenName(name);
      if (refusal !== null) refusedCount += 1;
      const type = inferType(definition);
      const overridden = refusal === null && Object.prototype.hasOwnProperty.call(overrides, name);
      const override = overridden ? (overrides[name] as string) : undefined;
      const base = baseFor(definition, overridden);
      const defaultValue = definition.defaultValue ?? null;
      const effective = override ?? base;

      const effectiveRender = render(name, type, effective, definition.sensitive);
      const baseRender = render(name, type, base, definition.sensitive);
      const defaultRender = render(name, type, defaultValue, definition.sensitive);
      const masked = effectiveRender.masked || baseRender.masked || defaultRender.masked;
      if (masked) maskedCount += 1;
      const description =
        definition.description === undefined
          ? undefined
          : redact(definition.description, redactOptions);
      // The group is a JSON key in the Figma export, so a credential buried
      // in the prose is the hazard — shape-only match against a bare string.
      const rawGroup = definition.group ?? "Tokens";
      const group = redact(rawGroup, redactOptions);

      views.push({
        name,
        label: definition.label ?? humanise(name),
        ...(description === undefined ? {} : { description }),
        group,
        type,
        base,
        defaultValue,
        ...(override === undefined ? {} : { override }),
        effective,
        overridden,
        effectiveText: effectiveRender.text,
        baseText: baseRender.text,
        defaultText: defaultRender.text,
        masked,
        metadataMasked:
          (description !== undefined && description !== definition.description) ||
          group !== rawGroup,
        refusal,
        orphaned: false,
        ...(applyErrors.has(name) ? { applyError: applyErrors.get(name) as string } : {}),
      });
    }

    // Edits whose token the catalogue no longer declares. Still written to
    // the page on every mount, so they must appear here too or they'd be
    // unclearable.
    for (const name of Object.keys(overrides)) {
      if (seen.has(name)) continue;
      const value = overrides[name] as string;
      const refusal = checkTokenName(name);
      const rendered = render(name, "string", value, undefined);
      if (rendered.masked) maskedCount += 1;
      views.push({
        name,
        label: humanise(name),
        group: "No longer declared",
        type: "string",
        base: null,
        defaultValue: null,
        override: value,
        effective: value,
        overridden: true,
        effectiveText: rendered.text,
        baseText: "—",
        defaultText: "—",
        masked: rendered.masked,
        metadataMasked: false,
        refusal,
        orphaned: true,
        ...(applyErrors.has(name) ? { applyError: applyErrors.get(name) as string } : {}),
      });
    }

    const groups: { name: string; tokens: TokenView[] }[] = [];
    for (const view of views) {
      const existing = groups.find((group) => group.name === view.group);
      if (existing) existing.tokens.push(view);
      else groups.push({ name: view.group, tokens: [view] });
    }

    return {
      revision,
      tokens: views,
      groups,
      overriddenCount: views.filter((view) => view.overridden).length,
      maskedCount,
      refusedCount,
      supplied: definitions.length > 0,
      writable: resolveElement() !== null,
      surface: surfaceSnapshot,
      surfaces: surfaceSnapshots,
      preview,
      mode: readMode(),
      modeWritable: typeof mode?.set === "function",
      applyErrors: Object.fromEntries(applyErrors),
      readError,
      notice,
    };
  };

  /**
   * Nothing here may propagate: the first call runs inside the factory,
   * before core mounts, so an uncaught throw would take down the host app's
   * render instead of degrading to an error chip.
   */
  const build = (revision: number): ThemeSnapshot => {
    // A throwing surface getter degrades to the safe root because the catch must not read it again.
    let surfaceSnapshot: ThemeSurface | null = null;
    let surfaceSnapshots: readonly ThemeSurface[] | null = null;
    try {
      surfaceSnapshots = surfaces.map(copySurface);
      const selectedIndex = surfaces.indexOf(surface);
      surfaceSnapshot =
        selectedIndex === -1
          ? copySurface(surface)
          : (surfaceSnapshots[selectedIndex] as ThemeSurface);
      return buildSnapshot(revision, surfaceSnapshot, surfaceSnapshots);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        "[dev-toolbar/ext/theme-editor] building the token snapshot threw. " +
          "Showing an empty list; a getter on a token definition is the usual cause.",
        error,
      );
      const fallbackSurface = surfaceSnapshot ?? copySurface(DEFAULT_SURFACE);
      const fallbackSurfaces = surfaceSnapshots ?? [fallbackSurface];
      return {
        revision,
        tokens: [],
        groups: [],
        overriddenCount: 0,
        maskedCount: 0,
        refusedCount: 0,
        supplied: true,
        writable: false,
        surface: fallbackSurface,
        surfaces: fallbackSurfaces,
        preview,
        mode: null,
        modeWritable: false,
        applyErrors: Object.fromEntries(applyErrors),
        readError: "The token list could not be read — it threw. See the console.",
        notice,
      };
    }
  };

  const store = createDerivedStore<ThemeSnapshot>(build, {
    intervalMs: 250,
    // A per-build counter; nothing renders it.
    ignorePaths: [["revision"]],
  });

  const publish = () => {
    // Before the revision bump, so the snapshot this publishes already
    // describes the surface the edits are actually on.
    reconcileSurface();
    store.rebuild();
    store.flush();
  };

  /* ------------------------------------------------------------------ */
  /* Persistence                                                          */
  /* ------------------------------------------------------------------ */

  // Fallback is `null` ("nothing chosen yet"), not the first surface's id —
  // an explicit pick of the first surface must persist too, or reordering
  // `surfaces` later would silently move that choice onto the new first entry.
  const surfacePreference: Preference<string | null> = {
    key: SURFACE_KEY,
    encoding: "string",
    fallback: null,
    isValue: (value): value is string => surfaces.some((candidate) => candidate.id === value),
  };

  const persistOverrides = () => {
    if (!persist) return;
    writePreference(storage, OVERRIDES_PREFERENCE, JSON.stringify(overrides));
  };

  const persistPreview = (on: boolean) => {
    if (!persist) return;
    writePreference(storage, PREVIEW_PREFERENCE, on ? "1" : "0");
  };

  const persistSurface = (id: string) => {
    if (!persist) return;
    writePreference(storage, surfacePreference, id);
  };

  /* ------------------------------------------------------------------ */
  /* Foreign recipes — one sanitiser for all three doors                  */
  /* ------------------------------------------------------------------ */

  /**
   * Filters a foreign override map (from the Import box, a preset, or a
   * shared link — one trust boundary, one place to review) down to names the
   * current catalogue declares and values that pass the editor's own check.
   * A stored edit is treated differently (kept as an orphan instead) since it
   * was made against a catalogue that once existed.
   */
  const sanitize = (
    incoming: Readonly<Record<string, string>>,
  ): { accepted: Record<string, string>; dropped: number } => {
    const declared = new Map<string, TokenType>();
    for (const definition of readTokens()) {
      if (typeof definition?.name !== "string") continue;
      if (checkTokenName(definition.name) !== null) continue;
      declared.set(definition.name, inferType(definition));
    }
    const accepted = emptyMap();
    let dropped = 0;
    for (const [name, value] of Object.entries(incoming)) {
      const type = declared.get(name);
      if (type === undefined || typeof value !== "string") {
        dropped += 1;
        continue;
      }
      if (value.trim() === maskText || value.includes(MASK_SENTINEL)) {
        dropped += 1;
        continue;
      }
      if (checkTokenValue(type, value) !== null) {
        dropped += 1;
        continue;
      }
      define(accepted, name, value.trim());
    }
    return { accepted, dropped };
  };

  /** Falls back to `"string"`, the loosest type, for an orphaned token. */
  const declaredType = (name: string): TokenType => {
    const definition = readTokens().find((candidate) => candidate?.name === name);
    return definition ? inferType(definition) : "string";
  };

  /**
   * Re-checks a persisted edit map. `localStorage` is writable by any script
   * on the origin, so it can't be trusted just because we wrote it. Unlike
   * `sanitize()`, names are not filtered against the catalogue — a renamed
   * token is the developer's own work and gets an orphan row instead.
   */
  const vetStored = (
    incoming: Record<string, string>,
  ): { accepted: Record<string, string>; dropped: string[] } => {
    const accepted = emptyMap();
    const dropped: string[] = [];
    for (const [name, value] of Object.entries(incoming)) {
      // Same policy as `readStoredThemeOverrides`, which vets the same bytes
      // pre-mount — inlining the condition here is what let the two drift.
      if (checkStoredEntry(name, value, { type: declaredType(name), mask: maskText }) !== null) {
        dropped.push(name);
        continue;
      }
      define(accepted, name, value.trim());
    }
    return { accepted, dropped };
  };

  const adopt = (
    incoming: Readonly<Record<string, string>>,
    source: string,
  ): { applied: number; dropped: number } => {
    const { accepted, dropped } = sanitize(incoming);
    // Adopting a recipe *replaces* the current edits rather than merging —
    // half of one theme merged over half of another is a theme nobody
    // designed. There's no undo, so the count of what was displaced travels
    // in the notice.
    const replaced = Object.keys(overrides).length;
    releaseAll();
    for (const name of Object.keys(overrides)) notifyConsumer(name, undefined);
    overrides = accepted;
    applyErrors.clear();
    persistOverrides();
    applyAll();
    for (const [name, value] of Object.entries(overrides)) {
      notifyConsumer(name, value);
    }
    const applied = Object.keys(accepted).length;
    notice = `${[
      `${source}: ${applied} token${applied === 1 ? "" : "s"} applied`,
      dropped === 0
        ? null
        : `${dropped} dropped — this application does not declare them, or the value was refused`,
      replaced === 0 ? null : `${replaced} earlier edit${replaced === 1 ? "" : "s"} replaced`,
    ]
      .filter((clause): clause is string => clause !== null)
      .join(", ")}.`;
    publish();
    return { applied, dropped };
  };

  /* ------------------------------------------------------------------ */
  /* Exports — every one of them reads the redacted snapshot              */
  /* ------------------------------------------------------------------ */

  /** Overridden rows worth exporting, in catalogue order. */
  const exportable = (snapshot: ThemeSnapshot): readonly TokenView[] =>
    snapshot.tokens.filter((view) => view.overridden && view.refusal === null);

  const maskedNote = (count: number): string =>
    count === 0
      ? ""
      : `${count} value${count === 1 ? " was" : "s were"} masked before this left the panel`;

  const cssText = (): string => {
    const snapshot = store.read();
    const rows = exportable(snapshot);
    if (rows.length === 0) {
      return `/* No theme overrides are active. */\n`;
    }
    const masked = rows.filter((view) => view.masked).length;
    // The selector is a foreign value too, easy to miss since it looks like
    // configuration — an unprintable one falls back to `:root` rather than
    // being escaped into something that might still parse.
    const printable = isPrintableSelector(snapshot.surface.selector);
    const idText = isPrintableSelector(snapshot.surface.id)
      ? snapshot.surface.id
      : "(unprintable id)";
    const selector = printable ? snapshot.surface.selector : ":root";
    const header = [
      `/* @nejcm/dev-toolbar theme edit — surface ${idText}${printable ? ` (${selector})` : ""} */`,
      printable
        ? null
        : `/* That surface's selector cannot be printed as CSS, so this block is scoped to :root. */`,
      masked === 0 ? null : `/* ${maskedNote(masked)}. */`,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");
    const body = rows.map((view) => `  ${view.name}: ${view.effectiveText};`).join("\n");
    return `${header}\n${selector} {\n${body}\n}\n`;
  };

  /**
   * The recipe, for the two outputs meant to be *executed* — the re-imported
   * JSON and the shared link. Masked tokens are omitted (the count is stated
   * instead) rather than carried as `[redacted]`: a document a machine
   * applies must not contain a value that isn't one.
   */
  const executableRecipe = (): {
    recipe: ThemeRecipe;
    omitted: number;
  } => {
    const snapshot = store.read();
    const overridesOut: Record<string, string> = {};
    let omitted = 0;
    for (const view of exportable(snapshot)) {
      if (view.masked || view.override === undefined) {
        omitted += 1;
        continue;
      }
      define(overridesOut, view.name, view.override);
    }
    return {
      recipe: {
        schemaVersion: 1,
        name: `Theme edit ${nowIso(now())}`,
        mode: snapshot.mode ?? "light",
        surface: snapshot.surface.id,
        overrides: overridesOut,
        createdAt: nowIso(now()),
        ...(createdBy === undefined ? {} : { createdBy }),
      },
      omitted,
    };
  };

  /**
   * The exact object both executable exports serialise — one builder, so
   * they can't disagree.
   *
   * The belt-and-braces `redact()` pass runs in two pieces on purpose:
   * `recipe.overrides` is keyed by *token names*, and handing it to the
   * full-object walk would re-mask ordinary names like `--session-panel-bg`
   * (segments to `session`) into `"[redacted]"`, breaking re-import. So
   * metadata gets the full walk, while each override value is redacted on
   * its own as a bare string (shape-only matching).
   */
  const executablePayload = (): Record<string, unknown> => {
    const { recipe, omitted } = executableRecipe();
    const source: Record<string, unknown> =
      omitted === 0 ? { ...recipe } : { ...recipe, maskedValuesOmitted: omitted };

    const { overrides: rawOverrides, ...metadata } = source;
    const redactedMetadata = redact(metadata, redactOptions) as Record<string, unknown>;

    const redactedOverrides: Record<string, string> = {};
    for (const [name, value] of Object.entries((rawOverrides ?? {}) as Record<string, string>)) {
      define(redactedOverrides, name, redact(value, redactOptions));
    }

    // Rebuilt in the original key order rather than spread, so a human
    // diffing the document doesn't see it reshuffle.
    const payload: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      defineAny(payload, key, key === "overrides" ? redactedOverrides : redactedMetadata[key]);
    }
    return payload;
  };

  const recipeText = (): string => {
    try {
      return JSON.stringify(executablePayload(), null, 2);
    } catch {
      return '{ "error": "this recipe could not be serialised" }';
    }
  };

  const FIGMA_TYPE: Readonly<Record<TokenType, string>> = {
    color: "color",
    length: "dimension",
    number: "number",
    string: "string",
  };

  /**
   * The W3C Design Tokens community-group format (`$type`/`$value`, grouped)
   * that Figma Variables importers read. No plugin ships here — only this
   * deterministic, versioned half.
   */
  const figmaText = (): string => {
    const snapshot = store.read();
    const rows = exportable(snapshot);
    const out: Record<string, Record<string, unknown>> = {};
    for (const view of rows) {
      const group = (out[view.group] ??= {});
      group[view.name.replace(/^--/, "")] = {
        $type: FIGMA_TYPE[view.type],
        // The redacted display string, never the raw value.
        $value: view.effectiveText,
        ...(view.description === undefined ? {} : { $description: view.description }),
      };
    }
    // Descriptions are exported here and nowhere else, so this count includes them.
    const masked = rows.filter((view) => view.masked || view.metadataMasked).length;
    try {
      return JSON.stringify(
        {
          $description:
            `@nejcm/dev-toolbar theme edit, surface ${snapshot.surface.id}` +
            (masked === 0 ? "" : ` — ${maskedNote(masked)}`),
          ...out,
        },
        null,
        2,
      );
    } catch {
      return '{ "$description": "this export could not be serialised" }';
    }
  };

  const shareLink = (): string | null => {
    if (themeParam === null) return null;
    try {
      if (typeof location === "undefined" || typeof location.href !== "string") {
        return null;
      }
      const url = new URL(location.href);
      url.searchParams.set(themeParam, JSON.stringify(executablePayload()));
      return url.toString();
    } catch {
      return null;
    }
  };

  /**
   * Before/after comparison, done by *removing* the edits rather than
   * rendering a second copy of the application. Edits stay in state and
   * storage; only the surface is restored, via the same exact-reversal path
   * teardown uses.
   */
  const setPreview = (on: boolean): void => {
    if (preview === on) return;
    preview = on;
    persistPreview(on);
    if (on) applyAll();
    else releaseAll();
    notice = on
      ? null
      : "Preview off — your edits are kept but the page is showing the application's own values.";
    publish();
  };

  /* ------------------------------------------------------------------ */
  /* Public surface                                                       */
  /* ------------------------------------------------------------------ */

  return {
    store,
    storage: () => storage,
    refresh: publish,
    overrides: () => ({ ...overrides }),
    presets: readPresets,

    setOverride(name, value) {
      if (checkTokenName(name) !== null) return "syntax";
      const definition = readTokens().find((candidate) => candidate?.name === name);
      const type = definition ? inferType(definition) : "string";
      const refusal = checkTokenValue(type, value);
      if (refusal !== null) return refusal;
      const trimmed = value.trim();
      overrides = cloneMap(overrides);
      define(overrides, name, trimmed);
      persistOverrides();
      writeOne(name, trimmed);
      notifyConsumer(name, trimmed);
      notice = null;
      publish();
      return null;
    },

    clearOverride(name) {
      if (!Object.prototype.hasOwnProperty.call(overrides, name)) return;
      const next = cloneMap(overrides);
      delete next[name];
      overrides = next;
      persistOverrides();
      releaseOne(name);
      capturedBase.delete(name);
      // No `applyErrors.delete` here: a *failed* release must keep its error
      // — the page is still rendering a value the panel just stopped claiming.
      notifyConsumer(name, undefined);
      notice = null;
      publish();
    },

    resetAll() {
      const names = Object.keys(overrides);
      overrides = emptyMap();
      persistOverrides();
      // Exact reversal, unconditionally: `releaseAll` restores whatever was
      // displaced rather than checking a flag that could disagree with the DOM.
      releaseAll();
      applyErrors.clear();
      for (const name of names) notifyConsumer(name, undefined);
      capturedBase.clear();
      notice =
        names.length === 0
          ? "Nothing to reset."
          : `Reset — ${names.length} edit${names.length === 1 ? "" : "s"} removed and the surface restored.`;
      publish();
    },

    setPreview,
    togglePreview: () => setPreview(!preview),

    selectSurface(id) {
      const next = surfaces.find((candidate) => candidate.id === id);
      if (next === undefined || next.id === surface.id) return;
      releaseAll();
      surface = next;
      capturedBase.clear();
      persistSurface(next.id);
      applyAll();
      notice = `Surface: ${next.label ?? next.id}.`;
      publish();
    },

    setMode(next) {
      if (typeof mode?.set !== "function") return;
      try {
        mode.set(next);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("[dev-toolbar/ext/theme-editor] the mode adapter's set() threw.", error);
        notice = "The application's mode adapter refused that change.";
      }
      publish();
    },

    importRecipe(raw) {
      const { recipe, error } = parseRecipe(raw);
      if (recipe === null) {
        notice = `Import refused — ${error ?? "unreadable."}`;
        publish();
        return { applied: 0, dropped: 0, error };
      }
      const result = adopt(recipe.overrides, `Imported "${recipe.name}"`);
      return { ...result, error: null };
    },

    applyPreset(name) {
      const preset = readPresets().find((candidate) => candidate?.name === name);
      if (preset === undefined) return false;
      adopt(preset.overrides ?? {}, `Preset "${preset.name}"`);
      return true;
    },

    cssText,
    recipeText,
    figmaText,
    shareLink,

    diagnostics() {
      const snapshot = store.read();
      const payload = {
        generatedAt: nowIso(now()),
        surface: snapshot.surface.id,
        preview: snapshot.preview,
        mode: snapshot.mode,
        overriddenCount: snapshot.overriddenCount,
        maskedCount: snapshot.maskedCount,
        refusedCount: snapshot.refusedCount,
        overrides: snapshot.tokens
          .filter((view) => view.overridden)
          .map((view) => ({
            name: view.name,
            // The redacted display strings, never the raw values.
            value: view.effectiveText,
            was: view.baseText,
            masked: view.masked,
            orphaned: view.orphaned,
          })),
      };
      return redact(payload, redactOptions);
    },

    start(api: ExtensionRuntimeApi) {
      storage = api.storage;
      active = true;

      if (persist) {
        // The null fallback preserves the session surface when storage cannot answer.
        const storedSurface = readPreference(storage, surfacePreference);
        const found = surfaces.find((candidate) => candidate.id === storedSurface);
        if (found) surface = found;
        const storedPreview = readPreferenceIfReadable(storage, PREVIEW_PREFERENCE);
        // A failed read must preserve session choices; a missing key restores preview on.
        if (storedPreview.readable) preview = storedPreview.value !== "0";
      }

      // The kill switch runs before anything is applied, so an edit that made
      // the page unreadable never reaches it on the reset load.
      // The param is removed once the empty map is stored. A recipe on the same
      // param is left alone — only the kill-switch value is a reset.
      if (themeParam !== null && resetRequested(themeParam)) {
        overrides = emptyMap();
        persistOverrides();
        notice = `Every theme edit was cleared by ?${themeParam}=reset.`;
        stripResetParam(themeParam);
      } else {
        const storedOverrides = readPreferenceIfReadable(
          persist ? storage : null,
          OVERRIDES_PREFERENCE,
        );
        if (storedOverrides.readable) {
          const vetted = vetStored(parseOverrides(storedOverrides.value));
          overrides = vetted.accepted;
          if (vetted.dropped.length > 0) {
            // Persist the cleaned map so refused entries aren't re-read and
            // re-refused on every load.
            persistOverrides();
            notice = `${vetted.dropped.length} stored edit${
              vetted.dropped.length === 1 ? " was" : "s were"
            } dropped as unusable: ${vetted.dropped.join(", ")}.`;
          }
        }

        // Re-apply on every mount: the page reloaded with the application's own
        // values, and this is what makes an edit outlive the tab.
        applyAll();
        for (const [name, value] of Object.entries(overrides)) {
          notifyConsumer(name, value);
        }

        // A shared recipe in the URL is adopted *after* the stored edits, so a
        // link wins over what was already here — which is what somebody sending
        // you one means. It goes through the same sanitiser as everything else.
        const param = themeParamValue(themeParam);
        if (param !== null && param !== "" && !resetRequested(themeParam)) {
          const { recipe, error } = parseRecipe(param);
          if (recipe === null) {
            notice = `The theme in this URL was refused — ${error ?? "unreadable."}`;
          } else {
            adopt(recipe.overrides, `Shared link "${recipe.name}"`);
          }
        }
      }

      // A *static* catalogue on a non-`:root` surface still needs the timer:
      // the poll is the only thing that notices an SPA replacing the element
      // the edits are written to. `:root` alone is never replaced.
      const needsPoll =
        typeof tokens === "function" || surfaces.some((entry) => entry.selector !== ":root");
      const stopPolling = needsPoll
        ? createPoller(publish, {
            intervalMs: pollMs,
            fallbackMs: 1000,
            signal: api.signal,
          })
        : () => {};

      // Visibility is reported, not acted on: edits stay applied while the
      // bar is hidden, and this only re-publishes so the panel is current
      // when the bar comes back.
      const stopWatching = api.subscribeVisibility(() => publish());
      publish();

      // The store belongs to the runtime, not to one start/stop cycle: React
      // StrictMode runs mount → cleanup → mount, and destroying it on the
      // first cleanup would freeze the panel.
      const dispose = () => {
        // Before `releaseAll`, so a `publish` racing the teardown cannot
        // reconcile the edits straight back onto the page.
        active = false;
        stopPolling();
        stopWatching();
        // Unmounting the toolbar must leave the page exactly as it found it.
        // Unconditional, and by restoring what we displaced rather than by
        // deleting what we think we wrote.
        releaseAll();
      };
      api.signal.addEventListener("abort", dispose, { once: true });
      return dispose;
    },
  };
}
