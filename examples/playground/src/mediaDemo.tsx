import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Media, and what each kind of it makes the bar say.
 *
 * The rest of the playground drives extensions with buttons that do nothing a
 * real app does. This file drives them with the three things every real app is
 * actually made of — images fetched after first paint, a third-party iframe,
 * and an animation loop — because those are what the chips were built to
 * measure and none of them can be simulated by a button that calls
 * `console.error`.
 *
 * Everything here is deliberately **accessible**. `/ext/a11y`'s fixture is the
 * *Break accessibility on purpose* card and its three violations are asserted
 * by name; an alt-less image or a title-less iframe added here would show up in
 * that scan as a fourth. Every `<img>` carries `alt`, the `<iframe>` carries
 * `title`, the scrollable table is focusable, and the canvas is
 * `aria-hidden` next to a real text readout.
 */

/** One row of `public/media/gallery.json`. */
interface GalleryImage {
  src: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
}

/**
 * How long the gallery waits after its manifest resolves before committing the
 * images.
 *
 * This is not padding. Layout-shift entries carry `hadRecentInput`, set for any
 * shift within 500 ms of a real interaction, and both the playground's
 * `web-vitals` collector and Chrome's own CLS skip those. Render the images
 * straight out of the click handler and the shift is attributed to the click and
 * never counted — the chip stays at `0.000` while the page visibly jumps, which
 * is the one thing about CLS that surprises people. Waiting past the window is
 * also what a real app does: the images arrive when the data does.
 */
const SETTLE_MS = 900;

/**
 * The banner at the top of the page, and on a cold load the page's Largest
 * Contentful Paint element.
 *
 * It is `fetchPriority="high"`, eager, and carries `width`/`height` so it
 * reserves its own box: the `LCP` chip should settle on a number in the low
 * hundreds of milliseconds and `CLS` should stay at `0.000`. Take the
 * dimensions off and it becomes the gallery's problem below.
 */
export function HeroFigure() {
  return (
    <figure className="pg-hero">
      <img
        className="pg-hero-image"
        src="/media/hero.svg"
        width={1600}
        height={460}
        alt="The dev-toolbar wordmark over an abstract indigo gradient."
        fetchPriority="high"
        decoding="async"
        data-testid="hero-image"
      />
      <figcaption>
        The widest painted element on the page, so it is what <code>LCP</code>{" "}
        reports. It declares <code>width</code> and <code>height</code>, so it
        costs <code>CLS</code> nothing.
      </figcaption>
    </figure>
  );
}

/**
 * Images that arrive after first paint, the way images actually arrive.
 *
 * Three switches, one signal each:
 *
 * - **Reserve space** decides whether each `<img>` carries `width`/`height`.
 *   Off, the boxes have no intrinsic ratio, every image jumps the page as it
 *   decodes, and `CLS` in the metrics panel climbs past `0.1`. On, it stays put.
 * - **loading** flips `lazy`/`eager`. Lazy plus a narrow window means the
 *   images below the fold are not requested until you scroll — the network list
 *   grows as you go.
 * - **Load** re-fetches the manifest with a fresh cache-buster, so every press
 *   is a real row in `/ext/metrics`' network list rather than a memory-cache hit.
 */
export function MediaGallery() {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "settling" | "ready" | "error">(
    "idle",
  );
  const [sized, setSized] = useState(false);
  const [lazy, setLazy] = useState(true);
  const [generation, setGeneration] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  const load = useCallback(() => {
    clearTimeout(timer.current);
    setImages([]);
    setStatus("loading");
    // A real request, so the manifest shows up in the network list next to the
    // buttons in "Drive the metrics" — the images themselves never will, since
    // `<img>` loads go through neither `fetch` nor `XMLHttpRequest`.
    void fetch(`/media/gallery.json?v=${Date.now()}`)
      .then((response) => {
        if (!response.ok) throw new Error(`gallery manifest: ${response.status}`);
        return response.json() as Promise<{ images: GalleryImage[] }>;
      })
      .then((body) => {
        setStatus("settling");
        timer.current = setTimeout(() => {
          setImages(body.images);
          setGeneration((value) => value + 1);
          setStatus("ready");
        }, SETTLE_MS);
      })
      .catch(() => {
        setStatus("error");
      });
  }, []);

  return (
    <section className="pg-card pg-media-demo">
      <h2>Load some images</h2>
      <p>
        The gallery fetches <code>/media/gallery.json</code> and then, {SETTLE_MS}{" "}
        ms later, renders what it names. The delay is the point: a layout shift
        inside 500 ms of a click is attributed to the click and never counted, so
        without it the page would jump and <code>CLS</code> would still read{" "}
        <code>0.000</code>.
      </p>
      <div className="pg-controls">
        <button type="button" className="pg-button" data-testid="media-load" onClick={load}>
          {status === "idle" ? "Load the gallery" : "Load again"}
        </button>
        <button
          type="button"
          className="pg-button"
          data-testid="media-sized"
          title="Whether each <img> declares width and height. Off means no reserved box, and every decode shifts the page."
          onClick={() => setSized((value) => !value)}
        >
          Reserve space: {sized ? "on" : "off"}
        </button>
        <button
          type="button"
          className="pg-button"
          data-testid="media-lazy"
          onClick={() => setLazy((value) => !value)}
        >
          loading: {lazy ? "lazy" : "eager"}
        </button>
        <button
          type="button"
          className="pg-button"
          data-testid="media-clear"
          onClick={() => {
            clearTimeout(timer.current);
            setImages([]);
            setStatus("idle");
          }}
        >
          Clear
        </button>
        <output className="pg-readout" data-testid="media-status">
          {status} · {images.length} loaded
        </output>
      </div>

      {/* Keyed on the switches so flipping one gives every image a fresh
          element — React would otherwise keep the decoded, already-laid-out
          one and there would be nothing to shift. */}
      <div
        className="pg-media-grid"
        data-testid="media-grid"
        key={`${String(sized)}-${String(lazy)}-${generation}`}
      >
        {images.map((image) => (
          <figure className="pg-media-figure" data-pg-sized={String(sized)} key={image.src}>
            <img
              className="pg-media-image"
              src={image.src}
              alt={image.alt}
              loading={lazy ? "lazy" : "eager"}
              decoding="async"
              {...(sized ? { width: image.width, height: image.height } : {})}
            />
            <figcaption>
              {image.caption} · {image.width}×{image.height}
            </figcaption>
          </figure>
        ))}
      </div>

      {status === "error" ? (
        <p data-testid="media-error">
          The manifest did not load. That is a row in the network list too, and{" "}
          <code>diagnostics</code> caught the <code>console.error</code>.
        </p>
      ) : null}
    </section>
  );
}

/** YouTube's oldest public video: short, and unlikely to be taken down. Any id works. */
const DEFAULT_VIDEO_ID = "jNQXAC9IVRw";

/**
 * A third-party `<iframe>`, loaded only when asked.
 *
 * The facade is not a privacy gesture alone, though it is one — nothing reaches
 * `youtube-nocookie.com` until the poster is clicked. It is how the card can
 * show the *before* and the *after* of dropping an opaque, cross-origin,
 * focus-stealing rectangle into a page the toolbar has to keep working over.
 */
export function VideoEmbed() {
  const [videoId, setVideoId] = useState(DEFAULT_VIDEO_ID);
  const [playing, setPlaying] = useState(false);

  return (
    <section className="pg-card pg-embed-demo">
      <h2>Embed a video</h2>
      <p>
        Nothing is requested until you press play — then this becomes a real
        cross-origin <code>&lt;iframe&gt;</code>, which is the hardest thing on a
        page for a fixed bar to coexist with. Four things to check:
      </p>
      <ul>
        <li>
          The bar, its panel, its overflow popup and <code>⌘K</code> all draw{" "}
          <em>over</em> the player. An iframe creates its own stacking context
          and third-party embeds set their own <code>z-index</code>; core&apos;s
          portal has to win anyway.
        </li>
        <li>
          Turn on <em>Element inspector</em> and <em>Layout boxes</em>: the
          overlays draw over the player and pass the click through to it. An
          iframe is one box to the inspector — it cannot see inside, and should
          not pretend to.
        </li>
        <li>
          Click inside the player, then press <code>Cmd+Shift+.</code> or{" "}
          <code>⌘K</code>: nothing happens. A cross-origin iframe keeps its own
          keystrokes, so core&apos;s listener never sees them. Click this page
          again and both come back. That is a property of the web, not a bug in
          the bar — and worth knowing before you file one.
        </li>
        <li>
          Take the player fullscreen. The bar is portalled to{" "}
          <code>&lt;body&gt;</code>, which is not inside the fullscreen element,
          so it disappears for the duration and comes back on exit — with
          position, panel and height intact.
        </li>
      </ul>

      <div className="pg-controls">
        <label className="pg-field">
          Video id
          <input
            type="text"
            value={videoId}
            size={14}
            data-testid="embed-id"
            onChange={(event) => setVideoId(event.target.value.trim())}
          />
        </label>
        {playing ? (
          <button
            type="button"
            className="pg-button"
            data-testid="embed-remove"
            onClick={() => setPlaying(false)}
          >
            Unload the player
          </button>
        ) : null}
      </div>

      <div className="pg-embed-frame">
        {playing ? (
          <iframe
            className="pg-embed-iframe"
            title={`YouTube player for video ${videoId}`}
            src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0`}
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            data-testid="embed-iframe"
          />
        ) : (
          <button
            type="button"
            className="pg-embed-facade"
            data-testid="embed-play"
            onClick={() => setPlaying(true)}
          >
            <img
              className="pg-embed-poster"
              src="/media/embed-poster.svg"
              width={1280}
              height={720}
              alt=""
              loading="lazy"
              decoding="async"
            />
            <span className="pg-embed-play">
              <span aria-hidden="true">▶</span> Load the player
            </span>
          </button>
        )}
      </div>
    </section>
  );
}

/** Modes the stage can run in. `heavy` is the one the `jank` chip is for. */
type StageMode = "off" | "smooth" | "heavy";

/** Per-frame synchronous work in `heavy` mode — over one 60 Hz frame budget, on purpose. */
const HEAVY_FRAME_MS = 24;

/**
 * An animation loop, which is the only honest way to make the `jank` chip move.
 *
 * *Block 300 ms* in "Drive the metrics" is one long task: the chip spikes once
 * and recovers. This is the other failure, and the more common one — a loop that
 * does slightly too much every frame, so nothing ever blocks for long and the
 * page is simply never smooth. The two look completely different in the panel,
 * and only one of them is what users complain about.
 *
 * The readout is the page counting its own frames. It and the chip are measuring
 * the same `requestAnimationFrame` callbacks from opposite sides; if they
 * disagree by more than rounding, one of them is wrong.
 */
export function CanvasStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<StageMode>("off");
  const [fps, setFps] = useState(0);

  useEffect(() => {
    if (mode === "off") {
      setFps(0);
      return;
    }
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    let frame = 0;
    let running = true;
    let frames = 0;
    let since = performance.now();

    const draw = (now: number) => {
      if (!running) return;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const width = canvas.clientWidth * ratio;
      const height = canvas.clientHeight * ratio;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const style = getComputedStyle(canvas);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = style.getPropertyValue("--pg-brand").trim() || "#5e6ad2";
      context.lineWidth = ratio;
      const t = now / 1000;
      for (let index = 0; index < 180; index += 1) {
        const phase = index / 180;
        const radius = (Math.min(canvas.width, canvas.height) / 2) * (0.15 + phase * 0.8);
        const angle = t * (0.3 + phase) + phase * Math.PI * 4;
        context.globalAlpha = 0.08 + phase * 0.25;
        context.beginPath();
        context.arc(
          canvas.width / 2 + Math.cos(angle) * radius * 0.25,
          canvas.height / 2 + Math.sin(angle) * radius * 0.25,
          radius * 0.4,
          0,
          Math.PI * 2,
        );
        context.stroke();
      }
      context.globalAlpha = 1;

      if (mode === "heavy") {
        // Not a sleep: real synchronous work, so the frame is genuinely late
        // rather than merely idle, and the profiler sees a long task.
        const until = performance.now() + HEAVY_FRAME_MS;
        let sink = 0;
        while (performance.now() < until) sink += Math.sqrt(sink + 1);
        if (sink === Number.POSITIVE_INFINITY) context.fillText("", 0, 0);
      }

      frames += 1;
      if (now - since >= 500) {
        setFps(Math.round((frames * 1000) / (now - since)));
        frames = 0;
        since = now;
      }
      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => {
      running = false;
      cancelAnimationFrame(frame);
    };
  }, [mode]);

  return (
    <section className="pg-card pg-canvas-demo">
      <h2>Animate something</h2>
      <p>
        The <code>jank</code> chip counts dropped frames over a rolling five
        seconds. <em>Smooth</em> should cost it nothing. <em>Heavy</em> spends{" "}
        {HEAVY_FRAME_MS} ms of real arithmetic inside every frame — more than a
        60 Hz budget — so the chip goes red and stays there, which is a different
        failure from the one-off spike <em>Block 300 ms</em> produces.
      </p>
      <p>
        Both numbers read <code>0</code> in a background tab, and correctly:{" "}
        <code>requestAnimationFrame</code> stops there, and the <code>jank</code>{" "}
        collector discards the gap instead of billing you ten seconds of dropped
        frames for a window you were not looking at.
      </p>
      <div className="pg-controls">
        {(["off", "smooth", "heavy"] as const).map((value) => (
          <button
            type="button"
            className="pg-button"
            key={value}
            aria-pressed={mode === value}
            data-testid={`anim-${value}`}
            onClick={() => setMode(value)}
          >
            {value}
          </button>
        ))}
        <output className="pg-readout" data-testid="anim-fps">
          page-measured: <strong>{mode === "off" ? "—" : `${fps} fps`}</strong>
        </output>
      </div>
      <div className="pg-canvas-stage">
        {/* Decorative: the number beside it is the accessible version of what it shows. */}
        <canvas ref={canvasRef} className="pg-canvas" aria-hidden="true" />
      </div>
    </section>
  );
}
