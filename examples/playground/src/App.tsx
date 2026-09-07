import { Profiler, useEffect, useState } from "react";
import { DevToolbar, DevToolbarInset, useDevToolbar } from "@nejcm/dev-toolbar";
import type { ToolbarDensity } from "@nejcm/dev-toolbar";
import {
  reactProfiler,
  playgroundContext,
  playgroundExtensions,
  playgroundFlags,
} from "./extensions";

/** Live readout of the `--dev-toolbar-height` the shell publishes. */
function HeightReadout() {
  const [height, setHeight] = useState("(unset)");

  useEffect(() => {
    const read = () => {
      const value = getComputedStyle(document.documentElement)
        .getPropertyValue("--dev-toolbar-height")
        .trim();
      setHeight(value === "" ? "(unset)" : value);
    };
    read();
    // The shell writes the variable as an inline style on <html>.
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });
    window.addEventListener("resize", read);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", read);
    };
  }, []);

  return (
    <output data-testid="height-readout" className="pg-readout">
      --dev-toolbar-height: <strong>{height}</strong>
    </output>
  );
}

/** Position/visibility are *store* state, not props — moving the bar after mount goes through `useDevToolbar()`. */
function ShellControls() {
  const toolbar = useDevToolbar();
  return (
    <>
      <button
        type="button"
        className="pg-button"
        data-testid="toggle-position"
        onClick={() =>
          toolbar.setPosition(
            toolbar.position === "bottom" ? "top" : "bottom",
          )
        }
      >
        position: {toolbar.position}
      </button>
      <button
        type="button"
        className="pg-button"
        data-testid="toggle-visible"
        onClick={() => toolbar.toggleVisible()}
      >
        visible: {String(toolbar.visible)}
      </button>
    </>
  );
}

/** Kept at module scope so "Allocate" actually retains, rather than being collected. */
const ballast: number[][] = [];

/** Drives the real metrics extension — without requests/blocking/memory pressure, every chip sits at its resting value. */
function LoadControls() {
  const [held, setHeld] = useState(0);

  const request = (count: number, path: string) => {
    for (let index = 0; index < count; index += 1) {
      // Credential in the query string on purpose: the panel must mask it.
      void fetch(`${path}?access_token=super-secret&i=${index}`).catch(() => {});
    }
  };

  const block = (ms: number) => {
    const until = performance.now() + ms;
    while (performance.now() < until) {
      /* deliberately blocking the main thread */
    }
  };

  return (
    <section className="pg-card">
      <h2>Drive the metrics</h2>
      <p>
        The <code>metrics</code> chips are the real{" "}
        <code>@nejcm/dev-toolbar/ext/metrics</code>, measuring this page. Give
        them something to measure.
      </p>
      <div className="pg-controls">
        <button
          type="button"
          className="pg-button"
          data-testid="load-fetch-ok"
          onClick={() => request(5, "/vite.svg")}
        >
          5 requests (200)
        </button>
        <button
          type="button"
          className="pg-button"
          data-testid="load-fetch-fail"
          onClick={() => request(3, "/definitely-not-here")}
        >
          3 requests (404)
        </button>
        <button
          type="button"
          className="pg-button"
          data-testid="load-block"
          onClick={() => block(300)}
        >
          Block 300 ms
        </button>
        <button
          type="button"
          className="pg-button"
          data-testid="load-allocate"
          onClick={() => {
            ballast.push(Array.from({ length: 1_500_000 }, (_, i) => i));
            setHeld(ballast.length);
          }}
        >
          Allocate ~12 MB ({held} held)
        </button>
        <button
          type="button"
          className="pg-button"
          data-testid="load-release"
          onClick={() => {
            ballast.length = 0;
            setHeld(0);
          }}
        >
          Release
        </button>
      </div>
    </section>
  );
}

/** What the app resolves for each flag via `override ?? base` — an override in the toolbar must show up here. */
function FlagReadout() {
  const [, force] = useState(0);
  useEffect(() => {
    const unsubscribe = playgroundFlags.subscribe(() =>
      force((value) => value + 1),
    );
    return () => {
      unsubscribe();
    };
  }, []);

  return (
    <section className="pg-card">
      <h2>Drive the flags</h2>
      <p>
        The <code>flags</code> chip and the{" "}
        <strong>UI Facelift 2026</strong> pill in the bar are the real{" "}
        <code>@nejcm/dev-toolbar/ext/flags</code>. The flags themselves belong to
        this app — the extension owns nothing but the overrides, which it applies
        through the <code>onOverride</code> adapter below and persists under{" "}
        <code>dtb:v1:playground:ext:flags:overrides</code>.
      </p>
      <ul className="pg-flag-list" data-testid="flag-readout">
        {playgroundFlags.keys().map((key) => (
          <li key={key}>
            <code>{key}</code> = <strong>{String(playgroundFlags.read(key))}</strong>
            {playgroundFlags.overridden(key) ? (
              <em> (overridden — the app resolves {String(playgroundFlags.base(key))})</em>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="pg-controls">
        <button
          type="button"
          className="pg-button"
          data-testid="flag-flip-base"
          onClick={() => playgroundFlags.flipBase("new-header")}
        >
          Flip the server's own new-header
        </button>
        <button
          type="button"
          className="pg-button"
          data-testid="flag-break-adapter"
          onClick={() => {
            playgroundFlags.breakAdapter = !playgroundFlags.breakAdapter;
            force((value) => value + 1);
          }}
        >
          adapter throws: {String(playgroundFlags.breakAdapter)}
        </button>
        <button
          type="button"
          className="pg-button"
          data-testid="flag-orphan"
          title="Simulates a renamed flag: an override whose key the catalogue no longer lists. It is still applied on every mount, so it still gets a row."
          onClick={() => {
            const key = "dtb:v1:playground:ext:flags:overrides";
            const stored: Record<string, unknown> = JSON.parse(
              localStorage.getItem(key) ?? "{}",
            ) as Record<string, unknown>;
            stored["checkout.v1-renamed"] = "on";
            localStorage.setItem(key, JSON.stringify(stored));
            location.reload();
          }}
        >
          Orphan an override, then reload
        </button>
        <button
          type="button"
          className="pg-button"
          data-testid="flag-add"
          title="Adds a flag to the catalogue after mount. Open ⌘K and it has a toggle command — no reload."
          onClick={() => {
            playgroundFlags.addFlag(`runtime-${Date.now().toString().slice(-4)}`);
            force((value) => value + 1);
          }}
        >
          Add a flag at runtime
        </button>
        <a className="pg-button" href="?dtb-flags=reset" data-testid="flag-reset">
          Reload with ?dtb-flags=reset
        </a>
      </div>
    </section>
  );
}

/** Drives the real environment extension — its `context` getter picks up these mutations on its next poll. */
function EnvironmentControls() {
  const [, force] = useState(0);
  const flip = (mutate: () => void) => {
    mutate();
    force((value) => value + 1);
  };

  return (
    <section className="pg-card">
      <h2>Drive the environment</h2>
      <p>
        The <code>env</code> chip is the real{" "}
        <code>@nejcm/dev-toolbar/ext/environment</code>. Its context carries an
        email address, an API endpoint with <code>access_token</code> in the
        query string, an <code>extra.authToken</code> and a{" "}
        <code>refreshToken</code> nested inside <code>extra.identity</code> — all
        four must appear masked in the panel and in anything copied from it.
      </p>
      <div className="pg-controls">
        <button
          type="button"
          className="pg-button"
          data-testid="env-impersonate"
          onClick={() =>
            flip(() => {
              playgroundContext.impersonating = !playgroundContext.impersonating;
            })
          }
        >
          impersonating: {String(playgroundContext.impersonating)}
        </button>
        <button
          type="button"
          className="pg-button"
          data-testid="env-sync"
          onClick={() =>
            flip(() => {
              playgroundContext.syncStatus =
                playgroundContext.syncStatus === "connected"
                  ? "offline"
                  : "connected";
            })
          }
        >
          sync: {playgroundContext.syncStatus}
        </button>
        <button
          type="button"
          className="pg-button"
          data-testid="env-supply"
          onClick={() =>
            flip(() => {
              playgroundContext.supply = !playgroundContext.supply;
            })
          }
        >
          context supplied: {String(playgroundContext.supply)}
        </button>
      </div>
    </section>
  );
}

/**
 * Content the overlays have something to say about: a 12-col/1100px/24px-gutter grid matching
 * `overlays({ grid })`, nested wrappers for "Layout boxes", an odd tab order for "Focus order",
 * and unnamed controls the focus overlay should flag red.
 */
function OverlayPlayground() {
  const [clicks, setClicks] = useState(0);

  return (
    <section className="pg-card pg-overlay-demo">
      <h2>Drive the overlays</h2>
      <p>
        The <code>overlays</code> chip is the real{" "}
        <code>@nejcm/dev-toolbar/ext/overlays</code>. Turn one on from its panel
        or from <code>⌘K</code>. Everything it draws sits{" "}
        <em>below the bar and above this page</em>, and takes no pointer events
        — the counter below still counts while an overlay covers it.
      </p>

      <div className="pg-controls">
        <button
          type="button"
          className="pg-button"
          data-testid="overlay-click-through"
          onClick={() => setClicks((value) => value + 1)}
        >
          Click-through test: {clicks}
        </button>
        {/* Deliberately unnamed: icon-only with aria-hidden content, no accessible name. */}
        <button type="button" className="pg-button" data-testid="overlay-unnamed">
          <span aria-hidden="true">★</span>
        </button>
        <button
          type="button"
          className="pg-button"
          tabIndex={1}
          data-testid="overlay-tabindex"
          title="Positive tabindex — jumps to the front of the tab order"
        >
          tabindex=1
        </button>
        <label className="pg-field">
          Labelled input
          <input type="text" defaultValue="named" />
        </label>
        <input
          type="text"
          defaultValue="unnamed"
          data-testid="overlay-unnamed-input"
        />
      </div>

      <div className="pg-grid">
        {Array.from({ length: 6 }, (_, index) => (
          <article className="pg-tile" key={index}>
            <div className="pg-tile-inner">
              <div className="pg-tile-media" aria-hidden="true" />
              <div className="pg-tile-body">
                <h3>Tile {index + 1}</h3>
                <p>
                  Three wrappers deep, with padding and a margin, so the
                  inspector has a box model worth drawing.
                </p>
                <a href="#tile">Open tile {index + 1}</a>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

/**
 * Content whose appearance is entirely token-driven. Nothing here talks to the extension — the
 * tokens are the app's own, declared in `playground.css`, and the toolbar edits them where they live.
 */
function ThemePlayground() {
  const [tokens, setTokens] = useState<[string, string][]>([]);

  const read = () => {
    const style = getComputedStyle(document.documentElement);
    setTokens(
      [
        "--pg-brand",
        "--pg-radius",
        "--pg-space",
        "--pg-font-scale",
        "--pg-tile-accent",
      ].map((name) => [name, style.getPropertyValue(name).trim()]),
    );
  };

  useEffect(read, []);

  return (
    <section className="pg-card pg-theme-demo">
      <h2>Drive the theme</h2>
      <p>
        The <code>theme</code> chip is the real{" "}
        <code>@nejcm/dev-toolbar/ext/theme-editor</code>. The tokens belong to
        this page — they are declared in <code>playground.css</code> and used by
        the cards, buttons, tiles and type below — and the extension edits them
        as inline custom properties on the surface you pick.
      </p>
      <ul>
        <li>
          Edit <code>--pg-radius</code> or <code>--pg-brand</code> and watch
          every card, tile and link follow. <em>Preview: off</em> puts the
          application's own values back without discarding the edit — §3H's
          before/after.
        </li>
        <li>
          Switch the surface to <em>Just the demo card</em> and edit the same
          token again: the change is scoped to this card's subtree.
        </li>
        <li>
          <code>--dtb-accent</code> is in the catalogue and is{" "}
          <strong>refused</strong>. Editing the toolbar's own tokens from here
          would restyle the bar rather than the app, so the name is never
          written. The bar must not move while everything else does.
        </li>
        <li>
          <em>Reset everything</em> restores this page exactly, down to removing
          the <code>style</code> attribute the extension created. So does
          reloading with <code>?dtb-theme=reset</code>.
        </li>
        <li>
          Export as CSS, as a recipe, or as design tokens; <em>Copy share
          link</em> puts the recipe in the URL, and opening that URL applies it
          through the same filter a pasted recipe goes through.
        </li>
      </ul>

      <div className="pg-theme-swatches" data-testid="theme-swatches">
        {tokens.map(([name, value]) => (
          <span className="pg-theme-swatch" key={name}>
            <i style={{ background: value }} aria-hidden="true" />
            {name}: {value || "(unset)"}
          </span>
        ))}
      </div>

      <div className="pg-controls">
        <button
          type="button"
          className="pg-theme-cta"
          data-testid="theme-cta"
          onClick={read}
        >
          Re-read the computed tokens
        </button>
      </div>
    </section>
  );
}

export function App() {
  const [restyled, setRestyled] = useState(false);
  const [inset, setInset] = useState(true);
  const [density, setDensity] = useState<ToolbarDensity>("compact");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    document.documentElement.toggleAttribute("data-pg-restyle", restyled);
  }, [restyled]);

  const body = (
    <main className="pg-main">
      <section className="pg-card">
        <h2>What to look at</h2>
        <ol>
          <li>
            The app owns a strict <code>100vh</code> grid with its own scroll
            container. The bar is fixed and portalled to <code>body</code>, so it
            overlays without changing this layout at all.
          </li>
          <li>
            Narrow the window: <code>boom</code>, <code>hydr</code>,{" "}
            <code>metrics</code> collapse into <code>⋮</code> first — lowest{" "}
            <code>priority</code> goes first.
          </li>
          <li>
            <code>Cmd+Shift+.</code> (macOS) or <code>Ctrl+Shift+.</code>{" "}
            elsewhere toggles the bar. <em>Mod is exclusive</em>: on a Mac,
            Ctrl+Shift+. does nothing.
          </li>
          <li>
            Reload: visibility, position, active panel and panel height all come
            back from <code>localStorage</code> under{" "}
            <code>dtb:v1:playground:*</code>.
          </li>
          <li>
            The <code>boom</code> extension throws from both slots and shows a
            single error chip. Everything else keeps working.
          </li>
          <li>
            Flags: override something, reload, and it comes back — then{" "}
            <em>Clear all overrides</em>, or{" "}
            <code>?dtb-flags=reset</code> if an override ever wedges the app.
            Renamed-flag overrides still get a row; an adapter failure marks the
            row it failed on.
          </li>
          <li>
            <strong>UI Facelift 2026</strong> in the bar is the promoted flag:
            its own switch, not a panel row. It collapses into <code>⋮</code>
            with the rest of <code>/ext/flags</code> — one extension is one
            overflow unit — and still works there.
          </li>
          <li>
            The <code>tailwind</code> chip is styled entirely by Tailwind CDN
            classes — the light-DOM regression test.
          </li>
          <li>
            Theme: edit a token, watch this page change and the{" "}
            <em>bar stay exactly where it was</em>, reload and find the edit
            still applied, then <em>Reset everything</em> and confirm the page
            is byte-identical to how it started.
          </li>
          <li>
            Overlays: turn on <em>Layout boxes</em>, <em>Column grid</em>,{" "}
            <em>Element inspector</em> and <em>Focus order</em> and check three
            things — they draw over the page, they never cover the bar, the
            panel or <code>⌘K</code>, and clicking straight through one still
            hits the button underneath. Turning them all off leaves no trace.
          </li>
        </ol>
      </section>

      <LoadControls />

      <ThemePlayground />

      <OverlayPlayground />

      <EnvironmentControls />

      <FlagReadout />

      <section className="pg-card">
        <h2>Restyle demo</h2>
        <p>
          Toggling this sets <code>data-pg-restyle</code> on{" "}
          <code>&lt;html&gt;</code>. The playground's own stylesheet then
          overrides <code>--dtb-bg</code>, <code>--dtb-fg</code>,{" "}
          <code>--dtb-accent</code> and <code>--dtb-bar-height</code>, plus the{" "}
          <code>bar</code> <code>classNames</code> slot. No{" "}
          <code>!important</code> anywhere: core ships inside{" "}
          <code>@layer dev-toolbar</code>, and unlayered author CSS always beats
          a layer.
        </p>
        <button
          type="button"
          className="pg-button"
          data-testid="toggle-restyle"
          onClick={() => setRestyled((value) => !value)}
        >
          Restyle: {restyled ? "on" : "off"}
        </button>
      </section>

      <section className="pg-card">
        <h2>Filler</h2>
        {Array.from({ length: 12 }, (_, index) => (
          <p key={index}>
            Row {index + 1} — scrolls inside the app's own container, never
            behind a bar that changed the page height.
          </p>
        ))}
      </section>
    </main>
  );

  const header = (
    <header className="pg-header">
      <h1>@nejcm/dev-toolbar playground</h1>
      <div className="pg-controls">
        <HeightReadout />
        <button
          type="button"
          className="pg-button"
          data-testid="toggle-inset"
          onClick={() => setInset((value) => !value)}
        >
          Inset: {inset ? "on" : "off"}
        </button>
        <button
          type="button"
          className="pg-button"
          data-testid="toggle-density"
          onClick={() =>
            setDensity((value) =>
              value === "compact" ? "comfortable" : "compact",
            )
          }
        >
          Density: {density}
        </button>
        <ShellControls />
        <button
          type="button"
          className="pg-button"
          data-testid="toggle-enabled"
          onClick={() => setEnabled((value) => !value)}
        >
          enabled: {String(enabled)}
        </button>
      </div>
    </header>
  );

  return (
    <DevToolbar
      extensions={playgroundExtensions}
      enabled={enabled}
      instanceId="playground"
      density={density}
      defaultPosition="bottom"
      classNames={{ bar: "pg-bar" }}
    >
      <Profiler id="playground-app" onRender={reactProfiler.onRender}>
        {inset ? (
          <DevToolbarInset className="pg-app" data-testid="inset">
            {header}
            <div className="pg-scroll">{body}</div>
          </DevToolbarInset>
        ) : (
          <div className="pg-app" data-testid="no-inset">
            {header}
            <div className="pg-scroll">{body}</div>
          </div>
        )}
      </Profiler>
    </DevToolbar>
  );
}
