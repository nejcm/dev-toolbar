# Glossary

Terms this repository uses with one meaning. Code, docs and reviews use them as
defined here.

- **Consumer**: the developer integrating `<DevToolbar>`. Sets Options in code.
- **Viewer**: the person using the bar in a browser, assumed to be a developer.
- **Option**: a prop or factory option set by the Consumer. It is the default.
- **Setting**: the Viewer's per-browser override of an Option. It changes how the bar
  looks, never app behaviour (flag overrides are not Settings).
- **Settings menu**: the cog-triggered popover in the bar where Settings are changed.
- **Shown in bar**: a per-extension Setting that removes the item from the bar and `⋮`
  only. Distinct from `hidden`, which tears the extension down.
- **Presentation preset**: the existing `CompactPreset` vocabulary
  ([ADR-004](./docs/adr/ADR-004-per-extension-bar-presentation.md)), now settable by the
  Viewer ([ADR-006](./docs/adr/ADR-006-viewer-settings.md)).
- **Active time**: frame time that counts toward a rolling frame window. Hidden-tab
  intervals and Stalls are left out.
- **Stall**: a visible gap between frames longer than the idle gap. It is counted, and
  kept out of both FPS and Jank.
- **FPS**: frames delivered per second of Active time.
- **Jank**: dropped frames over expected frames in Active time. It is not the inverse of
  FPS.
- **Shortfall**: `1 − FPS / refresh rate`. It is what FPS thresholds measure.
