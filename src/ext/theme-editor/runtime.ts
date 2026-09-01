/**
 * Everything `/ext/theme-editor` owns that is not React.
 * [dev-toolbar/ext/theme-editor]
 *
 * Built by `themeEditor()`, not by `start(api)` — slot functions run during the
 * toolbar's first render, before any effect fires, so the store the chip reads
 * has to exist by the time the factory returns. Seventh extension, seventh time
 * this is the first thing to know.
 *
 * This one combines the two hazards the phases before it met separately.
 *
 * **It mutates the application, like `/ext/flags`.** An edit changes what the
 * app looks like, it outlives the tab, and it is applied by writing to the host
 * document. So: every write is wrapped and the failure is recorded per token
 * rather than swallowed; anything applied is also displayed, orphans included;
 * and there is a kill switch (`?dtb-theme=reset`) that runs before any override
 * is applied, because the edit that makes the page unreadable is exactly the one
 * you cannot see the panel to remove.
 *
 * **It touches the host's CSS, like `/ext/overlays`.** So the reversal is
 * *exact*, not approximate: the inline value each property had before we first
 * wrote it is recorded and restored, and an element that had no `style`
 * attribute at all gets back to having none — because `setProperty` followed by
 * `removeProperty` leaves `style=""` behind, and "almost byte-identical" is the
 * kind of residue that turns into a bug report about a diff.
 *
 * One rule it takes from **neither**: hiding the bar does not revert the edits.
 * `/ext/overlays` detaches everything on `subscribeVisibility(false)` because a
 * drawing surface that is not rendered should not be measured for. An override
 * is not a drawing; it is a state the developer chose, and a toolbar that
 * repainted the application every time you pressed the hide shortcut would be
 * unusable. Core reports visibility and never acts on it (§2) precisely so each
 * extension can make this call for itself, and the two answers here are
 * opposite for good reasons.
 */
import { createThrottledStore, redact } from "../../runtime";
import type { RedactOptions, ThrottledStore } from "../../runtime";
import type { ExtensionRuntimeApi, ToolbarStorage } from "../../core/contract";
import {
  DEFAULT_SURFACE,
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

/** Query parameter carrying a shared recipe, or the word `reset`. */
export const DEFAULT_THEME_PARAM = "dtb-theme";

/** The literal `/runtime` mask, refused as an incoming value. See `sanitize`. */
const MASK_SENTINEL = "[redacted]";

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
   * property onto the surface element. `value === undefined` means the token no
   * longer has a local edit.
   *
   * Supplying this does **not** stop the extension from writing to the surface;
   * it runs alongside, so a consumer who wants to mirror the edit into their own
   * theme provider can, without losing the live preview. Return nothing.
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
  /** Persist edits through `api.storage`. Default `true`. */
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
  /** `null` until `start(api)` runs. */
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

const nowIso = (at: number): string => {
  // §15.3: whatever the failure branch touches may only touch things that
  // cannot produce the failure it is handling. A patched `Date` must not turn
  // "the export failed" into a throw out of a click handler.
  try {
    return new Date(at).toISOString();
  } catch {
    return "unknown";
  }
};

const emptyMap = (): Record<string, string> =>
  Object.create(null) as Record<string, string>;

const cloneMap = (source: Record<string, string>): Record<string, string> =>
  Object.assign(emptyMap(), source);

/** Own data property, by definition rather than assignment. See §12.5. */
function define(
  target: Record<string, string>,
  key: string,
  value: string,
): void {
  defineAny(target as Record<string, unknown>, key, value);
}

/** The same, for a payload whose values are not all strings. */
function defineAny(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/**
 * True when the URL asks for every edit to be dropped.
 *
 * Exported for the same reason `/ext/flags` exports its equivalent: the edit
 * that makes the application unreadable also hides the panel you would use to
 * remove it, and "clear your localStorage" is not an escape hatch you can talk
 * a colleague through.
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
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const output = emptyMap();
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string") define(output, key, value);
  }
  return output;
}

/**
 * Reads the persisted edit map **without mounting anything**.
 *
 * The reason `/ext/flags` has the same function: the extension re-applies its
 * overrides in `start()`, inside an effect, so an app that builds its own theme
 * object before React mounts would otherwise disagree with the panel for one
 * paint. Honours `?dtb-theme=reset` for the same reason `start()` does.
 */
export function readStoredThemeOverrides(
  options: {
    instanceId?: string;
    id?: string;
    storage?: ToolbarStorage;
    themeParam?: string | null;
  } = {},
): Record<string, string> {
  const {
    instanceId = "default",
    id = "theme-editor",
    storage,
    themeParam = DEFAULT_THEME_PARAM,
  } = options;
  if (resetRequested(themeParam)) return {};
  const key = `dtb:v1:${instanceId}:ext:${id}:${OVERRIDES_KEY}`;
  try {
    const source =
      storage ?? (typeof localStorage === "undefined" ? null : localStorage);
    if (source === null) return {};
    // A spread copy, never the null-prototype map: handing that across a public
    // API breaks `result.hasOwnProperty(...)` for every consumer (§12.5).
    return { ...parseOverrides(source.getItem(key)) };
  } catch {
    return {};
  }
}

/* -------------------------------------------------------------------------- */
/* The surface — the one place this extension touches the host document        */
/* -------------------------------------------------------------------------- */

interface PriorDeclaration {
  value: string;
  priority: string;
}

/**
 * Owns the inline custom properties written to one element, and the record of
 * what that element's inline style said before we touched it.
 *
 * Nothing about this is stored in a module variable: two toolbars on one page,
 * or two bundled copies of this extension, are separate closures, and the one
 * thing they share is the element. Each holder therefore only ever restores the
 * value **it** displaced, which composes correctly with a second holder that
 * displaced a different token.
 *
 * For the *same* token it is weaker than that, and the honest statement is that
 * a release **can restore a displaced value**: if A writes `--x` (prior `""`)
 * and B then writes `--x` (prior: A's value), tearing down A before B leaves
 * A's value live with nobody holding it. That is inherent to any per-closure
 * inline-restore scheme — the alternative is shared module state, which §2 rules
 * out and which composes worse across two bundled copies — and it needs two
 * toolbars editing the same token on the same surface to reach. Recorded rather
 * than fixed; do not read "last-writer-wins" into it.
 */
class SurfaceHold {
  readonly element: HTMLElement;
  /**
   * Whether the element already had a `style` attribute — even an empty one —
   * when this hold was created.
   *
   * The one case it decides, and the reason it is not redundant with the
   * `style.length` check in `tidy()`: an element carrying `style=""` and nothing
   * else. That attribute is inert but it is not ours, `[style]` is a legal
   * selector, and an extension whose headline claim is exact reversal does not
   * get to remove things it did not add. `style.length > 0` covers the other
   * case — somebody else's *declarations* on the same element — and the two
   * together are exhaustive.
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
    for (const name of [...this.prior.keys()]) this.release(name);
    this.tidy();
  }

  get size(): number {
    return this.prior.size;
  }

  /**
   * The residue nobody expects. `setProperty` on an element with no `style`
   * attribute creates one; `removeProperty` empties it but leaves `style=""`
   * behind. A test that compares the application's markup byte-for-byte before
   * and after — which is the only kind of test that means anything for a claim
   * of exact reversal — fails on that, and it should.
   */
  private tidy(): void {
    // No `prior.size` check: while anything is still held its own declaration is
    // still on the element, so `style.length` already says no. An extra guard
    // that no test can distinguish from the one next to it is the §14.7 problem
    // in miniature — a rule only ever compared to itself.
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
    redactOptions,
    themeParam = DEFAULT_THEME_PARAM,
    persist = true,
    now = Date.now,
    document: injectedDocument,
    createdBy,
  } = options;

  const surfaces: readonly ThemeSurface[] =
    surfaceOption && surfaceOption.length > 0
      ? surfaceOption
      : [DEFAULT_SURFACE];

  const maskText = redactOptions?.mask ?? MASK_SENTINEL;

  let revision = 0;
  let storage: ToolbarStorage | null = null;
  let overrides = emptyMap();
  let surface: ThemeSurface = surfaces[0] as ThemeSurface;
  let preview = true;
  let hold: SurfaceHold | null = null;
  let notice: string | null = null;
  let readError: string | null = null;
  /** Per token, not one slot — the §12.4 lesson, which cost a real defect there. */
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
      readError =
        "The token list could not be read — it threw. See the console.";
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
      const value =
        typeof presetOption === "function" ? presetOption() : presetOption;
      return Array.isArray(value) ? (value as readonly ThemeRecipe[]) : [];
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        "[dev-toolbar/ext/theme-editor] the supplied presets getter threw.",
        error,
      );
      return [];
    }
  };

  const readMode = (): ThemeMode | null => {
    if (mode === undefined) return null;
    try {
      return mode.read() === "dark" ? "dark" : "light";
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        "[dev-toolbar/ext/theme-editor] the mode adapter's read() threw.",
        error,
      );
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
      // A surface inside a dev toolbar — ours or anybody else's — is refused.
      // The name guard already stops `--dtb-*` reaching any element, so this is
      // belt and braces; it is here because "write the app's tokens onto the
      // toolbar" is never what somebody meant, and silently doing nothing
      // useful is worse than saying no.
      if (
        typeof found.closest === "function" &&
        found.closest("[data-dev-toolbar]") !== null
      ) {
        return null;
      }
      return found;
    } catch {
      // An invalid selector throws from `querySelector`.
      return null;
    }
  };

  /**
   * True when `currentHold()` has just moved to a *different* element and the
   * other edits therefore need re-applying. Read and cleared by `writeOne()`.
   */
  let surfaceReplaced = false;
  /** Reentrancy guard for the re-apply, which calls `writeOne()` again. */
  let remigrating = false;

  const currentHold = (): SurfaceHold | null => {
    const element = resolveElement();
    if (element === null) return null;
    if (hold !== null && hold.element === element) return hold;
    // A *replacement*, not the first acquisition: only the former leaves edits
    // stranded on a node that is no longer in the document.
    if (hold !== null) {
      hold.releaseAll();
      surfaceReplaced = true;
    }
    hold = new SurfaceHold(element);
    return hold;
  };

  /**
   * Calls the consumer's optional adapter. It is consumer code running inside
   * our click handler, so it is wrapped — and the failure is *recorded*, never
   * swallowed: a row that says "edited" while the app never heard about it is
   * exactly the lie §11.3 and §12.4 are about.
   */
  const notifyConsumer = (name: string, value: string | undefined): void => {
    if (typeof onApply !== "function") return;
    try {
      onApply(name, value);
    } catch (error) {
      applyErrors.set(
        name,
        `${
          error instanceof Error ? error.message : String(error)
        } — your application's own onApply did not accept this edit.`,
      );
      // eslint-disable-next-line no-console
      console.error(
        `[dev-toolbar/ext/theme-editor] the onApply adapter threw for "${name}".`,
        error,
      );
    }
  };

  const writeOne = (name: string, value: string): void => {
    // The bleed invariant, enforced at the single funnel every write passes
    // through. As of the `vetStored` fix this line is **unreachable**: all four
    // doors into `overrides` stop a reserved name earlier — `setOverride`
    // refuses it, `sanitize` keeps only catalogue names (and a reserved name is
    // never in the catalogue's `declared` map), `vetStored` drops it on load,
    // and the URL goes through `sanitize`. Each of those is pinned by its own
    // test, and the property test below asserts the invariant across all of
    // them at once.
    //
    // It stays anyway, and the reasoning is worth writing down because it is
    // the opposite of the call made two guards ago. An unreachable branch in
    // the *UI* was deleted (§14.7: a rule only ever compared to itself is not
    // tested). This one is different in kind: it is not a second opinion about
    // a case somebody else already handled, it is the invariant stated at the
    // boundary where it actually matters, so a *fifth* door added later is
    // covered without anybody remembering to filter it. The cost of being
    // wrong here is that an app edit repaints the toolbar.
    if (checkTokenName(name) !== null) return;
    try {
      if (preview) {
        // Capture what the application resolves *before* the write lands. Once
        // the custom property is on the element the computed value is our own
        // edit, and a panel that re-read it would show "app" and "now" agreeing
        // on every row — the §12.1 trap, which is why `/ext/flags` takes the
        // pre-override value from the consumer rather than deriving it.
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
        // The surface element was replaced — an SPA re-rendered the subtree
        // this surface selects — and the hold that had the *other* edits went
        // with it. Writing only the token the developer just touched would
        // leave every other row claiming `override ?? base` while the page had
        // reverted to the application's own values: §12.4's honesty rule in
        // reverse, and invisible, because the panel is the thing that would be
        // wrong. So a migration re-applies everything.
        //
        // Cannot bite the default `:root` surface, which is never replaced.
        if (surfaceReplaced && !remigrating) {
          surfaceReplaced = false;
          remigrating = true;
          try {
            for (const [other, otherValue] of Object.entries(overrides)) {
              if (other !== name) writeOne(other, otherValue);
            }
          } finally {
            remigrating = false;
          }
        }
      }
      applyErrors.delete(name);
    } catch (error) {
      applyErrors.set(
        name,
        `${error instanceof Error ? error.message : String(error)} — the page did not take this value.`,
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

  /** Every stored edit, on. Used on start, on surface change and on preview on. */
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
   * Renders one token value as the single line every surface shows.
   *
   * The type decides whether key matching applies at all, and that is not a
   * nicety. `redact()` normalises a key by stripping `-`, so a perfectly
   * innocent `--session-panel-bg` contains `session` and would be masked — in an
   * editor, that means the token you most need to see is the one you cannot.
   * A colour, a length and a number **cannot carry a credential**, which is the
   * same argument `/ext/flags` makes for booleans and numbers (§12.6). So:
   *
   * - every type is still matched on the *value's shape* — a `Bearer …`, a JWT
   *   or a URL with a token in its query masks whatever the token is called;
   * - only a free `string` token is additionally matched on its **name**;
   * - `sensitive: true` masks anything, unconditionally.
   */
  const render = (
    name: string,
    type: TokenType,
    value: string | null,
    sensitive: boolean | undefined,
  ): { text: string; masked: boolean } => {
    if (value === null) return { text: "—", masked: false };
    if (sensitive) return { text: maskText, masked: true };
    const after =
      type === "string"
        ? ((redact({ [name]: value }, redactOptions) as Record<string, unknown>)[
            name
          ] as string)
        : (redact(value, redactOptions) as string);
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

  const baseFor = (
    definition: DesignTokenDefinition,
    overridden: boolean,
  ): string | null => {
    if (typeof definition.value === "string") return definition.value;
    if (overridden) return capturedBase.get(definition.name) ?? null;
    const read = computedBase(definition.name);
    if (read === null) capturedBase.delete(definition.name);
    else capturedBase.set(definition.name, read);
    return read;
  };

  const buildSnapshot = (): ThemeSnapshot => {
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
      const overridden =
        refusal === null &&
        Object.prototype.hasOwnProperty.call(overrides, name);
      const override = overridden ? (overrides[name] as string) : undefined;
      const base = baseFor(definition, overridden);
      const defaultValue = definition.defaultValue ?? null;
      const effective = override ?? base;

      const effectiveRender = render(
        name,
        type,
        effective,
        definition.sensitive,
      );
      const baseRender = render(name, type, base, definition.sensitive);
      const defaultRender = render(
        name,
        type,
        defaultValue,
        definition.sensitive,
      );
      const masked =
        effectiveRender.masked || baseRender.masked || defaultRender.masked;
      if (masked) maskedCount += 1;
      const description =
        definition.description === undefined
          ? undefined
          : (redact(definition.description, redactOptions) as string);
      // The group is a JSON *key* in the Figma export, so injection is not the
      // hazard — prose carrying a credential is, exactly as for the description.
      // Shape-only, because a bare string has no key to match against.
      const rawGroup = definition.group ?? "Tokens";
      const group = redact(rawGroup, redactOptions) as string;

      views.push({
        name,
        label: definition.label ?? humanise(name),
        // Redacted like a value, and once: the panel and the Figma export read
        // the same string. `redact()` on a bare string is value-shape matching
        // only, which is the honest reach here — a credential a consumer buried
        // mid-sentence is beyond an anchored matcher (§15.3), but a description
        // that *is* a callback URL with a token in its query is not, and not
        // calling the redactor at all is a different failure from calling it
        // and missing.
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
          (description !== undefined &&
            description !== definition.description) ||
          group !== rawGroup,
        refusal,
        orphaned: false,
        ...(applyErrors.has(name)
          ? { applyError: applyErrors.get(name) as string }
          : {}),
      });
    }

    // Edits whose token the catalogue no longer declares. They are still being
    // written to the page on every mount, so leaving them out would make them
    // invisible *and* unclearable — `/ext/flags`' §12.4 lesson, which is a
    // general rule for anything that writes: **anything you apply must appear
    // in what you display**, or the display is a subset pretending to be whole.
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
        ...(applyErrors.has(name)
          ? { applyError: applyErrors.get(name) as string }
          : {}),
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
      surface,
      surfaces,
      preview,
      mode: readMode(),
      modeWritable: typeof mode?.set === "function",
      applyErrors: Object.fromEntries(applyErrors),
      readError,
      notice,
    };
  };

  /**
   * Nothing here may propagate. The first `build()` runs inside the factory —
   * before core has mounted anything — so a throw there does not degrade to an
   * error chip, it takes down the host application's render. The later ones run
   * inside a `setInterval`, where nobody can catch them at all.
   */
  const build = (): ThemeSnapshot => {
    try {
      return buildSnapshot();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        "[dev-toolbar/ext/theme-editor] building the token snapshot threw. " +
          "Showing an empty list; a getter on a token definition is the usual cause.",
        error,
      );
      return {
        revision,
        tokens: [],
        groups: [],
        overriddenCount: 0,
        maskedCount: 0,
        refusedCount: 0,
        supplied: true,
        writable: false,
        surface,
        surfaces,
        preview,
        mode: null,
        modeWritable: false,
        applyErrors: Object.fromEntries(applyErrors),
        readError:
          "The token list could not be read — it threw. See the console.",
        notice,
      };
    }
  };

  const signature = (snapshot: ThemeSnapshot): string =>
    `${snapshot.readError ?? ""}|${snapshot.notice ?? ""}|${snapshot.preview ? 1 : 0}|` +
    `${snapshot.surface.id}|${snapshot.mode ?? ""}|${snapshot.writable ? 1 : 0}|` +
    snapshot.tokens
      .map(
        (view) =>
          `${view.name}=${view.effectiveText}:${view.baseText}:${view.defaultText}:` +
          `${view.overridden ? 1 : 0}:${view.orphaned ? 1 : 0}:${view.refusal ?? ""}:${view.applyError ?? ""}`,
      )
      .join("|");

  const store = createThrottledStore<ThemeSnapshot>(build(), {
    intervalMs: 250,
    equals: (a, b) => signature(a) === signature(b),
  });

  // `revision` advances when a snapshot is *published*, not when one is built:
  // the export helpers build without publishing, and bumping there would make
  // the revision a count of reads.
  const publish = () => {
    revision += 1;
    store.set(build());
    store.flush();
  };

  /* ------------------------------------------------------------------ */
  /* Persistence                                                          */
  /* ------------------------------------------------------------------ */

  const persistOverrides = () => {
    if (!persist || storage === null) return;
    try {
      if (Object.keys(overrides).length === 0) {
        storage.removeItem(OVERRIDES_KEY);
      } else {
        storage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
      }
    } catch {
      // A custom adapter is consumer code. Losing persistence is survivable;
      // throwing out of a click handler is not.
    }
  };

  const persistScalar = (key: string, value: string) => {
    if (!persist || storage === null) return;
    try {
      storage.setItem(key, value);
    } catch {
      /* see above */
    }
  };

  /* ------------------------------------------------------------------ */
  /* Foreign recipes — one sanitiser for all three doors                  */
  /* ------------------------------------------------------------------ */

  /**
   * Filters a foreign override map down to what this application actually
   * declares and this editor will actually write.
   *
   * Three doors lead here — the panel's Import box, a preset, and a shared
   * link — and they all get the same treatment, which is the point: a link is
   * not a new trust boundary, it is the same one, so there is one place to
   * review rather than three.
   *
   * - **Only names the current catalogue declares.** An unknown name would let
   *   a link write an arbitrary custom property onto the page. A *stored* edit
   *   is treated differently — it is applied and shown as an orphan — because
   *   it was made here, against a catalogue that existed, and refusing to apply
   *   it would silently discard the developer's own work.
   * - **Only values that pass the same check the editor applies.** That is what
   *   keeps `url(…)` — an outbound request from somebody else's link — out.
   * - **Never the mask itself.** A redacted export re-imported would otherwise
   *   pin a token to the literal string `[redacted]`.
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

  /**
   * The type this application declares for a token, for validating a value that
   * did not come through an editor. `"string"` — the loosest — when the token is
   * not in the catalogue, because an orphan still has to be checked and there is
   * nothing to check it against.
   */
  const declaredType = (name: string): TokenType => {
    const definition = readTokens().find(
      (candidate) => candidate?.name === name,
    );
    return definition ? inferType(definition) : "string";
  };

  /**
   * Re-checks a persisted edit map.
   *
   * **Storage is a fourth door, and it was the one I under-treated.** The panel,
   * a pasted recipe and a link all go through `sanitize()`; `parseOverrides()`
   * accepted any string, on the reasoning that this map was written by us. It is
   * not: `localStorage` is writable by every script on the origin and by anyone
   * who has been told to paste something into a console. An unchecked value
   * reached two places it must not — `element.style.setProperty`, where the
   * CSSOM accepts a custom-property value of nearly any shape and
   * `red; background: url(…)` landed in the inline style attribute verbatim; and
   * `cssText`, which printed it into a stylesheet somebody pastes into their app.
   *
   * Names are deliberately **not** filtered against the catalogue here, unlike
   * `sanitize()`: an edit whose token has been renamed is the developer's own
   * work and gets an orphan row (§12.4). It is the *value* that is foreign.
   */
  const vetStored = (
    incoming: Record<string, string>,
  ): { accepted: Record<string, string>; dropped: string[] } => {
    const accepted = emptyMap();
    const dropped: string[] = [];
    for (const [name, value] of Object.entries(incoming)) {
      if (
        // A **reserved** name is dropped here, unlike an orphan. The two look
        // similar and are not: an orphan is applicable — the catalogue may name
        // it again tomorrow — while a reserved name can never be written by
        // anything, so keeping it is pure residue. And residue with no exit: it
        // survived every reload, `writeOne` refused it every time, and its row
        // offered no per-row clear, because a refused row has no editor. Only
        // "Reset everything" or the kill switch removed it.
        checkTokenName(name) !== null ||
        value.trim() === maskText ||
        value.includes(MASK_SENTINEL) ||
        checkTokenValue(declaredType(name), value) !== null
      ) {
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
    // Adopting a recipe *replaces* the current edits rather than merging into
    // them — a recipe is a whole theme, and half of one merged over half of
    // another is a theme nobody designed. But `sanitize()`'s own reasoning two
    // functions up is that the developer's work is not silently discarded, so
    // the count of what was displaced travels in the notice. There is no undo;
    // the honest thing is to say what happened, in the same sentence.
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
      replaced === 0
        ? null
        : `${replaced} earlier edit${replaced === 1 ? "" : "s"} replaced`,
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
    snapshot.tokens.filter(
      (view) => view.overridden && view.refusal === null,
    );

  const maskedNote = (count: number): string =>
    count === 0
      ? ""
      : `${count} value${count === 1 ? " was" : "s were"} masked before this left the panel`;

  const cssText = (): string => {
    const snapshot = build();
    const rows = exportable(snapshot);
    if (rows.length === 0) {
      return `/* No theme overrides are active. */\n`;
    }
    const masked = rows.filter((view) => view.masked).length;
    // The selector is a *third* foreign half of this join, and the one that is
    // easiest to miss because it looks like configuration rather than data. It
    // is printed, so it is checked; an unprintable one falls back to `:root`
    // and the comment says so, rather than being escaped into something that
    // might still parse. Same for the id, which is printed in the comment.
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
    // Both halves of this join are foreign (§15.3). The name is *validated* —
    // `checkTokenName` has already refused anything that could close the
    // declaration — and the value is *redacted*, which is `effectiveText`.
    // Neither treatment substitutes for the other.
    const body = rows
      .map((view) => `  ${view.name}: ${view.effectiveText};`)
      .join("\n");
    return `${header}\n${selector} {\n${body}\n}\n`;
  };

  /**
   * The recipe, for the two outputs that are meant to be **executed** — the
   * JSON a developer re-imports, and the shared link.
   *
   * Masked tokens are *omitted* rather than carried as `[redacted]`, and the
   * count is stated. That is the opposite of what `cssText` and `figmaText` do,
   * and the difference is the point: a document a human reads should say that
   * something was hidden from them, and a document a machine applies must not
   * contain a value that is not a value. Carrying the mask into an executable
   * document is how a token ends up literally set to `[redacted]`.
   */
  const executableRecipe = (): {
    recipe: ThemeRecipe;
    omitted: number;
  } => {
    const snapshot = build();
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
   * The exact object both executable exports serialise — the recipe JSON and
   * the share link. One builder, so they cannot disagree about what they carry.
   *
   * The belt-and-braces `redact()` pass is applied in **two pieces**, and that
   * split is the whole point of this function.
   *
   * `redact()` walks an object graph and matches *every* key it meets by
   * substring, at every depth. `recipe.overrides` is keyed by **token names**,
   * so handing the whole payload to it re-applies, one level down, exactly the
   * treatment §16.3 classified out: `--sidebar-bg` normalises to `sidebarbg`
   * and contains `sid`; `--spinner-size` contains `pin`. Both came back as
   * `"[redacted]"` in a document a machine applies — while the panel and
   * `cssText()` showed the real values — and re-importing that recipe applied
   * nothing at all, because `sanitize()` refuses the mask sentinel. A total
   * round-trip loss, on ordinary token names, from a pass that was only ever
   * meant to be a safety net.
   *
   * So: the metadata goes through the object walk, because that is the pass
   * that catches a *structural field of our own* whose name collides (it is how
   * `maskedValuesOmitted` was found); and each override value goes through
   * `redact()` **on its own, as a bare string**, which is value-shape matching
   * and nothing else. Idempotent by construction — every value here already
   * survived `render()`'s classified pass, so a second shape-only look cannot
   * change it — and it stays a genuine second line of defence rather than a
   * corrupting one.
   *
   * The rule this sharpens, for §15.3:
   *
   * > A blanket redaction pass downstream of a *classified* join re-applies the
   * > treatment the classification withheld. Belt-and-braces redaction must be
   * > shape-only, or key-exempted, downstream of a classified join.
   */
  const executablePayload = (): Record<string, unknown> => {
    const { recipe, omitted } = executableRecipe();
    const source: Record<string, unknown> =
      omitted === 0 ? { ...recipe } : { ...recipe, maskedValuesOmitted: omitted };

    const { overrides: rawOverrides, ...metadata } = source;
    const redactedMetadata = redact(metadata, redactOptions) as Record<
      string,
      unknown
    >;

    const redactedOverrides: Record<string, string> = {};
    for (const [name, value] of Object.entries(
      (rawOverrides ?? {}) as Record<string, string>,
    )) {
      define(redactedOverrides, name, redact(value, redactOptions) as string);
    }

    // Rebuilt in the original key order rather than spread, so the document a
    // human diffs does not reshuffle because of how it was assembled.
    const payload: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      defineAny(
        payload,
        key,
        key === "overrides" ? redactedOverrides : redactedMetadata[key],
      );
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
   * §3H's Figma pipeline, the half this package can honestly ship.
   *
   * The shape is the W3C Design Tokens community-group format — `$type` /
   * `$value`, grouped — which is what the Figma Variables importers read. What
   * is *not* here is the plugin: §3H's flow ends "import with Figma plugin",
   * and writing one is a different product. What ships is the deterministic,
   * versioned, validated half, and the panel says exactly that rather than
   * implying a pipeline that does not exist.
   */
  const figmaText = (): string => {
    const snapshot = build();
    const rows = exportable(snapshot);
    const out: Record<string, Record<string, unknown>> = {};
    for (const view of rows) {
      const group = (out[view.group] ??= {});
      group[view.name.replace(/^--/, "")] = {
        $type: FIGMA_TYPE[view.type],
        // The redacted display string, never the raw value: an export is a
        // second front door onto the same data (§11.3).
        $value: view.effectiveText,
        ...(view.description === undefined
          ? {}
          : { $description: view.description }),
      };
    }
    // Descriptions are exported here and nowhere else, so this count — unlike
    // the CSS one — has to include them. §15.3: whatever describes the output
    // is computed from the output, not from a neighbouring number.
    const masked = rows.filter(
      (view) => view.masked || view.metadataMasked,
    ).length;
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
      // The same object `recipeText()` serialises. These are the two documents
      // something *applies*, so a difference between them is a bug by
      // definition — and there was one: the link carried raw values while the
      // recipe carried masks. One builder makes them agree by construction.
      url.searchParams.set(themeParam, JSON.stringify(executablePayload()));
      return url.toString();
    } catch {
      return null;
    }
  };

  /**
   * §3H's before/after comparison, done by *removing* the edits rather than by
   * rendering a second copy of the application. The edits are kept in state and
   * in storage; only the surface is restored, through the same exact-reversal
   * path teardown uses.
   */
  const setPreview = (on: boolean): void => {
    if (preview === on) return;
    preview = on;
    persistScalar(PREVIEW_KEY, on ? "1" : "0");
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
      const definition = readTokens().find(
        (candidate) => candidate?.name === name,
      );
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
      // No `applyErrors.delete` here: a *failed* release must keep its error —
      // the page is still rendering a value the panel has just stopped
      // claiming. §12.4's rule, in the other direction.
      notifyConsumer(name, undefined);
      notice = null;
      publish();
    },

    resetAll() {
      const names = Object.keys(overrides);
      overrides = emptyMap();
      persistOverrides();
      // Exact reversal, and unconditional: `releaseAll` restores whatever this
      // hold displaced and then removes a `style` attribute it created, rather
      // than checking a flag that could disagree with the DOM.
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
      persistScalar(SURFACE_KEY, next.id);
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
        console.error(
          "[dev-toolbar/ext/theme-editor] the mode adapter's set() threw.",
          error,
        );
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
      const snapshot = build();
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
            // The redacted display strings, never the raw values: a command and
            // a bug report are two more front doors onto the same data, and
            // neither may fetch what the panel would not show (§11.3).
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

      // The kill switch runs before anything is applied, so an edit that made
      // the page unreadable never reaches it on the reset load.
      if (resetRequested(themeParam)) {
        overrides = emptyMap();
        persistOverrides();
        notice = `Every theme edit was cleared by ?${themeParam ?? ""}=reset.`;
      } else {
        let raw: string | null = null;
        try {
          raw = persist ? api.storage.getItem(OVERRIDES_KEY) : null;
        } catch {
          raw = null;
        }
        const vetted = vetStored(parseOverrides(raw));
        overrides = vetted.accepted;
        if (vetted.dropped.length > 0) {
          // Persist the cleaned map rather than leaving the refused entries to
          // be re-read — and re-refused — on every load.
          persistOverrides();
          notice = `${vetted.dropped.length} stored edit${
            vetted.dropped.length === 1 ? " was" : "s were"
          } dropped as unusable: ${vetted.dropped.join(", ")}.`;
        }

        try {
          const storedSurface = persist ? api.storage.getItem(SURFACE_KEY) : null;
          const found = surfaces.find(
            (candidate) => candidate.id === storedSurface,
          );
          if (found) surface = found;
          preview = persist
            ? api.storage.getItem(PREVIEW_KEY) !== "0"
            : true;
        } catch {
          /* defaults stand */
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

      const timer =
        typeof tokens === "function"
          ? setInterval(publish, Math.max(250, pollMs))
          : null;

      // Visibility is *reported*, not acted on (§2). This extension deliberately
      // keeps its edits applied while the bar is hidden — see the note at the
      // top of this file — and only re-publishes so the panel is current when
      // the bar comes back.
      const stopWatching = api.subscribeVisibility(() => publish());
      publish();

      // The store belongs to the runtime, not to one start/stop cycle: React
      // StrictMode runs mount → cleanup → mount, and destroying it on the first
      // cleanup drops React's subscription and freezes the panel (§10.6).
      const dispose = () => {
        if (timer !== null) clearInterval(timer);
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
