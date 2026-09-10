import { StrictMode, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { DevToolbar } from "@nejcm/dev-toolbar";
import { embed } from "@nejcm/dev-toolbar/kit";
import { environment } from "@nejcm/dev-toolbar/ext/environment";
import { flags } from "@nejcm/dev-toolbar/ext/flags";

// Core, two `ext/*` and two `embed()`s, one per subpath of the packed package.
// `vendor-live` has a `value` (the kit's chip, a hook on the bar); `vendor` has
// none (core's trigger). What this page is for: ../README.md.

function VendorPanel({ height }: { height: number }): ReactNode {
  const [count, setCount] = useState(0);
  return (
    <section data-vendor="devtools" data-height={height}>
      <button type="button" onClick={() => setCount((n) => n + 1)}>
        vendor count {count}
      </button>
    </section>
  );
}

function Ticks(): ReactNode {
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTicks((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return ticks;
}

const extensions = [
  environment({
    context: () => ({ environment: "fixture", release: "0.0.0", commit: "abc1234" }),
  }),
  flags({
    flags: () => [
      { key: "checkout.v2", label: "Checkout v2", type: "boolean", value: false },
      { key: "search.provider", label: "Search provider", type: "string", value: "legacy" },
    ],
    onOverride: () => {},
  }),
  embed({
    id: "vendor-live",
    label: "vendor-live",
    value: <Ticks />,
    render: ({ height }) => <VendorPanel height={height} />,
  }),
  embed({
    id: "vendor",
    label: "vendor",
    render: ({ height }) => <VendorPanel height={height} />,
  }),
];

function App(): ReactNode {
  return (
    <DevToolbar extensions={extensions} instanceId="vite-consumer">
      <main>
        <h1>vite consumer</h1>
        <p>@nejcm/dev-toolbar, installed from its packed tarball, through Vite's optimizer.</p>
      </main>
    </DevToolbar>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
