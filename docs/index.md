---
layout: home
markdownStyles: false
pageClass: dtb-landing-page
---

<div class="dtb-landing">

  <section id="top" class="dtb-section dtb-hero">
    <div class="dtb-badge">v{{ version }} · {{ license }} · 0 runtime deps</div>
    <h1>A bottom bar that hosts <span>your</span> tools.</h1>
    <p class="dtb-lead">An extensible, low-overhead in-app developer toolbar for React. The package is chrome plus hosting — metrics, flags, overlays and diagnostics are opt-in extensions, each on its own subpath with its own bundle.</p>
    <div class="dtb-actions">
      <a class="dtb-button dtb-button-primary" href="#install">Get started</a>
      <a class="dtb-button dtb-button-secondary" href="#docs">Read the docs</a>
    </div>
    <div class="dtb-capabilities">
      <span v-for="capability in capabilities" :key="capability.name">
        <i></i><strong>{{ capability.name }}</strong>{{ capability.detail }}
      </span>
    </div>
    <nav class="dtb-section-links" aria-label="On this page">
      <a href="#install">install</a>
      <a href="#extensions">extensions</a>
      <a href="#write">extension api</a>
      <a href="#docs">docs</a>
    </nav>
  </section>

  <section class="dtb-section dtb-bar-section">
    <div class="dtb-frame">
      <div class="dtb-frame-heading">
        <span>the bar</span>
        <div class="dtb-frame-toggles">
          <div class="dtb-density" role="group" aria-label="Toolbar density">
            <button v-for="value in densities" :key="value" type="button" :class="{ active: density === value }" :aria-pressed="density === value" @click="density = value">{{ value }}</button>
          </div>
          <div class="dtb-density" role="group" aria-label="Chip presentation">
            <button v-for="value in presentations" :key="value" type="button" :class="{ active: presentation === value }" :aria-pressed="presentation === value" @click="presentation = value">{{ value }}</button>
          </div>
        </div>
      </div>
      <div class="dtb-bar-stage">
        <div class="dtb-bar-viewport">
          <div class="dtb-bar-mock" :class="{ comfortable: density === 'comfortable', icons: presentation === 'icons' }">
            <div class="dtb-bar-run">
              <span class="dtb-chip"><i class="dtb-dot dtb-warn"></i>env <strong class="dtb-warn-text">staging</strong></span>
              <i class="dtb-divider"></i>
              <span class="dtb-chip"><i class="dtb-dot"></i>cmds <strong>aggregated</strong></span>
              <i class="dtb-divider"></i>
              <span class="dtb-chip dtb-chip-outline"><i class="dtb-dot"></i>◆ <strong>UI Facelift 2026</strong></span>
              <span class="dtb-chip"><svg class="dtb-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4h13l-2.5 4L18 12H5"/></svg><span class="dtb-label">flags</span><strong>6</strong></span>
              <i class="dtb-divider"></i>
              <span class="dtb-chip"><i class="dtb-dot"></i>theme <strong>14</strong></span>
              <i class="dtb-divider"></i>
              <span class="dtb-chip"><i class="dtb-dot dtb-good"></i><svg class="dtb-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="8" height="8" rx="1.5"/><path d="M10 3v3M14 3v3M10 18v3M14 18v3M3 10h3M3 14h3M18 10h3M18 14h3"/></svg><span class="dtb-label">mem</span><strong>23 MB</strong></span>
              <span class="dtb-chip"><i class="dtb-dot"></i><svg class="dtb-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg><span class="dtb-label">delay</span><strong>—</strong></span>
              <span class="dtb-chip"><i class="dtb-dot dtb-good"></i><svg class="dtb-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12h4l3-8 5 16 3-8h5"/></svg><span class="dtb-label">jank</span><strong>0.0%</strong></span>
              <span class="dtb-chip"><i class="dtb-dot dtb-good"></i><svg class="dtb-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 21V3M7 3 3.5 6.5M7 3l3.5 3.5M17 3v18M17 21l-3.5-3.5M17 21l3.5-3.5"/></svg><span class="dtb-label">net</span><strong>0</strong></span>
              <i class="dtb-divider"></i>
              <span class="dtb-chip"><i class="dtb-dot"></i><svg class="dtb-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3s6 6.4 6 9.8a6 6 0 0 1-12 0C6 9.4 12 3 12 3Z"/></svg><span class="dtb-label">hydr</span><strong>NA</strong></span>
              <span class="dtb-chip dtb-chip-filled"><i class="dtb-dot dtb-white"></i><strong>tailwind</strong></span>
            </div>
            <span class="dtb-hotkey">⌘K</span>
            <i class="dtb-divider"></i>
            <span class="dtb-chip dtb-actor"><i class="dtb-dot"></i>user <strong>internal</strong></span>
            <span class="dtb-more">⋮</span>
          </div>
        </div>
        <p class="dtb-bar-caption">At real size, with the run of chips clipping into ⋮ exactly as the shell collapses overflow on a narrow viewport. The shell sorts and collapses the items you give it, hosts one panel at a time, remembers preferences and isolates failures. A compact or panel slot that throws becomes a retry chip; an overlay that throws is reported without one.</p>
      </div>
    </div>
  </section>

  <section class="dtb-section dtb-features">
    <div class="dtb-grid dtb-feature-grid">
      <div v-for="feature in features" :key="feature.title" class="dtb-feature">
        <div class="dtb-accent">{{ feature.title }}</div>
        <div v-html="feature.body"></div>
      </div>
    </div>
  </section>

  <section id="install" class="dtb-section dtb-content-section">
    <h2 class="dtb-eyebrow">install</h2>
    <div class="dtb-frame">
      <div class="dtb-tabs" role="tablist" aria-label="Installation examples">
        <button v-for="(label, index) in installTabs" :id="`dtb-tab-${index}`" :key="label" ref="tabButtons" type="button" role="tab" :class="{ active: tab === index }" :aria-selected="tab === index" :aria-controls="`dtb-pane-${index}`" :tabindex="tab === index ? 0 : -1" @click="tab = index" @keydown="onTabKey">{{ label }}</button>
      </div>
      <div class="dtb-code-pane">
        <div v-show="tab === 0" id="dtb-pane-0" role="tabpanel" aria-labelledby="dtb-tab-0">
          <pre v-pre><span><b>$ </b>npm install @nejcm/dev-toolbar</span><span class="dtb-code-comment"># react &amp; react-dom 18 or 19 are required peers</span><span class="dtb-code-comment"># axe-core (ext/a11y) and @testing-library/react (/testing)</span><span class="dtb-code-comment"># are optional peers — install them only if you use those</span></pre>
        </div>
        <div v-show="tab === 1" id="dtb-pane-1" role="tabpanel" aria-labelledby="dtb-tab-1">
          <pre v-pre><span><em>import</em> { DevToolbar } <em>from</em> <b>"@nejcm/dev-toolbar"</b>;</span><span><em>import</em> { environment } <em>from</em> <b>"@nejcm/dev-toolbar/ext/environment"</b>;</span><span><em>import</em> { metrics } <em>from</em> <b>"@nejcm/dev-toolbar/ext/metrics"</b>;</span><span>&nbsp;</span><span class="dtb-code-comment">// Built once, at module scope — never inside render.</span><span><em>const</em> extensions = [environment({ context: { environment: <b>"staging"</b> } }), metrics()];</span><span>&nbsp;</span><span><em>export function</em> <mark>Root</mark>() {</span><span>  <em>return</em> (</span><span>    &lt;<mark>DevToolbar</mark> extensions={extensions}&gt;</span><span>      &lt;<mark>App</mark> /&gt;</span><span>    &lt;/<mark>DevToolbar</mark>&gt;</span><span>  );</span><span>}</span></pre>
        </div>
        <div v-show="tab === 2" id="dtb-pane-2" role="tabpanel" aria-labelledby="dtb-tab-2">
          <pre v-pre><span class="dtb-code-comment">// Pad your content out of the way…</span><span><em>import</em> { DevToolbarInset } <em>from</em> <b>"@nejcm/dev-toolbar"</b>;</span><span>&nbsp;</span><span>&lt;<mark>DevToolbarInset</mark>&gt;&lt;<mark>App</mark> /&gt;&lt;/<mark>DevToolbarInset</mark>&gt;;</span><span>&nbsp;</span><span class="dtb-code-comment">/* …or by hand. The shell publishes bar + open panel height on &lt;html&gt;. */</span><span>.my-layout { padding-bottom: <mark>var</mark>(--dev-toolbar-height, 0px); }</span></pre>
        </div>
        <div v-show="tab === 3" id="dtb-pane-3" role="tabpanel" aria-labelledby="dtb-tab-3">
          <pre v-pre><span class="dtb-code-comment">// Gate on the value that names the deployment, not NODE_ENV:</span><span class="dtb-code-comment">// a staging build IS a production build.</span><span><em>const</em> Toolbar = import.meta.env.VITE_ENV === <b>"production"</b></span><span>  ? <em>null</em></span><span>  : <mark>lazy</mark>(() =&gt; <mark>import</mark>(<b>"./DevTools"</b>));</span><span>&nbsp;</span><span class="dtb-code-comment">// The dynamic import folds away, so the code leaves the prod bundle.</span><span class="dtb-code-comment">// Caveat: the chunk is not there at boot — nothing in it runs</span><span class="dtb-code-comment">// before the app's first render.</span></pre>
        </div>
      </div>
    </div>
  </section>

  <section id="extensions" class="dtb-section dtb-content-section">
    <div class="dtb-section-heading">
      <h2 class="dtb-eyebrow">nine first-party extensions</h2>
      <p>Each one an opt-in subpath with its own bundle. Import none and the bar hosts only your tools.</p>
    </div>
    <div class="dtb-grid dtb-extension-grid">
      <a v-for="extension in extensions" :key="extension.id" :href="extension.href" class="dtb-extension-card">
        <div class="dtb-accent">ext/{{ extension.id }}</div>
        <div>{{ extension.body }}</div>
        <small>docs →</small>
      </a>
    </div>
    <div class="dtb-grid dtb-subpath-grid">
      <div v-for="subpath in subpaths" :key="subpath.name">
        <div>{{ subpath.name }}</div>
        <small>{{ subpath.body }}</small>
      </div>
    </div>
  </section>

  <section id="write" class="dtb-section dtb-content-section">
    <h2 class="dtb-eyebrow">write your own</h2>
    <div class="dtb-grid dtb-write-grid">
      <div class="dtb-write-code">
        <pre v-pre><span class="dtb-code-comment">// An extension is a plain object.</span><span class="dtb-code-comment">// No registry, no class, no plugin API.</span><span><em>const</em> build: <mark>DevToolbarExtension</mark> = {</span><span>  id: <b>"build-info"</b>,</span><span>  label: <b>"Build"</b>,</span><span>  align: <b>"end"</b>,</span><span>  compact: ({ openPanel }) =&gt; (</span><span>    &lt;<mark>button</mark> data-dtb-part=<b>"trigger"</b> onClick={openPanel}&gt;</span><span>      {import.meta.env.VITE_COMMIT?.<mark>slice</mark>(0, 7) ?? <b>"dev"</b>}</span><span>    &lt;/<mark>button</mark>&gt;</span><span>  ),</span><span>  panel: () =&gt; &lt;<mark>BuildDetails</mark> /&gt;,</span><span>};</span></pre>
      </div>
      <div class="dtb-write-notes">
        <div><strong>commands</strong><p>Add them and the extension appears in the ⌘K palette. Contract v2 commands may declare an <code>input</code> schema and resolve a result.</p></div>
        <div><strong>diagnostics()</strong><p>What you return lands in somebody's bug report — and they read the exact text first.</p></div>
        <div><strong>start(api)</strong><p>Background work with an <code>AbortSignal</code> that fires on teardown.</p></div>
        <div class="dtb-rule-note"><strong>two rules that save an afternoon</strong><p>Build the object once, at module scope. And treat <code>hidden</code> as <em>does not exist here</em>, not <em>unpainted</em>.</p></div>
      </div>
    </div>
  </section>

  <section id="docs" class="dtb-section dtb-content-section">
    <h2 class="dtb-eyebrow">documentation</h2>
    <div class="dtb-doc-list">
      <a v-for="document in documents" :key="document.name" :href="document.href"><span>{{ document.name }}</span><p>{{ document.body }}</p></a>
      <div class="dtb-doc-note">Every extension directory carries a README too — the developer's view of the same nine: the files in it, what it owns, and the decisions that bite.</div>
    </div>
  </section>

  <section class="dtb-section dtb-content-section">
    <h2 class="dtb-eyebrow">contributing</h2>
    <div class="dtb-grid dtb-contributing-grid">
      <div><strong>the one command that matters</strong><pre><b>$ </b>bun run verify</pre><p>format:check → typecheck → lint → knip → build → check:package → test. If it passes locally it passes in CI.</p></div>
      <div><strong>try a change for real</strong><pre><b>$ </b>bun run playground</pre><p>A Vite app on :5273 consuming the built dist through file:../.. exactly as a published consumer does.</p></div>
      <div><strong>house rules</strong><p>Bun, not npm. Zero runtime dependencies is a rule. Core never imports runtime/ or ext/. Conventional Commits, enforced — the PR title is the message that lands.</p></div>
    </div>
  </section>

  <section class="dtb-section dtb-cta-section">
    <div class="dtb-cta">
      <h2>Put your own devtools where you already look.</h2>
      <code><span>$ </span>npm install @nejcm/dev-toolbar</code>
      <a class="dtb-button dtb-button-primary" href="https://github.com/nejcm/dev-toolbar#readme">Read the README</a>
    </div>
  </section>

</div>

<script setup>
import { withBase } from "vitepress";
import { ref, useTemplateRef } from "vue";
import { version, license } from "../package.json";

const tab = ref(0);
const tabButtons = useTemplateRef("tabButtons");
const density = ref("compact");
const densities = ["compact", "comfortable"];
const presentation = ref("labels");
const presentations = ["labels", "icons"];
const installTabs = ["npm", "mount", "inset", "keep out of prod"];

// WAI-ARIA tablist keyboard pattern: the tabs are one tab stop, arrows move within it.
function onTabKey(event) {
  const last = installTabs.length - 1;
  let next;
  if (event.key === "ArrowRight") next = tab.value === last ? 0 : tab.value + 1;
  else if (event.key === "ArrowLeft") next = tab.value === 0 ? last : tab.value - 1;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = last;
  else return;
  event.preventDefault();
  tab.value = next;
  tabButtons.value?.[next]?.focus();
}
const capabilities = [
  { name: "React 18 / 19", detail: "peer" },
  { name: "Light DOM", detail: "tailwind & css-in-js work" },
  { name: "SSR-safe", detail: "client-only bar" },
  { name: "⌘⇧.", detail: "show / hide on Mac" },
];
const features = [
  { title: "zero runtime deps", body: "React and <span>react-dom</span> are peers; package runtime adds nothing. <span>ext/a11y</span> uses optional axe-core." },
  { title: "restyleable, no !important", body: "Core CSS lives in <span>@layer dev-toolbar</span>, so unlayered author CSS wins at any specificity." },
  { title: "failure-isolated", body: "One extension throwing never takes the bar down — and the rest keeps working." },
  { title: "light DOM", body: "No shadow root, so Tailwind, CSS-in-JS and your design system work inside extensions." },
  { title: "logical properties", body: '<span>dir="rtl"</span> mirrors the bar, the ⋮ popup and every first-party extension.' },
  { title: "ssr-safe", body: "Children server-render untouched; the bar is client-only, so nothing can mismatch." },
];
const extensions = [
  { id: "metrics", href: withBase("/ext/metrics.html"), body: "Memory, interaction delay, jank and in-flight network, plus your own collectors. Each built-in degrades on its own where a browser API is missing." },
  { id: "environment", href: withBase("/ext/environment.html"), body: "Environment, release, commit and actor context — all supplied by you, all redacted, with production coloured like production." },
  { id: "flags", href: withBase("/ext/flags.html"), body: "Your feature flags, with local overrides that survive a reload and a ?dtb-flags=reset kill switch." },
  { id: "command-menu", href: withBase("/ext/command-menu.html"), body: "A ⌘K palette over every command the toolbar has aggregated. Leave it out and build your own with useDevToolbar().getCommands()." },
  { id: "overlays", href: withBase("/ext/overlays.html"), body: "Layout boxes, a column grid, an element inspector and focus order — drawn over your page, never intercepting a click." },
  { id: "diagnostics", href: withBase("/ext/diagnostics.html"), body: "One snapshot for a bug report: the page, long tasks, a tail of console errors and every other extension's diagnostics." },
  { id: "theme-editor", href: withBase("/ext/theme-editor.html"), body: "Live design-token editing, with the app's own value next to your edit, and CSS, a recipe or a design-tokens export on the way out." },
  { id: "a11y", href: withBase("/ext/a11y.html"), body: "axe-core violations grouped by impact, on demand and never on a timer, with click-to-highlight. Its axe-core integration is an optional peer." },
  { id: "agent", href: withBase("/ext/agent.html"), body: "The bar's state and commands on a global, for an in-page agent to read rather than scrape. Running commands is a second opt-in." },
];
const subpaths = [
  { name: "/kit", body: "types, helpers, data-dtb-kind CSS, native-looking controls" },
  { name: "/runtime", body: "event bus, ring buffers, throttled store, redact()" },
  { name: "/testing", body: "renderWithToolbar, fake layout, mock bus — needs the optional @testing-library/react peer" },
  { name: "/styles.css", body: "the shell stylesheet, if you would rather import it" },
];
const documents = [
  { name: "api.md", href: withBase("/api.html"), body: "The root entry: every <DevToolbar> prop, the toggle shortcut, the ⋮ menu, the escape hatches and every published type" },
  { name: "extension-contract.md", href: withBase("/extension-contract.html"), body: "The object you write, the slot props, start(api), and the two lifecycle rules that bite" },
  { name: "kit.md", href: withBase("/kit.html"), body: "The severity vocabulary, storage/poll/style helpers, data-dtb-kind, the React controls and the presentation vocabulary" },
  { name: "runtime.md", href: withBase("/runtime.html"), body: "Event bus, ring buffers, throttled store, redact() anchored and redactText() scanning" },
  { name: "embedding.md", href: withBase("/embedding.html"), body: "A third-party devtool on the bar: the four-line recipe, the CSS rule, embed(), and one chip for a whole devtools shell" },
  { name: "styling.md", href: withBase("/styling.html"), body: "Tokens, the data-dtb-part list, classNames — and why none of it needs !important" },
  { name: "testing.md", href: withBase("/testing.html"), body: "renderWithToolbar, makeExtension(), the fake layout, the mock bus and the Jest caveats" },
  { name: "ssr.md", href: withBase("/ssr.html"), body: "Why the bar cannot mismatch on hydration, and the one Next.js app-router rule" },
  { name: "architecture.md", href: withBase("/architecture.html"), body: "What the shell guarantees, why the boundaries sit where they do, and the known gaps" },
  { name: "adr/", href: withBase("/adr/"), body: "Decision records: plain-object extensions, light DOM, contract-version policy, per-extension bar presentation" },
];
</script>

<style>
.dtb-landing-page {
  --vp-nav-height: 56px;
  --vp-nav-bg-color: rgba(11, 11, 13, 0.82);
  --vp-c-bg: #0b0b0d;
  --vp-c-bg-alt: #0b0b0d;
  --vp-c-bg-elv: #16161a;
  --vp-c-text-1: #e9e7e2;
  --vp-c-text-2: #96948e;
  --vp-c-text-3: #6f6e69;
  --vp-c-divider: rgba(255, 255, 255, 0.08);
  --vp-c-gutter: rgba(255, 255, 255, 0.08);
}

.dtb-landing-page .VPNavBarAppearance,
.dtb-landing-page .VPNavScreenAppearance {
  display: none;
}

body:has(.dtb-landing-page) {
  overflow-x: clip;
  background-color: #0b0b0d;
}

.dtb-landing-page .VPNav {
  position: fixed !important;
  top: 0;
  left: 0;
  width: 100%;
}

.dtb-landing-page .VPContent {
  padding-top: var(--vp-nav-height) !important;
}

.dtb-landing-page .VPNavBar {
  border-bottom: 1px solid var(--vp-c-divider);
  backdrop-filter: blur(10px);
}

.dtb-landing-page .VPNavBar .divider,
.dtb-landing-page .VPNavBarSocialLinks::before {
  display: none;
}

.dtb-landing-page .VPNavBar .wrapper {
  padding: 0 20px;
}

.dtb-landing-page .VPNavBar .container,
.dtb-landing-page .VPFooter .container {
  max-width: 1240px;
}

.dtb-landing-page .VPNavBar .social-links {
  border-left: 0;
}

.dtb-landing-page .VPNavBarTitle .title {
  font-family: "IBM Plex Mono", var(--vp-font-family-mono);
  font-size: 14px;
  font-weight: 600;
}

.dtb-landing-page .VPNavBarTitle .title::before {
  display: block;
  width: 9px;
  height: 9px;
  margin-right: 10px;
  flex-shrink: 0;
  background: #b6f06a;
  content: "";
}

.dtb-landing-page .VPNavBarMenu {
  height: var(--vp-nav-height);
}

.dtb-landing-page .VPNavBarMenuLink {
  padding: 0 18px;
  border-right: 1px solid var(--vp-c-divider);
  font-family: "IBM Plex Mono", var(--vp-font-family-mono);
  font-size: 12.5px;
  font-weight: 400;
  text-transform: lowercase;
  transition: color 0.15s, background-color 0.15s;
}

.dtb-landing-page .VPNavBarMenuLink:hover,
.dtb-landing-page .VPNavBarMenuLink.active {
  background: rgba(255, 255, 255, 0.04);
}

.dtb-landing-page .VPNavBarSocialLinks {
  padding-left: 16px;
  margin-left: 4px;
  border-left: 1px solid var(--vp-c-divider);
}

.dtb-landing-page .VPNavBarExtra .menu .group:first-of-type {
  display: none;
}

.dtb-landing-page .VPFooter {
  border-top: 0;
  background: #0b0b0d;
}

.dtb-landing-page .VPFooter .container {
  display: flex;
  align-items: center;
  gap: 12px;
  text-align: left;
}

.dtb-landing-page .VPFooter .message,
.dtb-landing-page .VPFooter .copyright {
  font-family: "IBM Plex Mono", var(--vp-font-family-mono);
  font-size: 12.5px;
  line-height: normal;
}

.dtb-landing-page .VPHome {
  margin-bottom: 0 !important;
}

.dtb-landing {
  --page-bg: #0b0b0d;
  --page-fg: #e9e7e2;
  --page-accent: #b6f06a;
  --page-accent-hover: #c6f78a;
  --page-muted: #96948e;
  --page-copy: #8c8a85;
  --page-dim: #7d7b76;
  --page-line: rgba(255, 255, 255, 0.08);
  width: 100vw;
  min-height: 100vh;
  margin-left: calc(50% - 50vw);
  background: var(--page-bg);
  background-image: radial-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px);
  background-size: 26px 26px;
  color: var(--page-fg);
  font-family: "IBM Plex Mono", var(--vp-font-family-mono);
  -webkit-font-smoothing: antialiased;
}

.dtb-landing *,
.dtb-landing *::before,
.dtb-landing *::after {
  box-sizing: border-box;
}

.dtb-landing a {
  color: var(--page-fg);
  text-decoration: none;
}

.dtb-landing a:hover {
  color: var(--page-accent);
}

.dtb-landing ::selection {
  background: var(--page-accent);
  color: var(--page-bg);
}

.dtb-section {
  max-width: 1240px;
  margin: 0 auto;
  padding-inline: 20px;
}

.dtb-hero {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 22px;
  padding-top: 72px;
  padding-bottom: 44px;
}

.dtb-badge {
  padding: 5px 10px;
  border: 1px solid rgba(182, 240, 106, 0.32);
  color: var(--page-accent);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.dtb-hero h1,
.dtb-cta h2 {
  padding: 0;
  border: 0;
  margin: 0;
  font-family: "IBM Plex Sans", sans-serif;
  font-weight: 600;
  text-wrap: balance;
}

.dtb-hero h1 {
  max-width: 20ch;
  font-size: clamp(34px, 6vw, 62px);
  line-height: 1;
  letter-spacing: -0.045em;
}

.dtb-hero h1 span,
.dtb-accent {
  color: var(--page-accent);
}

.dtb-lead {
  max-width: 52ch;
  margin: 0;
  color: #9a988f;
  font-family: "IBM Plex Sans", sans-serif;
  font-size: clamp(15px, 2.2vw, 18px);
  line-height: 1.6;
  text-wrap: pretty;
}

.dtb-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 2px;
  font-family: "IBM Plex Sans", sans-serif;
}

.dtb-landing .dtb-button {
  padding: 12px 22px;
  font-size: 15px;
  font-weight: 600;
  transition: background-color 0.15s, border-color 0.15s;
}

.dtb-landing .dtb-button-primary {
  background: var(--page-accent);
  color: var(--page-bg);
}

.dtb-landing .dtb-button-primary:hover {
  background: var(--page-accent-hover);
  color: var(--page-bg);
}

.dtb-landing .dtb-button-secondary {
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: var(--page-fg);
  font-weight: 500;
}

.dtb-landing .dtb-button-secondary:hover {
  border-color: var(--page-accent);
  color: var(--page-fg);
}

.dtb-capabilities {
  display: flex;
  width: 100%;
  flex-wrap: wrap;
  gap: 12px 26px;
  margin-top: 10px;
  color: var(--page-dim);
  font-size: 12.5px;
}

.dtb-capabilities > span {
  display: flex;
  align-items: center;
  gap: 9px;
}

.dtb-capabilities i {
  display: block;
  width: 5px;
  height: 5px;
  background: var(--page-accent);
}

.dtb-capabilities strong {
  color: #b4b2ac;
  font-weight: 500;
}

.dtb-section-links {
  display: flex;
  flex-wrap: wrap;
  border: 1px solid var(--page-line);
  margin-top: 4px;
}

.dtb-section-links a {
  padding: 8px 12px;
  border-inline-end: 1px solid var(--page-line);
  color: var(--page-muted);
  font-size: 12px;
}

.dtb-section-links a:last-child {
  border-inline-end: 0;
}

.dtb-frame,
.dtb-grid,
.dtb-doc-list {
  border: 1px solid var(--page-line);
}

.dtb-frame {
  background: rgba(255, 255, 255, 0.015);
}

.dtb-frame-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--page-line);
  color: var(--page-dim);
  font-size: 11.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.dtb-frame-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
}

.dtb-density {
  display: flex;
  gap: 6px;
}

.dtb-density button,
.dtb-tabs button {
  border: 0;
  background: transparent;
  color: var(--page-muted);
  font-family: "IBM Plex Mono", var(--vp-font-family-mono);
  cursor: pointer;
}

.dtb-density button {
  padding: 5px 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: var(--page-dim);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.dtb-density button.active {
  border-color: var(--page-accent);
  background: var(--page-accent);
  color: var(--page-bg);
}

.dtb-bar-stage {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: clamp(18px, 4vw, 46px) clamp(12px, 3vw, 34px);
  background: radial-gradient(ellipse at 50% 130%, rgba(182, 240, 106, 0.08), transparent 62%);
}

.dtb-bar-viewport {
  width: 100%;
  overflow: hidden;
}

.dtb-bar-mock {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 2px;
  padding: 3px 8px;
  border-radius: 9px;
  background: #1c1c1e;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 8px 24px rgba(0, 0, 0, 0.45);
  color: #8e8e93;
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1.35;
  transition: padding 0.18s, font-size 0.18s;
}

.dtb-bar-mock.comfortable {
  padding: 7px 12px;
  font-size: 12.5px;
}

.dtb-bar-run {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  align-items: center;
  gap: 2px;
  overflow: hidden;
  mask-image: linear-gradient(to right, #000 calc(100% - 44px), transparent 100%);
}

.dtb-chip {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  white-space: nowrap;
}

.dtb-glyph {
  display: none;
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}

.dtb-bar-mock.comfortable .dtb-glyph {
  width: 13px;
  height: 13px;
}

.dtb-bar-mock.icons .dtb-glyph {
  display: block;
}

.dtb-bar-mock.icons .dtb-glyph + .dtb-label {
  display: none;
}

.dtb-chip strong {
  color: #f2f2f7;
}

.dtb-dot {
  display: block;
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: 50%;
  background: #6e6e73;
}

.dtb-dot.dtb-warn {
  background: #e9a13b;
}

.dtb-chip .dtb-warn-text {
  color: #e9a13b;
}

.dtb-dot.dtb-good {
  background: #4cd964;
}

.dtb-dot.dtb-white {
  background: #fff;
}

.dtb-divider {
  width: 1px;
  height: 14px;
  flex-shrink: 0;
  margin: 0 8px;
  background: rgba(255, 255, 255, 0.12);
}

.dtb-chip-outline {
  padding-inline: 12px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 999px;
}

.dtb-chip-filled {
  padding-inline: 13px;
  border-radius: 999px;
  background: #2f7cf6;
}

.dtb-hotkey,
.dtb-actor,
.dtb-more {
  flex-shrink: 0;
}

.dtb-hotkey {
  padding: 3px 9px;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

.dtb-more {
  padding: 3px 4px 3px 2px;
  font-size: 14px;
  line-height: 1;
}

.dtb-bar-caption {
  margin: 0;
  color: var(--page-dim);
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
}

.dtb-grid {
  display: grid;
}

.dtb-feature-grid {
  grid-template-columns: repeat(3, 1fr);
  border-top: 0;
}

.dtb-feature {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 26px 22px 30px;
  border-right: 1px solid var(--page-line);
  border-bottom: 1px solid var(--page-line);
}

.dtb-feature:nth-child(3n),
.dtb-extension-card:nth-child(3n) {
  border-right: 0;
}

.dtb-feature:nth-last-child(-n + 3),
.dtb-extension-card:nth-last-child(-n + 3) {
  border-bottom: 0;
}

.dtb-feature > div:last-child,
.dtb-extension-card > div:nth-child(2),
.dtb-write-notes p,
.dtb-contributing-grid p,
.dtb-section-heading p,
.dtb-doc-list p {
  margin: 0;
  color: var(--page-copy);
  font-family: "IBM Plex Sans", sans-serif;
  font-size: 14.5px;
  line-height: 1.55;
  text-wrap: pretty;
}

.dtb-feature span,
.dtb-write-notes code {
  color: #c8c6c0;
}

.dtb-content-section,
.dtb-cta-section {
  padding-top: 60px;
}

.dtb-eyebrow {
  padding: 0;
  border: 0;
  margin: 0 0 24px;
  font-family: inherit;
  font-weight: 400;
  line-height: inherit;
  color: var(--page-dim);
  font-size: 11.5px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.dtb-tabs {
  display: flex;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--page-line);
}

.dtb-tabs button {
  padding: 13px 20px;
  border-right: 1px solid var(--page-line);
  border-bottom: 1px solid transparent;
  margin-bottom: -1px;
  font-size: 12.5px;
}

.dtb-tabs button.active {
  border-bottom-color: var(--page-accent);
  background: rgba(182, 240, 106, 0.1);
  color: var(--page-accent);
}

.dtb-code-pane,
.dtb-write-code {
  overflow-x: auto;
}

.dtb-code-pane {
  padding: clamp(18px, 3vw, 30px);
}

.dtb-landing pre {
  margin: 0;
  background: transparent;
  color: #c8c6c0;
  font-family: "IBM Plex Mono", var(--vp-font-family-mono);
  font-size: 13.5px;
  line-height: 1.85;
}

.dtb-landing pre span {
  display: block;
}

.dtb-landing pre b,
.dtb-cta code span {
  color: var(--page-accent);
  font-weight: inherit;
}

.dtb-landing pre em {
  color: #7fb0c8;
  font-style: normal;
}

.dtb-landing pre mark {
  background: transparent;
  color: #e9c46a;
}

.dtb-code-comment {
  color: var(--page-dim);
}

.dtb-section-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}

.dtb-section-heading .dtb-eyebrow {
  margin-bottom: 0;
}

.dtb-section-heading p {
  font-size: 14px;
}

.dtb-extension-grid {
  grid-template-columns: repeat(3, 1fr);
}

.dtb-extension-card {
  display: flex;
  min-height: 180px;
  flex-direction: column;
  gap: 10px;
  padding: 24px 22px 28px;
  border-right: 1px solid var(--page-line);
  border-bottom: 1px solid var(--page-line);
  background: rgba(255, 255, 255, 0.012);
  transition: background-color 0.15s;
}

.dtb-extension-card:hover {
  background: rgba(182, 240, 106, 0.055);
}

.dtb-extension-card small {
  padding-top: 8px;
  margin-top: auto;
  color: var(--page-dim);
  font-size: 11.5px;
}

.dtb-subpath-grid {
  grid-template-columns: repeat(4, 1fr);
  border-top: 0;
}

.dtb-subpath-grid > div {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 20px 22px;
  border-right: 1px solid var(--page-line);
  font-size: 12.5px;
}

.dtb-subpath-grid > div:last-child {
  border-right: 0;
}

.dtb-subpath-grid small {
  color: var(--page-dim);
  font-size: 12px;
  line-height: 1.5;
}

.dtb-write-grid {
  grid-template-columns: repeat(2, 1fr);
}

.dtb-write-code {
  padding: clamp(18px, 3vw, 30px);
  border-right: 1px solid var(--page-line);
}

.dtb-write-code pre {
  font-size: 13px;
}

.dtb-write-notes {
  display: flex;
  flex-direction: column;
}

.dtb-write-notes > div {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  padding: 22px 24px;
  border-bottom: 1px solid var(--page-line);
}

.dtb-write-notes > div:last-child {
  border-bottom: 0;
}

.dtb-write-notes strong,
.dtb-contributing-grid strong {
  color: var(--page-accent);
  font-size: 12.5px;
  font-weight: 500;
}

.dtb-write-notes .dtb-rule-note {
  background: rgba(182, 240, 106, 0.05);
}

.dtb-doc-list > a {
  display: grid;
  grid-template-columns: minmax(150px, 230px) 1fr;
  align-items: baseline;
  gap: 14px 24px;
  padding: 18px 22px;
  border-bottom: 1px solid var(--page-line);
  transition: background-color 0.15s;
}

.dtb-doc-list > a:hover {
  background: rgba(255, 255, 255, 0.03);
}

.dtb-doc-list > a > span {
  color: var(--page-accent);
  font-size: 13px;
}

.dtb-doc-note {
  padding: 18px 22px;
  color: var(--page-dim);
  font-size: 12px;
  line-height: 1.7;
}

.dtb-contributing-grid {
  grid-template-columns: repeat(3, 1fr);
}

.dtb-contributing-grid > div {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 26px 22px;
  border-right: 1px solid var(--page-line);
}

.dtb-contributing-grid > div:last-child {
  border-right: 0;
}

.dtb-contributing-grid pre {
  font-size: 13px;
}

.dtb-contributing-grid p {
  font-size: 14px;
}

.dtb-cta {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: clamp(40px, 7vw, 72px) 24px;
  border: 1px solid var(--page-line);
  background: radial-gradient(ellipse at 50% 130%, rgba(182, 240, 106, 0.13), transparent 60%);
  text-align: center;
}

.dtb-cta h2 {
  max-width: 22ch;
  font-size: clamp(24px, 4.4vw, 40px);
  line-height: 1.15;
  letter-spacing: -0.035em;
}

.dtb-cta code {
  padding: 13px 20px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(0, 0, 0, 0.4);
  color: #c8c6c0;
  font-family: "IBM Plex Mono", var(--vp-font-family-mono);
  font-size: 14px;
}

@media (max-width: 900px) {
  .dtb-feature-grid,
  .dtb-extension-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .dtb-feature:nth-child(3n),
  .dtb-extension-card:nth-child(3n) {
    border-right: 1px solid var(--page-line);
  }

  .dtb-feature:nth-child(2n),
  .dtb-extension-card:nth-child(2n) {
    border-right: 0;
  }

  .dtb-feature:nth-last-child(-n + 3),
  .dtb-extension-card:nth-last-child(-n + 3) {
    border-bottom: 1px solid var(--page-line);
  }

  .dtb-feature:nth-last-child(-n + 2),
  .dtb-extension-card:last-child {
    border-bottom: 0;
  }

  .dtb-subpath-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .dtb-subpath-grid > div:nth-child(2) {
    border-right: 0;
  }

  .dtb-subpath-grid > div:nth-child(-n + 2) {
    border-bottom: 1px solid var(--page-line);
  }
}

@media (max-width: 700px) {
  .dtb-hero {
    padding-top: 52px;
  }

  .dtb-feature-grid,
  .dtb-extension-grid,
  .dtb-write-grid,
  .dtb-contributing-grid {
    grid-template-columns: 1fr;
  }

  .dtb-feature,
  .dtb-feature:nth-child(2n),
  .dtb-feature:nth-child(3n),
  .dtb-extension-card,
  .dtb-extension-card:nth-child(2n),
  .dtb-extension-card:nth-child(3n),
  .dtb-contributing-grid > div,
  .dtb-write-code {
    border-right: 0;
    border-bottom: 1px solid var(--page-line);
  }

  .dtb-feature:last-child,
  .dtb-extension-card:last-child,
  .dtb-contributing-grid > div:last-child {
    border-bottom: 0;
  }

  .dtb-section-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .dtb-doc-list > a {
    grid-template-columns: 1fr;
  }

  .dtb-actor {
    display: none;
  }
}

@media (max-width: 480px) {
  .dtb-section {
    padding-inline: 14px;
  }

  .dtb-section-links {
    display: grid;
    width: 100%;
    grid-template-columns: repeat(2, 1fr);
  }

  .dtb-section-links a:nth-child(2) {
    border-right: 0;
  }

  .dtb-section-links a:nth-child(-n + 2) {
    border-bottom: 1px solid var(--page-line);
  }

  .dtb-frame-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .dtb-density {
    width: 100%;
  }

  .dtb-density button,
  .dtb-tabs button {
    flex: 1;
  }

  .dtb-tabs {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
  }

  .dtb-subpath-grid {
    grid-template-columns: 1fr;
  }

  .dtb-subpath-grid > div,
  .dtb-subpath-grid > div:nth-child(2) {
    border-right: 0;
    border-bottom: 1px solid var(--page-line);
  }

  .dtb-subpath-grid > div:last-child {
    border-bottom: 0;
  }

  .dtb-cta code {
    max-width: 100%;
    overflow-x: auto;
  }
}
</style>
