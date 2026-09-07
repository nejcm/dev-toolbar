/**
 * Long-form content, and the closest thing on this page to a real one.
 *
 * It replaces a card of twelve numbered filler rows. Filler made the page tall
 * enough to scroll and did nothing else; a page of real prose, a figure, a
 * table, a quote and a code block is tall *and* is the fixture three extensions
 * were missing:
 *
 * - `/ext/overlays` had a six-tile grid to measure and no typography. The
 *   baseline overlay is configured at 8 px and every margin below is a multiple
 *   of it, so the lines either land on the rhythm or visibly do not.
 * - `/ext/theme-editor`'s `--pg-font-scale`, `--pg-space` and `--pg-radius` were
 *   only ever visible on chrome. Here they set the measure, the leading and the
 *   code block, which is where a type scale is actually felt.
 * - The element inspector had nothing nested deeper than three wrappers.
 *   `figure > img + figcaption`, a scrollable table and `pre > code` are the
 *   box models people actually get wrong.
 *
 * It is also, deliberately, worth reading: it is the page's own answer to what
 * each chip means, which is the question the bar raises and does not answer.
 */

interface SignalRow {
  signal: string;
  where: string;
  moves: string;
}

const SIGNALS: SignalRow[] = [
  {
    signal: "LCP",
    where: "metrics · web-vitals",
    moves: "The banner at the top of this page, on a cold load.",
  },
  {
    signal: "CLS",
    where: "metrics · web-vitals panel",
    moves: "Load the gallery with Reserve space off.",
  },
  {
    signal: "requests / errors",
    where: "metrics · network",
    moves: "The manifest fetch, and the 200/404 buttons in Drive the metrics.",
  },
  {
    signal: "dropped frames",
    where: "metrics · jank",
    moves: "Animate something, on heavy.",
  },
  {
    signal: "interaction latency",
    where: "metrics · delay",
    moves: "Block 300 ms, then click anything within the same second.",
  },
  {
    signal: "heap",
    where: "metrics · memory",
    moves: "Allocate ~12 MB, a few times. Chromium only.",
  },
  {
    signal: "caught errors",
    where: "diagnostics badge",
    moves: "Anything in Drive the console tail, except console.log.",
  },
  {
    signal: "violations",
    where: "a11y",
    moves: "Scan this page. Every one is from a card that breaks something on purpose.",
  },
];

export function ArticleDemo() {
  return (
    <section className="pg-card pg-article">
      <h2>How to read the bar</h2>

      <p className="pg-lede">
        Every chip on the bar is a number some extension chose to put in front of
        you, and a number with no story is furniture. This page exists to give
        each of them a cause you can press.
      </p>

      <h3>Nothing here is a mock</h3>
      <p>
        The bar at the edge of this window is the built package, resolved through{" "}
        <code>file:../..</code> exactly as a published consumer resolves it, and
        every chip on it is a real first-party extension measuring this page.
        There is no fixture data anywhere in this app. When the <code>jank</code>{" "}
        chip goes red it is because this document genuinely stopped painting;
        when <code>diagnostics</code> shows a badge it is because something
        genuinely threw.
      </p>
      <p>
        That is the whole reason a playground exists next to 2,700 unit tests.
        Tests can prove that an overflow menu collapses the lowest-priority
        extension first. They cannot prove that the collapsed menu is still
        reachable, that an overlay draws under the bar and over a cross-origin
        video player, or that a token edit repaints the page and leaves the bar
        exactly where it was.
      </p>

      <figure className="pg-article-figure">
        <img
          className="pg-article-image"
          src="/media/tile-02.svg"
          width={1200}
          height={900}
          alt="An abstract composition of overlapping cyan discs on a two-stop gradient."
          loading="lazy"
          decoding="async"
        />
        <figcaption>
          A <code>figure</code> with a sized image and a caption — three nested
          boxes with different padding, which is what the element inspector is
          for.
        </figcaption>
      </figure>

      <h3>What moves what</h3>
      <div
        className="pg-table-scroll"
        role="group"
        aria-label="Signals on the bar and what moves them"
        tabIndex={0}
      >
        <table className="pg-table">
          <caption>Each row is a chip and the button on this page that changes it.</caption>
          <thead>
            <tr>
              <th scope="col">Signal</th>
              <th scope="col">Where it shows</th>
              <th scope="col">What moves it</th>
            </tr>
          </thead>
          <tbody>
            {SIGNALS.map((row) => (
              <tr key={row.signal}>
                <th scope="row">
                  <code>{row.signal}</code>
                </th>
                <td>{row.where}</td>
                <td>{row.moves}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>The shell is not the extensions</h3>
      <blockquote className="pg-quote">
        <p>
          The package is a shell — chrome plus hosting. It renders a fixed bar,
          sorts and collapses the items it is given, hosts one panel at a time,
          persists preferences and isolates failures.
        </p>
      </blockquote>
      <p>
        Which is why the <code>boom</code> chip matters more than it looks. It
        throws from both of its slots on every render, and the only consequence
        is one error chip: the bar still lays out, the other fifteen extensions
        still measure, the panel still opens. An extension that can take the host
        down with it is not an extension, it is a dependency.
      </p>
      <p>
        The same boundary is why this app owns its own flags, its own context and
        its own design tokens, and hands the extensions nothing but adapters:
      </p>
      <pre className="pg-pre">
        <code>{`<DevToolbar
  extensions={playgroundExtensions}
  instanceId="playground"
  density="compact"
  defaultPosition="bottom"
  classNames={{ bar: "pg-bar" }}
>
  {app}
</DevToolbar>`}</code>
      </pre>
      <p>
        Everything the bar knows about this page arrived through that prop and
        the adapters inside it. Nothing in <code>src/core</code> imports an
        extension, and no extension imports a value from core — a boundary a test
        enforces and this page demonstrates.
      </p>

      <h3>Where the state actually lives</h3>
      <ul>
        <li>
          <code>localStorage</code>, under <code>dtb:v1:playground:*</code> —
          visibility, position, the open panel, its height, and every flag
          override. Reload and it all comes back.
        </li>
        <li>
          <code>--dev-toolbar-height</code> on <code>&lt;html&gt;</code>, read by
          the pill in this page&apos;s header. It is how{" "}
          <code>DevToolbarInset</code> keeps the bar from covering the scroll
          container without the bar ever joining the layout.
        </li>
        <li>
          <code>window.__DEV_TOOLBAR__.instances[&quot;playground&quot;]</code>,
          published by <code>/ext/agent</code> — the same snapshot the panels
          render, for anything driving this page that would rather not click.
        </li>
      </ul>
      <p>
        None of it survives an escape hatch: <code>?dtb-flags=reset</code>,{" "}
        <code>?dtb-theme=reset</code>, or <em>Reset everything</em> in the theme
        panel, each of which puts this page back exactly as it started.
      </p>
    </section>
  );
}
