import { useEffect, useState } from "react";
import { DevToolbar, DevToolbarInset, useDevToolbar } from "@nejcm/dev-toolbar";
import type { ToolbarDensity } from "@nejcm/dev-toolbar";
import {
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
    // The shell writes the variable as an inline style on <html>, so watching
    // the style attribute is both cheap and exact.
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

/**
 * Position and visibility are *store* state, not props: `defaultPosition` only
 * seeds an empty store. Anything that wants to move the bar after mount goes
 * through `useDevToolbar()`, which is what this does.
 */
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

/**
 * Drives the real metrics extension. Without something making requests,
 * blocking the main thread and holding memory, every chip sits at its resting
 * value and the panel has nothing to draw.
 */
function LoadControls() {
  const [held, setHeld] = useState(0);

  const request = (count: number, path: string) => {
    for (let index = 0; index < count; index += 1) {
      // A credential in the query string on purpose: the panel must show it
      // masked, never as typed.
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

/**
 * What the *application* currently resolves for each flag, read through the
 * same `override ?? base` the pretend provider uses. This is the honest half of
 * the demo: an override in the toolbar has to show up here, or the toolbar is
 * lying about mutating anything.
 */
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
        <a className="pg-button" href="?dtb-flags=reset" data-testid="flag-reset">
          Reload with ?dtb-flags=reset
        </a>
      </div>
    </section>
  );
}

/**
 * Drives the real environment extension. Its `context` is a getter, so flipping
 * these mutates the module-level object and the extension picks it up on its
 * next poll — no re-render of the toolbar involved.
 */
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

export function App() {
  const [restyled, setRestyled] = useState(false);
  const [inset, setInset] = useState(false);
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
            <code>metrics</code> collapse into <code>···</code> first — lowest{" "}
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
            its own switch, not a panel row. It collapses into <code>···</code>
            with the rest of <code>/ext/flags</code> — one extension is one
            overflow unit — and still works there.
          </li>
          <li>
            The <code>tailwind</code> chip is styled entirely by Tailwind CDN
            classes — the light-DOM regression test.
          </li>
        </ol>
      </section>

      <LoadControls />

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

  return (
    <DevToolbar
      extensions={playgroundExtensions}
      enabled={enabled}
      instanceId="playground"
      density={density}
      defaultPosition="bottom"
      classNames={{ bar: "pg-bar" }}
    >
      <div className="pg-app">
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

        {inset ? (
          <DevToolbarInset className="pg-scroll" data-testid="inset">
            {body}
          </DevToolbarInset>
        ) : (
          <div className="pg-scroll" data-testid="no-inset">
            {body}
          </div>
        )}
      </div>
    </DevToolbar>
  );
}
