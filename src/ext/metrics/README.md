# `ext/metrics`

Memory, interaction delay, jank and in-flight network on the bar, plus whatever
you collect yourself. Every built-in degrades on its own where a browser API is
missing — a chip that cannot be measured says `unsupported` rather than showing
a zero.

- **Subpath:** `@nejcm/dev-toolbar/ext/metrics`
- **Factory:** `metrics(options?)` → `DevToolbarExtension`
- **Full documentation:** [docs/ext/metrics.md](../../../docs/ext/metrics.md)

```tsx
// Built ONCE, at module scope — rebuilding it every render throws away every sample.
const extensions = [metrics({ only: ["memory", "network"] })];
```

## Files

| File | What is in it |
| --- | --- |
| `index.tsx` | The factory, the commands, the clipboard/cURL exports |
| `runtime.ts` | Collector scheduling over `/runtime`'s throttled store |
| `collectors/memory.ts` | `performance.memory`, Chromium-only |
| `collectors/delay.ts` | Interaction delay, from `event-timing` entries |
| `collectors/jank.ts` | Long-task frames |
| `collectors/network.ts` | `fetch`/`XHR` patching, in-flight count and the request ring |
| `curl.ts` | One recorded request as a `curl` line |
| `format.ts` | Number and unit formatting shared by chip and panel |
| `Sparkline.tsx` | The inline history graph |
| `ui.tsx` / `css.ts` / `types.ts` | Chips, panel, stylesheet, the `MetricId` vocabulary |

## What it owns, and what it does not

It owns the sampling loop and the ring buffers. It owns no opinion about what a
number means — no thresholds you did not set, no "good/bad" colouring invented
here. A consumer-supplied collector is a first-class citizen alongside the four
built-ins; `only` selects which built-ins run at all.

Network recording patches `fetch` and `XMLHttpRequest`, calls through, and
restores by identity on teardown. Recorded requests are redacted on the way in,
so the panel, the cURL export and `/ext/diagnostics` all read one masked copy.

## Commands

`<id>.copy`, `<id>.reset`, `<id>.network.clear`, `<id>.network.pause`,
`<id>.network.export`, `<id>.network.copyAsCurl`.

## Options that change behaviour

`only`, `collectors`, `updateHz`, and the per-collector `memory` / `delay` /
`jank` / `network` option bags. The rest (`id`, `label`, `align`, `order`,
`priority`, `hidden`, `injectStyles`, `styleNonce`) are the shell's usual
placement and styling controls.

`presentation` changes how the bar control looks, not what it measures: a
`CompactPreset`, your own `ReactNode` icon (or `(view) => ReactNode`, so N
metrics need no icon map), a `render` callback over `MetricView` and an
accessible-name override. It resolves through `/kit`'s `resolveCompactParts`,
so `"default"` is byte-identical to what shipped before the option existed and
the `⋮` menu always paints the full title. Nothing configured here reaches the
store — a `ReactNode` cannot be signed, so the icon and the callbacks stay in
the factory closure and travel as props.
[ADR-004](../../../docs/adr/ADR-004-per-extension-bar-presentation.md).

## Tests

`__tests__/` covers each collector in isolation, the runtime's scheduling, the
network commands, the cURL formatter and the documented examples.
`presentation.test.tsx` pins the default bar and `⋮` markup as literal strings,
every preset in both places, and the three callbacks.
