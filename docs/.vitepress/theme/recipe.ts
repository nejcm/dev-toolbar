export type Framework = "vite" | "next";

export type ExtensionId =
  | "environment"
  | "metrics"
  | "flags"
  | "command-menu"
  | "overlays"
  | "diagnostics"
  | "theme-editor"
  | "a11y"
  | "agent";

interface ExtensionSpec {
  id: ExtensionId;
  name: string;
  factory: string;
  summary: string;
  /** Shown when selected: what the snippet cannot decide for you. */
  note?: string;
  peer?: string;
  call: (env: (key: string) => string) => string;
}

export const FRAMEWORKS: readonly { id: Framework; name: string }[] = [
  { id: "vite", name: "Vite" },
  { id: "next", name: "Next.js (app router)" },
];

export const EXTENSIONS: readonly ExtensionSpec[] = [
  {
    id: "environment",
    name: "Environment",
    factory: "environment",
    summary: "Environment, release, commit and actor context",
    note: "Shows only what you pass. Wire the env variables your build already sets; unset ones read as unknown.",
    call: (env) =>
      `environment({
    context: {
      environment: ${env("APP_ENV")},
      release: ${env("RELEASE")},
      commit: ${env("COMMIT")},
    },
  })`,
  },
  {
    id: "metrics",
    name: "Metrics",
    factory: "metrics",
    summary: "Memory, frame rate, interaction delay, jank, network",
    call: () => "metrics()",
  },
  {
    id: "flags",
    name: "Flags",
    factory: "flags",
    summary: "Feature flags with local overrides",
    note: "Placeholder catalogue: hand it the flags your app resolved, and add onOverride to make the panel writable.",
    call: () =>
      `flags({
    // Replace with your resolved flags; add onOverride to make the panel writable.
    flags: () => [{ key: "new-checkout", label: "New checkout", value: false }],
  })`,
  },
  {
    id: "command-menu",
    name: "Command menu",
    factory: "commandMenu",
    summary: "A ⌘K palette over every command",
    call: () => "commandMenu()",
  },
  {
    id: "overlays",
    name: "Overlays",
    factory: "overlays",
    summary: "Layout boxes, column grid, inspector, focus order",
    call: () => "overlays()",
  },
  {
    id: "diagnostics",
    name: "Diagnostics",
    factory: "diagnostics",
    summary: "One bug-report snapshot with a console tail",
    note: "Lazy-loaded, it starts after the app's first render, so console output before then is not in the tail.",
    call: () => "diagnostics()",
  },
  {
    id: "theme-editor",
    name: "Theme editor",
    factory: "themeEditor",
    summary: "Live design-token editing",
    note: "Placeholder tokens: list the custom properties your app actually publishes.",
    call: () =>
      `themeEditor({
    // Replace with the custom properties your app publishes.
    tokens: [{ name: "--brand", label: "Brand", group: "Colour", type: "color" }],
  })`,
  },
  {
    id: "a11y",
    name: "Accessibility",
    factory: "a11y",
    summary: "axe-core violations grouped by impact",
    note: 'Needs the optional axe-core peer. loadOn: "scan" defers its download to the first scan.',
    peer: "axe-core",
    call: () => `a11y({ loadOn: "scan" })`,
  },
  {
    id: "agent",
    name: "Agent bridge",
    factory: "agentBridge",
    summary: "Bar state and commands on a global, for an in-page agent",
    note: "Read-only by default; allowRun opts in to running commands. The report option needs a dev-server route of your own.",
    call: () => "agentBridge()",
  },
];

export interface RecipeOptions {
  framework: Framework;
  extensions: readonly ExtensionId[];
  /** Lazy-load the bar behind an env check so it leaves the production bundle. */
  lazy: boolean;
}

export interface RecipeFile {
  path: string;
  code: string;
}

export interface Recipe {
  install: string;
  files: RecipeFile[];
  notes: string[];
}

const envReader: Record<Framework, (key: string) => string> = {
  vite: (key) => `import.meta.env.VITE_${key}`,
  next: (key) => `process.env.NEXT_PUBLIC_${key}`,
};

function toolbarModule(framework: Framework, selected: readonly ExtensionSpec[], lazy: boolean) {
  const imports = [
    `import { DevToolbar } from "@nejcm/dev-toolbar";`,
    ...selected.map((ext) => `import { ${ext.factory} } from "@nejcm/dev-toolbar/ext/${ext.id}";`),
  ];
  if (!lazy) imports.push(`import type { ReactNode } from "react";`);
  const calls = selected.map((ext) => `  ${ext.call(envReader[framework])},`);
  const array = selected.length
    ? `\n// Built once, at module scope — never inside render.\nconst extensions = [\n${calls.join("\n")}\n];\n`
    : "";
  const props = selected.length ? " extensions={extensions}" : "";
  const component = lazy
    ? `export default function DevTools() {\n  return <DevToolbar${props} />;\n}`
    : `export function DevTools({ children }: { children: ReactNode }) {\n  return <DevToolbar${props}>{children}</DevToolbar>;\n}`;
  const directive = framework === "next" ? `"use client";\n` : "";
  return `${directive}${imports.join("\n")}\n${array}\n${component}\n`;
}

const gateComment = (flag: string) =>
  `// Off in every production build, staging included, unless built with ${flag}=true.`;

function viteFiles(toolbar: string, lazy: boolean): RecipeFile[] {
  const main = lazy
    ? `import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

${gateComment("VITE_DEV_TOOLBAR")}
const DevTools =
  import.meta.env.DEV || import.meta.env.VITE_DEV_TOOLBAR === "true"
    ? lazy(() => import("./DevTools"))
    : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    {DevTools && (
      <Suspense fallback={null}>
        <DevTools />
      </Suspense>
    )}
  </StrictMode>,
);
`
    : `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { DevTools } from "./DevTools";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DevTools>
      <App />
    </DevTools>
  </StrictMode>,
);
`;
  return [
    { path: "src/DevTools.tsx", code: toolbar },
    { path: "src/main.tsx", code: main },
  ];
}

function nextFiles(toolbar: string, lazy: boolean): RecipeFile[] {
  if (!lazy) {
    return [
      { path: "app/dev-tools.tsx", code: toolbar },
      {
        path: "app/layout.tsx",
        code: `import type { ReactNode } from "react";
import { DevTools } from "./dev-tools";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DevTools>{children}</DevTools>
      </body>
    </html>
  );
}
`,
      },
    ];
  }
  return [
    { path: "app/dev-toolbar.tsx", code: toolbar },
    {
      path: "app/dev-tools.tsx",
      code: `"use client";
import { Suspense, lazy } from "react";

${gateComment("NEXT_PUBLIC_DEV_TOOLBAR")}
const DevToolbar =
  process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_DEV_TOOLBAR === "true"
    ? lazy(() => import("./dev-toolbar"))
    : null;

export function DevTools() {
  return DevToolbar ? (
    <Suspense fallback={null}>
      <DevToolbar />
    </Suspense>
  ) : null;
}
`,
    },
    {
      path: "app/layout.tsx",
      code: `import type { ReactNode } from "react";
import { DevTools } from "./dev-tools";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <DevTools />
      </body>
    </html>
  );
}
`,
    },
  ];
}

export function buildRecipe({ framework, extensions, lazy }: RecipeOptions): Recipe {
  const selected = EXTENSIONS.filter((ext) => extensions.includes(ext.id));
  const peers = selected.flatMap((ext) => (ext.peer ? [ext.peer] : []));
  const toolbar = toolbarModule(framework, selected, lazy);
  return {
    install: ["npm install @nejcm/dev-toolbar", ...peers].join(" "),
    files: framework === "vite" ? viteFiles(toolbar, lazy) : nextFiles(toolbar, lazy),
    notes: selected
      .filter((ext) => ext.note && (lazy || ext.id !== "diagnostics"))
      .map((ext) => `${ext.name}: ${ext.note}`),
  };
}
