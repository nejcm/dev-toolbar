# Linear-inspired internal developer toolbar

It combines what is visible in the supplied screenshot, what Linear has publicly confirmed, and implementation recommendations where Linear’s exact internals are unknown.
The toolbar should be treated as an extensible internal developer platform—not merely a row of counters.

## 1. Product objective

Build an always-available, low-overhead toolbar inside the real application that lets authorized employees:

* See important runtime-health signals continuously.
* Toggle feature flags without leaving the current screen.
* Compare old and new implementations instantly.
* Inspect the environment, authenticated actor and application context.
* Activate visual debugging overlays.
* Open specialized project tools such as a theme-token editor.
* Capture a diagnostic snapshot for bug reports.
* Make migrations visible and measurable across normal application usage.

The fundamental feedback loop is:

```mermaid
flowchart TD
    A["Use real application"] --> B["Observe live signals"]
    B --> C{"Problem detected?"}
    C -- Yes --> D["Open detail panel"]
    D --> E["Toggle flag or overlay"]
    E --> F["Compare in place"]
    F --> G["Copy diagnostic snapshot"]
    C -- No --> A
```

## 2. What is visible in the screenshot

The screenshot shows a toolbar attached to the bottom of Linear’s desktop application.

### Left-hand controls

| Visible item            | Likely responsibility                                       | Confidence |
| ----------------------- | ----------------------------------------------------------- | ---------: |
| Purple status indicator | Current application/build status                            |     Medium |
| `Prod`                  | Backend or deployment environment                           |       High |
| `user`                  | Current actor/account mode                                  |     Medium |
| `internal`              | Employee/internal-access status or workspace type           |     Medium |
| Arrow-in-box and `none` | Impersonation, override, branch or special session selector |        Low |
| Sparkle icon            | Experiments or internal tools                               |     Medium |
| Bug icon                | Debugging/diagnostics                                       |       High |
| Moon icon               | Theme or appearance control                                 |       High |
| Flag icon               | Feature-flag browser                                        |       High |
| `UI Facelift 2026`      | Promoted feature flag/experiment                            |       High |

### Right-hand metrics

| Visible item   | Recommended interpretation             |
| -------------- | -------------------------------------- |
| `⌘`            | Keyboard shortcut/help or command menu |
| `Mem 0.82GB`   | JavaScript heap usage                  |
| `Delay 418ms`  | Recent interaction/input delay         |
| Icon + `5,629` | DOM-node or rendered-component count   |
| `Jank 17%`     | Percentage of dropped/late frames      |
| `Net 0`        | Active network requests                |
| `Hydr NA`      | Hydration duration/status              |
| Down arrow     | Open expanded diagnostic drawer        |
| Minus          | Collapse toolbar                       |

The StyleX article shows a newer or differently configured version with a styled-components counter inserted among these metrics. This suggests metrics are registered dynamically rather than permanently hard-coded.

## 3. Recommended feature set

### A. Toolbar shell

The shell is responsible for:

* Fixed bottom placement.
* Compact and expanded modes.
* Module registration.
* Metric severity colors.
* Tooltips explaining every value.
* Keyboard navigation.
* Persisted preferences.
* Overflow handling.
* A command menu.
* An expandable details drawer.

Recommended behavior:

* Height: 28–32 px.
* Expanded drawer: 320–480 px.
* Do not cover application content; expose a CSS variable such as `--dev-toolbar-height`.
* Use a portal or Shadow DOM boundary to avoid application CSS affecting the toolbar.
* Allow repositioning to top or bottom.
* Add a shortcut such as `Ctrl/Cmd + Shift + .`.
* Save visibility and enabled modules per developer.
* Pause expensive collection when hidden or when the document is not visible.

### B. Environment and session context

Display:

* Environment: local, preview, staging or production.
* Release version and Git SHA.
* Branch or preview deployment ID.
* Region.
* API endpoint.
* Build timestamp.
* Current user ID.
* Workspace/tenant ID.
* Employee/internal-user status.
* Impersonation status.
* Permissions or role.
* Sync connection status.

Clicking the context area should open a panel with copyable values:

```text
Environment: production
Release: web-2026.08.28.4
Commit: a84c7e1
Region: ap-southeast-1
User: usr_123
Workspace: ws_456
Route: /acme/project/ABC
Flags: ui-facelift=true, new-header=false
```

Security rules:

* Never expose access tokens or complete session cookies.
* Mask email addresses and personally identifiable values in copied snapshots by default.
* Make impersonation visually unmistakable.
* Audit impersonation and production-level flag mutations.

### C. Feature-flag controls

This is one of the most valuable parts of Linear’s implementation.

Include:

* Searchable list of all available flags.
* Current evaluated value.
* Default value.
* Local override value.
* Evaluation source: default, rule, cohort, workspace or local override.
* Flag owner.
* Description.
* Expiration date.
* Related project/issue URL.
* “Recently used” and “promoted” flags.
* One-click Boolean toggles.
* Typed editors for string, numeric and variant flags.
* Clear individual/all overrides.
* Copy a shareable override recipe.
* Optional side-by-side or rapid-toggle comparison mode.

Use two mutation levels:

1. **Local session override:** safe, immediate and stored locally.
2. **Remote flag change:** privileged, confirmed, audited and performed through the backend.

For visual comparisons, local overrides should update without a full reload whenever the application architecture supports it. If a flag cannot be changed safely at runtime, label it “reload required.”

Example model:

```ts
type FlagValue = boolean | string | number | null;

interface FeatureFlagDefinition {
  key: string;
  label: string;
  description?: string;
  owner?: string;
  type: "boolean" | "string" | "number" | "variant";
  defaultValue: FlagValue;
  reloadBehavior: "live" | "route-refresh" | "full-reload";
  expiresAt?: string;
  projectUrl?: string;
}

interface EvaluatedFlag {
  definition: FeatureFlagDefinition;
  value: FlagValue;
  source: "default" | "server-rule" | "cohort" | "local-override";
  override?: FlagValue;
}
```

Override precedence:

```text
local toolbar override
        ↓
URL/shared recipe override
        ↓
server-side user/workspace evaluation
        ↓
flag default
```

Local overrides should be namespaced by environment, user and workspace so a staging override cannot accidentally affect production testing.

### D. Runtime performance HUD

Every metric needs:

* Current value.
* Unit.
* Rolling window.
* Severity threshold.
* Short explanation.
* Small historical sparkline.
* Click-through details.
* Reset button.
* “Copy diagnostic data.”

#### Memory

On Chromium/Electron:

```ts
const memory = (
  performance as Performance & {
    memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
  }
).memory;
```

Display:

* Used JS heap.
* Total allocated heap.
* Heap limit.
* Change over the last minute.
* Warnings for sustained growth.

Limitations:

* `performance.memory` is Chromium-specific and non-standard.
* In unsupported browsers, show `NA`.
* Do not present it as total process memory.

Recommended status thresholds should be relative:

* Green: under 50% of heap limit.
* Yellow: 50–75%.
* Red: above 75% or sustained monotonic growth.

Use a rolling series rather than alarming on a single garbage-collection cycle.

#### Delay

Implement an INP-like interaction monitor using `PerformanceObserver` and Event Timing:

```ts
const observer = new PerformanceObserver(list => {
  for (const entry of list.getEntries()) {
    if (entry.entryType !== "event") continue;

    const event = entry as PerformanceEventTiming;
    const duration = event.duration;
    const inputDelay = event.processingStart - event.startTime;
    const processing = event.processingEnd - event.processingStart;

    interactionStore.record({
      name: event.name,
      duration,
      inputDelay,
      processing,
      startTime: event.startTime,
    });
  }
});

observer.observe({
  type: "event",
  buffered: true,
  durationThreshold: 16,
});
```

Show:

* Last significant interaction.
* Worst interaction over a rolling 30-second window.
* Input delay.
* Handler processing time.
* Presentation delay when measurable.
* Target element description.

Recommended coloring:

* Green: ≤200 ms.
* Yellow: 200–500 ms.
* Red: >500 ms.

Those boundaries align with INP guidance, but the toolbar should make clear whether it shows the latest event, maximum, or rolling percentile.

#### Jank

Use `requestAnimationFrame` to detect late frames during active interaction or animation windows.

```ts
const FRAME_MS = 1000 / 60;

function frameLoop(now: number) {
  if (previousFrame) {
    const delta = now - previousFrame;
    const expectedFrames = Math.max(1, Math.round(delta / FRAME_MS));
    const droppedFrames = Math.max(0, expectedFrames - 1);

    frameStore.record({
      delta,
      expectedFrames,
      droppedFrames,
    });
  }

  previousFrame = now;
  requestAnimationFrame(frameLoop);
}
```

Recommended calculation:

```text
jank percentage =
  dropped frames / expected frames × 100
```

Calculate it over a rolling five-second active window. Avoid counting long periods where:

* The tab is backgrounded.
* The window is minimized.
* The computer wakes from sleep.
* Browser throttling is active.
* No meaningful interaction or animation is occurring.

The detail view should correlate jank with:

* Long tasks.
* React commits.
* Layout shifts.
* Network completions.
* Garbage-collection indicators, where accessible.

Suggested thresholds:

* Green: <2%.
* Yellow: 2–5%.
* Red: >5%.

These should be configurable based on real application baselines.

#### Network

Instrument the application’s HTTP client instead of globally monkey-patching `fetch` where possible.

Track:

* Active requests.
* Request duration.
* Response status.
* Transferred bytes when available.
* Cache hits.
* Retries.
* Aborts.
* WebSocket/sync state.
* Slow requests.
* Failed requests.

Example instrumentation:

```ts
interface NetworkEvent {
  id: string;
  method: string;
  url: string;
  category?: "api" | "sync" | "asset" | "analytics";
  startedAt: number;
  completedAt?: number;
  status?: number;
  bytes?: number;
  cached?: boolean;
  error?: string;
}
```

The compact `Net` metric can mean active request count. Its drawer should show recent request history.

Redact:

* Authorization headers.
* Cookies.
* Query parameters containing tokens.
* Request and response bodies unless explicitly allowed.
* Sensitive GraphQL variables.

#### Hydration

Instrument hydration explicitly rather than trying to infer it entirely from resource timing:

```ts
performance.mark("app-hydration-start");

hydrateRoot(container, <App />, {
  onRecoverableError(error, info) {
    hydrationStore.recordError(error, info);
  },
});

// Signal this from a component effect at the hydrated app boundary.
performance.mark("app-hydration-end");
performance.measure(
  "app-hydration",
  "app-hydration-start",
  "app-hydration-end",
);
```

Display:

* `NA` for a fully client-rendered view.
* `Pending` while hydration is underway.
* Duration when complete.
* Recoverable hydration error count.
* Hydrated root count.
* Optional delayed-boundary/Suspense information.

If the application uses streaming SSR, track each significant boundary separately rather than claiming one global hydration duration is complete too early.

#### DOM/render count

The screenshot’s `5,629` is not publicly defined. A DOM-node count is the most useful approximation:

```ts
document.getElementsByTagName("*").length;
```

Improve it by showing:

* Total element count.
* Maximum DOM depth.
* Largest child list.
* Elements added/removed during the last navigation.
* Detached-node estimates where possible.

Do not run a complete DOM traversal every frame. Recount:

* After route completion.
* On demand.
* At a slow interval such as every 5–10 seconds.
* After a debounced `MutationObserver` signal.

A React-specific module could separately track commits and render counts, but it should not depend on private React internals in the initial implementation.

### E. Long-task and responsiveness diagnostics

Add a module based on the Long Tasks API:

```ts
new PerformanceObserver(list => {
  for (const entry of list.getEntries()) {
    longTaskStore.record({
      startTime: entry.startTime,
      duration: entry.duration,
    });
  }
}).observe({ type: "longtask", buffered: true });
```

Show:

* Number of long tasks in the current window.
* Total blocked time.
* Worst task.
* Timestamp.
* Nearby route, interaction and network events.

This module can power the `Delay` and `Jank` investigation drawer even if it is not permanently shown in the compact bar.

### F. Migration counters

This reproduces Linear’s documented StyleX workflow.

The module system should allow teams to register temporary counters such as:

* Styled-components rules remaining.
* Deprecated component instances.
* Legacy API usage.
* Untyped GraphQL requests.
* Old icon system usage.
* Components missing design tokens.
* Pages using an obsolete state library.
* Accessibility violations.

For styled-components specifically:

* Count rules or generated style tags associated with `data-styled`.
* Recalculate after route changes and debounced DOM mutations.
* Provide an overlay that marks legacy and migrated regions.
* Let the user click an element to inspect its relevant component or DOM metadata.

For reliable component-level overlays, explicitly emit development metadata:

```tsx
<Card
  data-dev-component="ProjectCard"
  data-style-engine="stylex"
  data-source="features/projects/ProjectCard.tsx"
/>
```

Avoid attempting to reverse-engineer minified production component names.

### G. Visual inspector and overlays

Recommended overlay modes:

* Component boundaries.
* Style engine: legacy versus new.
* Design-token violations.
* Layout boxes.
* Scroll containers.
* Z-index stacking contexts.
* Focus order.
* Accessible names.
* Rerender flash.
* Slow React commits.
* Feature ownership.
* Experiment variant.
* Offline/sync state.

Overlay architecture:

* Render highlights in a separate top-level layer.
* Use `getBoundingClientRect()` only for visible candidate elements.
* Recalculate on scroll and resize via `requestAnimationFrame`.
* Use `ResizeObserver` selectively.
* Disable overlays automatically before screenshots unless requested.
* Avoid attaching observers to every element.

### H. Theme and design-token editor

Based directly on Linear’s published description, include:

* Base UI color.
* Accent color.
* Contrast.
* Light/dark mode.
* Hue, chroma and lightness controls.
* Individual token overrides.
* Surface/subtree selection.
* Reset token/reset all.
* Before/after comparison.
* Presets and named recipes.
* Import/export JSON.
* Copy CSS variables.
* Share recipe link.
* Figma-compatible export.

Suggested recipe:

```ts
interface ThemeRecipe {
  schemaVersion: 1;
  name: string;
  mode: "light" | "dark";
  inputs: {
    base: string;
    accent: string;
    contrast: number;
  };
  overrides: Record<
    string,
    {
      l?: number;
      c?: number;
      h?: number;
      alpha?: number;
    }
  >;
  createdBy?: string;
  createdAt: string;
}
```

Apply previews through CSS custom properties scoped to the application root or a selected subtree. This provides immediate feedback without regenerating stylesheets.

The Figma pipeline should be deterministic:

```mermaid
flowchart TD
    A["Edit tokens in app"] --> B["Preview real UI"]
    B --> C["Export versioned JSON"]
    C --> D["Validate schema"]
    D --> E["Import with Figma plugin"]
    E --> F["Update Figma variables"]
```

### I. Debugging controls

Useful compact controls include:

* Enable verbose logging.
* Open internal log viewer.
* Clear caches.
* Reset local database.
* Restart sync.
* Simulate offline/slow network.
* Simulate API failures.
* Pause WebSocket updates.
* Force loading/empty/error states.
* Show state-store inspector.
* Copy current route/entity IDs.
* Capture diagnostic snapshot.

Potentially destructive actions—such as clearing the local database—must require confirmation and explain recovery behavior.

### J. Diagnostic snapshot

Provide a one-click “Copy debug report” action containing:

```ts
interface DiagnosticSnapshot {
  generatedAt: string;
  app: {
    version: string;
    commit: string;
    environment: string;
    route: string;
  };
  session: {
    userId?: string;
    workspaceId?: string;
    region?: string;
    online: boolean;
  };
  flags: Record<string, unknown>;
  metrics: {
    heapBytes?: number;
    interactionDelayMs?: number;
    jankPercent?: number;
    activeRequests: number;
    hydrationMs?: number;
    domElements?: number;
    longTasks: number;
  };
  recentErrors: SanitizedError[];
  recentRequests: SanitizedNetworkEvent[];
}
```

Offer Markdown and JSON output. Redact sensitive data before it reaches the clipboard.

## 4. Extensible module architecture

Use a registry so teams can add tools without modifying the toolbar shell.

```ts
interface DevToolbarModule {
  id: string;
  label: string;
  order?: number;

  availability(ctx: ToolbarContext): boolean;

  compact?: React.ComponentType;
  panel?: React.ComponentType;

  start?(api: ToolbarRuntime): void | (() => void);
  commands?: ToolbarCommand[];
}

const modules = new Map<string, DevToolbarModule>();

export function registerDevToolbarModule(
  module: DevToolbarModule,
): () => void {
  modules.set(module.id, module);
  toolbarStore.refresh();

  return () => {
    modules.delete(module.id);
    toolbarStore.refresh();
  };
}
```

Example registration:

```ts
registerDevToolbarModule({
  id: "stylex-migration",
  label: "Style migration",
  order: 60,
  availability: ctx => ctx.internal && ctx.capabilities.styleMigration,
  compact: StyledRuleCounter,
  panel: StyleMigrationPanel,
  start: startStyleMigrationCollector,
});
```

### Suggested package structure

```text
packages/dev-toolbar/
├── core/
│   ├── registry.ts
│   ├── store.ts
│   ├── event-bus.ts
│   ├── permissions.ts
│   └── redaction.ts
├── shell/
│   ├── Toolbar.tsx
│   ├── ToolbarItem.tsx
│   ├── Drawer.tsx
│   └── CommandMenu.tsx
├── collectors/
│   ├── memory.ts
│   ├── interactions.ts
│   ├── frames.ts
│   ├── long-tasks.ts
│   ├── network.ts
│   ├── hydration.ts
│   └── dom.ts
├── modules/
│   ├── environment/
│   ├── flags/
│   ├── performance/
│   ├── network/
│   ├── theme-editor/
│   ├── overlays/
│   └── diagnostics/
└── testing/
    ├── mock-runtime.ts
    └── fixtures.ts
```

## 5. Runtime data architecture

Use a central event bus with small bounded buffers:

```ts
type ToolbarEvent =
  | { type: "navigation"; at: number; route: string }
  | { type: "interaction"; at: number; duration: number }
  | { type: "long-task"; at: number; duration: number }
  | { type: "network-start"; at: number; requestId: string }
  | { type: "network-end"; at: number; requestId: string }
  | { type: "react-commit"; at: number; duration: number }
  | { type: "flag-changed"; at: number; key: string };

interface RingBuffer<T> {
  push(value: T): void;
  latest(count: number): readonly T[];
  clear(): void;
}
```

Principles:

* Store raw high-frequency data in memory only.
* Bound every buffer by time and item count.
* Aggregate before rendering.
* Update compact counters at no more than 2–4 Hz.
* Use `useSyncExternalStore` for React subscriptions.
* Do expensive summarization in a Web Worker when justified.
* Never transmit diagnostics automatically from production.
* Require an explicit opt-in action for uploading a trace.

### Collector lifecycle

Collectors should only run when:

* The user is authorized.
* The module is available.
* Either the toolbar or relevant background metric is enabled.
* The page is visible, where appropriate.

```ts
interface Collector {
  id: string;
  start(runtime: CollectorRuntime): () => void;
  estimatedCost: "minimal" | "moderate" | "high";
  supportsSampling: boolean;
}
```

The toolbar itself should have a performance budget:

* Less than 10 KB initial compressed shell, if practical.
* Modules loaded lazily.
* Under 0.5% idle CPU.
* No continuous layout reads.
* Compact updates capped at 4 Hz.
* No measurable impact on INP.
* Under approximately 5 MB retained memory after long sessions.

## 6. Access and security model

Do not rely on a client-side environment variable alone.

Recommended gate:

1. Server authenticates the user.
2. Server returns signed internal capabilities.
3. Client loads the toolbar bundle only when capabilities permit it.
4. Every privileged server action validates authorization again.

```ts
interface DevToolbarCapabilities {
  enabled: boolean;
  environmentInfo: boolean;
  localFlagOverrides: boolean;
  remoteFlagMutation: boolean;
  impersonation: boolean;
  themeEditor: boolean;
  destructiveDebugActions: boolean;
}
```

Deployment choices:

* **Development:** enabled automatically.
* **Preview/staging:** enabled for authenticated staff.
* **Production:** enabled only for authorized internal accounts.
* **Public users:** toolbar code ideally not loaded at all.

Additional protections:

* Content Security Policy compatible.
* Audit remote flag edits and impersonation.
* Rate-limit privileged endpoints.
* Mark production conspicuously.
* Require confirmation for global or workspace-wide changes.
* Keep local overrides visually indicated at all times.
* Strip sensitive information from logs and copied snapshots.

## 7. UI behavior

### Compact presentation

Use a consistent metric item:

```text
[icon] [short label] [value] [optional mini graph]
```

Colors communicate health:

* Neutral: not enough information or not applicable.
* Green: healthy.
* Yellow: investigate.
* Red: current regression.
* Purple/blue: active override or non-default state.

Never rely on color alone. Include an icon, text status or tooltip.

### Detail drawer

Clicking a metric opens:

* Definition.
* Current value.
* Measurement window.
* Thresholds.
* 30–60 second chart.
* Contributing events.
* Links/actions.
* Reset/copy buttons.

Only one primary drawer should be open at a time. Switching between metrics should preserve captured history.

### Promoted flag

The screenshot’s `UI Facelift 2026` item is worth reproducing.

A team should be able to promote a flag into the toolbar temporarily:

```ts
interface PromotedFlag {
  flagKey: string;
  label: string;
  icon?: string;
  startAt?: string;
  expiresAt?: string;
  audience?: string[];
}
```

This removes search friction during active migrations and organization-wide testing.

## 8. Delivery plan

### Phase 1: Shell and access control — 3–5 days

Build:

* Server-issued capability endpoint.
* Lazy toolbar bootstrap.
* Bottom shell.
* Collapse/expand behavior.
* Keyboard shortcut.
* Module registry.
* Local preference persistence.
* Production/internal visual indicators.

Acceptance criteria:

* Unauthorized users receive neither UI nor privileged data.
* Toolbar causes no layout overlap.
* Modules can register without editing the shell.
* Toolbar is keyboard and screen-reader operable.

### Phase 2: Context and feature flags — 4–6 days

Build:

* Environment/session summary.
* Flag adapter.
* Searchable flag drawer.
* Boolean and variant overrides.
* Promoted flag support.
* Clear-all overrides.
* Shareable JSON recipe.
* Audit-backed remote changes, if required.

Acceptance criteria:

* A developer can toggle the target flag on the current route in one click.
* Flag source and override state are always clear.
* Reload-required flags are identified.
* Overrides never leak across environments.

### Phase 3: Core performance HUD — 5–8 days

Build collectors for:

* Memory.
* Interaction delay.
* Jank.
* Long tasks.
* Network activity.
* Hydration.
* DOM count.

Build:

* Severity thresholds.
* Tooltips.
* Detail panels.
* Rolling graphs.
* Pause/reset behavior.

Acceptance criteria:

* Background tabs do not create false jank warnings.
* Instrumentation overhead stays within the toolbar budget.
* Every metric documents its definition and time window.
* Unsupported APIs show `NA`, not misleading zeroes.

### Phase 4: Diagnostics and overlays — 5–8 days

Build:

* Component metadata convention.
* DOM/component boundary overlay.
* Migration status overlay.
* Network history.
* Long-task correlation timeline.
* Diagnostic snapshot.
* Error/log panel.

Acceptance criteria:

* Selecting a highlighted component identifies its source metadata.
* Copied reports contain no credentials or sensitive bodies.
* Overlay scrolling remains smooth on complex pages.

### Phase 5: Theme editor — 5–10 days

Build:

* Base/accent/contrast controls.
* LCH or OKLCH token manipulation.
* Per-token editor.
* Scoped preview.
* Recipe import/export.
* Before/after toggle.
* Schema validation.
* Figma export contract.

Acceptance criteria:

* Token updates render immediately.
* Reset returns precisely to the original theme.
* JSON round-trips without loss.
* Invalid or outdated recipes produce actionable errors.

### Phase 6: Migration tooling and hardening — 4–7 days

Build:

* Custom metric module API.
* Styled-components/legacy counter.
* Route-aware recalculation.
* Promoted migration metrics.
* Integration tests.
* Performance regression tests.
* Documentation and ownership conventions.

Acceptance criteria:

* A team can add a new counter and drawer without changing core code.
* New modules declare ownership and expiration.
* Temporary tools can be removed cleanly.
* The toolbar can diagnose its own CPU and memory overhead.

A focused two-person team could deliver a strong MVP—shell, flags, context, delay, jank, memory, network and snapshots—in roughly 2–3 weeks. The complete platform would likely take 4–7 weeks depending on the existing feature-flag, telemetry and theming infrastructure.

## 9. Recommended MVP boundary

Start with these nine capabilities:

1. Secure internal-only bootstrap.
2. Expandable toolbar shell.
3. Environment/build/session context.
4. Feature-flag search and local overrides.
5. One promoted flag.
6. Delay, jank, memory and network metrics.
7. Long-task detail view.
8. Diagnostic snapshot.
9. Module registration API.

Defer initially:

* React private-internals integration.
* Detached-DOM leak detection.
* Full network response inspection.
* Remote/global flag mutation.
* Figma plugin.
* Complex accessibility auditing.
* Persistent telemetry upload.
* Advanced failure simulation.

This MVP already captures the main reason Linear’s toolbar is effective: it places the most useful comparison controls and runtime signals directly in the application, while preserving the exact state a developer is investigating.

## 10. Sources and confidence boundary

Publicly confirmed behavior comes primarily from:

* [Styling Linear for the future with StyleX](https://linear.app/now/styling-linear-for-the-future-stylex)
* [A calmer interface for a product in motion](https://linear.app/now/behind-the-latest-design-refresh)
* [How we redesigned the Linear UI, part II](https://linear.app/now/how-we-redesigned-the-linear-ui)
* [Linear’s clever internal redesign UI](https://unsung.aresluna.org/linears-clever-internal-redesign-ui/)

Confirmed details include feature-flag switching, in-place comparison, the internal theme editor, JSON/Figma workflow, styled-components counting and style-system highlighting.

The exact meanings of Linear’s `Delay`, `Jank`, `Net`, `Hydr`, `5,629`, `user`, `internal` and `none` indicators remain undocumented. The definitions above are recommended, implementable equivalents based on their labels, placement and established browser instrumentation APIs—not claims about Linear’s private source code.
