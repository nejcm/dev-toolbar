import { defineConfig } from "vitepress";

const base = "/dev-toolbar/";
const origin = "https://nejcm.github.io";
const siteUrl = `${origin}${base}`;
const socialImage = `${siteUrl}og.png`;

export default defineConfig({
  title: "Dev Toolbar",
  description: "Extensible, low-overhead in-app developer toolbar for React applications.",
  base,
  cleanUrls: false,
  appearance: "force-dark",
  srcExclude: ["adr/ADR-000-template.md"],
  // Only folder READMEs are rewritten: the root one keeps its name so the 18 `../README.md` footers,
  // which must stay valid on GitHub, resolve to a page that exists on the site too.
  rewrites: {
    "adr/README.md": "adr/index.md",
    "ext/README.md": "ext/index.md",
  },
  head: [
    ["link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }],
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap",
      },
    ],
    ["link", { rel: "icon", type: "image/svg+xml", href: `${base}favicon.svg` }],
    ["link", { rel: "icon", type: "image/png", sizes: "96x96", href: `${base}favicon.png` }],
    ["meta", { property: "og:title", content: "Dev Toolbar" }],
    [
      "meta",
      {
        property: "og:description",
        content: "Extensible, low-overhead in-app developer toolbar for React applications.",
      },
    ],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:url", content: siteUrl }],
    ["meta", { property: "og:image", content: socialImage }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ["meta", { name: "twitter:image", content: socialImage }],
    ["meta", { name: "theme-color", content: "#0b0b0d" }],
  ],
  themeConfig: {
    nav: [
      { text: "Docs", link: "/api" },
      { text: "Extensions", link: "/ext/" },
      { text: "Architecture", link: "/architecture" },
    ],
    sidebar: [
      {
        text: "Using the package",
        items: [
          { text: "API reference", link: "/api" },
          { text: "Styling", link: "/styling" },
          { text: "SSR", link: "/ssr" },
          { text: "Testing", link: "/testing" },
        ],
      },
      {
        text: "Writing an extension",
        items: [
          { text: "Extension contract", link: "/extension-contract" },
          { text: "Runtime", link: "/runtime" },
          { text: "Kit", link: "/kit" },
          { text: "Embedding", link: "/embedding" },
          { text: "Architecture", link: "/architecture" },
        ],
      },
      {
        text: "Extensions",
        items: [
          { text: "Extensions overview", link: "/ext/" },
          { text: "Metrics", link: "/ext/metrics" },
          { text: "Environment", link: "/ext/environment" },
          { text: "Flags", link: "/ext/flags" },
          { text: "Command menu", link: "/ext/command-menu" },
          { text: "Overlays", link: "/ext/overlays" },
          { text: "Diagnostics", link: "/ext/diagnostics" },
          { text: "Theme editor", link: "/ext/theme-editor" },
          { text: "Agent", link: "/ext/agent" },
          { text: "Accessibility", link: "/ext/a11y" },
        ],
      },
      {
        text: "Decisions",
        items: [
          { text: "Decision records", link: "/adr/" },
          { text: "ADR-001: Plain objects", link: "/adr/ADR-001-extensions-are-plain-objects" },
          { text: "ADR-002: Light DOM", link: "/adr/ADR-002-light-dom" },
          { text: "ADR-003: Contract versions", link: "/adr/ADR-003-contract-version-policy" },
          {
            text: "ADR-004: Bar presentation",
            link: "/adr/ADR-004-per-extension-bar-presentation",
          },
          { text: "ADR-005: Docs site", link: "/adr/ADR-005-docs-site-over-the-docs-tree" },
        ],
      },
      {
        text: "All documentation",
        items: [{ text: "Documentation index", link: "/README" }],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/nejcm/dev-toolbar" }],
    search: {
      provider: "local",
    },
    outline: {
      level: [2, 3],
      label: "On this page",
    },
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © nejcm",
    },
  },
});
