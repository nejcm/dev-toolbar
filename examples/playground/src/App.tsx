import { Profiler, useEffect, useState } from "react";
import { DevToolbar, DevToolbarInset, useDevToolbar } from "@nejcm/dev-toolbar";
import type { ToolbarDensity } from "@nejcm/dev-toolbar";
import {
  reactProfiler,
  playgroundContext,
  playgroundExtensions,
  playgroundFlags,
} from "./extensions";
import { EmbedDemoProvider, QueryPlayground } from "./embedDemo";
import { CanvasStage, HeroFigure, MediaGallery, VideoEmbed } from "./mediaDemo";
import { ArticleDemo } from "./articleDemo";

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
          onClick={() => request(5, "/media/tile-01.svg")}
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

/**
 * Drives `/ext/diagnostics`' console tail (§1B). Every button here logs
 * something the tail must handle: a credential-carrying object, a repeated
 * message that has to group rather than fill the ring, a real uncaught throw
 * and a real unhandled rejection. Nothing here is swallowed — each line still
 * reaches the browser's own console, which is the point of the patch.
 */
function ConsoleControls() {
  return (
    <section className="pg-card">
      <h2>Drive the console tail</h2>
      <p>
        The badge on the <code>diagnostics</code> chip counts what{" "}
        <code>@nejcm/dev-toolbar/ext/diagnostics</code> caught:{" "}
        <code>window.onerror</code>, unhandled rejections and patched{" "}
        <code>console.error</code>/<code>console.warn</code>. Open the panel and
        the same messages are in the snapshot, under <em>Console</em>, already
        masked. <code>console.log</code> is never patched — press the last
        button and nothing moves.
      </p>
      <div className="pg-controls">
        <button
          type="button"
          className="pg-button"
          data-testid="console-error"
          onClick={() =>
            console.error("checkout failed", {
              orderId: "ord_991",
              sessionToken: "sess-console-secret",
              retryUrl: "https://api.playground.test/retry?access_token=tok-console-secret",
            })
          }
        >
          console.error with credentials
        </button>
        <button
          type="button"
          className="pg-button"
          data-testid="console-warn"
          onClick={() => console.warn("deprecated: <LegacyTile> goes away in v3")}
        >
          console.warn
        </button>
        <button
          type="button"
          className="pg-button"
          data-testid="console-repeat"
          onClick={() => {
            for (let index = 0; index < 5; index += 1) {
              console.error("render loop: state updated during render");
            }
          }}
        >
          Same error ×5 (groups to one row)
        </button>
        <button
          type="button"
          className="pg-button"
          data-testid="console-throw"
          onClick={() => {
            // Thrown out of a timer, so it reaches window.onerror rather than
            // React's error boundary.
            setTimeout(() => {
              throw new Error("playground: uncaught from a timer");
            }, 0);
          }}
        >
          Uncaught error (window.onerror)
        </button>
        <button
          type="button"
          className="pg-button"
          data-testid="console-reject"
          onClick={() => {
            void Promise.reject(new Error("playground: nobody caught this"));
          }}
        >
          Unhandled rejection
        </button>
        <button
          type="button"
          className="pg-button"
          data-testid="console-log"
          onClick={() => console.log("playground: never captured, by design")}
        >
          console.log (not captured)
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
 * Markup with real, deliberate accessibility violations, so `/ext/a11y` has something to find
 * and something to highlight: an image with no alternative text, a control with no accessible
 * name, and text that fails contrast against the card. The `region` rule is switched off in
 * `extensions.tsx`, so what shows up here is these three and nothing else.
 *
 * The counter proves the highlight takes no pointer events, the same way the overlays card does.
 */
function A11yPlayground() {
  const [clicks, setClicks] = useState(0);

  return (
    <section className="pg-card pg-a11y-demo">
      <h2>Break accessibility on purpose</h2>
      <p>
        The <code>a11y</code> chip is the real{" "}
        <code>@nejcm/dev-toolbar/ext/a11y</code>, running <code>axe-core</code>{" "}
        <em>only when you press Scan</em>. Nothing here is measured on a timer.
        The three controls below each break one rule.
      </p>

      <div className="pg-controls">
        {/* Deliberately alt-less: axe's `image-alt` rule. */}
        <img
          className="pg-a11y-image"
          src="/media/tile-03.svg"
          data-testid="a11y-image"
        />
        {/* Deliberately unlabelled: axe's `label` rule. */}
        <input type="text" defaultValue="unlabelled" data-testid="a11y-input" />
        <button
          type="button"
          className="pg-button"
          data-testid="a11y-click-through"
          onClick={() => setClicks((value) => value + 1)}
        >
          Click-through test: {clicks}
        </button>
      </div>

      {/* Deliberately low contrast: axe's `color-contrast` rule. */}
      <p className="pg-a11y-faint" data-testid="a11y-faint">
        This sentence is #b9b9b9 on the card's own background, which fails WCAG
        AA.
      </p>

      <p>
        Scan, then press <em>Highlight</em> on any element: the box draws below
        the bar and above the page, and the counter above still counts through
        it. An agent does the same with{" "}
        <code>a11y.scan</code> and <code>a11y.highlight</code>, and reads the
        result — the same object this panel renders — from{" "}
        <code>read().diagnostics</code>.
      </p>
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
      <HeroFigure />

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
            Accessibility: press <em>Scan this page</em> and expect the three
            violations <em>Break accessibility on purpose</em> ships — in either
            colour mode, which the faint paragraph did not manage before —
            alongside the unnamed control and positive <code>tabindex</code>{" "}
            <em>Drive the overlays</em> keeps for the focus overlay. Highlight
            one and check it draws below the bar and passes clicks through.
            Uninstall <code>axe-core</code> from this app and the panel says{" "}
            <em>not installed</em> instead of breaking.
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
          <li>
            Media: the banner above is the page's <code>LCP</code> element. Load
            the gallery with <em>Reserve space</em> off and <code>CLS</code>{" "}
            climbs; with it on, it does not. Both are read from the real{" "}
            <code>layout-shift</code> entries, so a shift inside 500 ms of your
            click is excluded — which is why the gallery waits.
          </li>
          <li>
            The video card loads a real cross-origin <code>&lt;iframe&gt;</code>{" "}
            only when asked. The bar, its panel and <code>⌘K</code> must all draw
            over it; the shortcuts must stop working while focus is inside it;
            and taking it fullscreen must hide the bar and give it back
            unchanged.
          </li>
          <li>
            <em>Animate something</em> on <em>heavy</em> is the only thing here
            that makes <code>jank</code> go red and <em>stay</em> red. The
            page's own frame counter sits next to the canvas — it and the chip
            are measuring the same frames from opposite sides.
          </li>
          <li>
            The article at the bottom is real typography on an 8px rhythm, so{" "}
            <em>Baseline grid</em> has something to be right or wrong about, and{" "}
            <code>--pg-font-scale</code> has somewhere to be felt.
          </li>
        </ol>
      </section>

      <LoadControls />

      <MediaGallery />

      <VideoEmbed />

      <CanvasStage />

      <ConsoleControls />

      <ThemePlayground />

      <OverlayPlayground />

      <A11yPlayground />

      <EnvironmentControls />

      <FlagReadout />

      <QueryPlayground />

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

      <ArticleDemo />
    </main>
  );

  const header = (
    <header className="pg-header">
      <div className="pg-header-inner">
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
      </div>
    </header>
  );

  return (
    <EmbedDemoProvider>
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
    </EmbedDemoProvider>
  );
}
