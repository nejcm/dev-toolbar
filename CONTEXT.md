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
