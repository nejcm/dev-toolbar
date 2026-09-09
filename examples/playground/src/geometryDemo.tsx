import { useState } from "react";
import { DevToolbar } from "@nejcm/dev-toolbar";
import type { DevToolbarExtension } from "@nejcm/dev-toolbar";
import { agentBridge } from "@nejcm/dev-toolbar/ext/agent";

function GrowingChip() {
  const [wide, setWide] = useState(false);
  return (
    <button type="button" style={{ width: wide ? 320 : 100 }} onClick={() => setWide(!wide)}>
      {wide ? "Shrink chip" : "Grow chip"}
    </button>
  );
}

/**
 * `?geometry` splits the roster across both regions; `?geometry&roster=all-start`
 * puts all three in the start one. The split roster's lone end item is capped
 * against a region that holds nothing else, so a wider gap narrows it and the
 * item observer fires. All three in one region are capped against the whole
 * region together, so each keeps its own width while their sum overruns —
 * the case only a region observer catches.
 */
const roster = (allStart: boolean): DevToolbarExtension[] => [
  { id: "growing", label: "Growing", priority: 3, compact: () => <GrowingChip /> },
  { id: "low", label: "Low priority", priority: 1, compact: () => <span style={{ width: 80 }}>Low priority</span> },
  {
    ...agentBridge({ instanceId: "playground" }),
    align: allStart ? "start" : "end",
    priority: 2,
    compact: () => <span style={{ width: 80 }}>Bridge</span>,
  },
];

export function GeometryDemo() {
  const allStart = new URLSearchParams(location.search).get("roster") === "all-start";
  return (
    <DevToolbar instanceId="playground" extensions={roster(allStart)} storage={null}>
      <style>{'[data-dtb-part="root"] { --dtb-item-gap: 10px; --dtb-padding-x: 10px; }'}</style>
      <main style={{ padding: 24 }}>
        <h1>Toolbar geometry</h1>
        <p>Resize the window or grow the chip to exercise overflow.</p>
      </main>
    </DevToolbar>
  );
}
