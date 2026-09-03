/**
 * Toolbar state probe for the verify-dev-toolbar skill.
 *
 * Load it into the playground tab through Vite's `/@fs` route and evaluate it
 * with `mcp__Claude_Browser__javascript_tool` (SKILL.md shows the one-liner).
 * It returns a JSON-serialisable snapshot of every stable handle the shell and
 * the first-party extensions publish, so a verification step can assert on
 * state instead of on pixels.
 *
 * Read-only: it queries the DOM, computed styles and localStorage, and mutates
 * nothing.
 */
(() => {
  const q = (sel, root = document) => root.querySelector(sel);
  const all = (sel, root = document) => [...root.querySelectorAll(sel)];
  const part = (name, root = document) => q(`[data-dtb-part="${name}"]`, root);
  const clean = (value) => value.replace(/\s+/g, " ").trim();
  const text = (el) => (el ? clean(el.textContent) : null);
  // Text of `el` with any descendant of `sel` left out — sibling marker spans
  // carry no separating whitespace, so a plain textContent read yields
  // `[redacted]masked`. Element-walking, not string surgery: no mutation.
  const textWithout = (el, sel) => {
    if (!el) return null;
    let out = "";
    for (const node of el.childNodes) {
      if (node.nodeType === Node.ELEMENT_NODE && node.closest(sel) !== null) continue;
      out += node.textContent ?? "";
    }
    return clean(out);
  };

  const root = part("root");
  const bar = part("bar");
  const panel = q('[data-dtb-part="panel"][data-dtb-active="true"]');
  const dialog = part("cmd-dialog");
  const instance = root?.dataset.dtbInstance ?? null;
  const heightVar = instance
    ? `--dev-toolbar-height-${instance.replace(/[^A-Za-z0-9_-]+/g, "_")}`
    : null;

  const item = (el) => ({
    id: el.dataset.dtbExtId ?? null,
    align: el.dataset.dtbAlign ?? null,
    panelOpen: el.dataset.dtbPanelOpen === "true",
    label: text(part("trigger", el)) ?? text(el),
  });

  const flagValue = (row, role) =>
    text(q(`[data-dtb-part="flag-value"][data-dtb-role="${role}"]`, row));

  return {
    url: location.href,
    // When this document was navigated to (ISO 8601, UTC). Vite picks a
    // rebuilt dist/ up through HMR, not a reload, so this is the only fact
    // that says which build a tab can be serving: a `loadedAt` earlier than
    // the `dist/ built` stamp doctor.sh prints means the tab was never
    // reloaded over the current build. Compare after a `navigate`, not
    // before — HMR leaves it untouched.
    loadedAt: new Date(performance.timeOrigin).toISOString(),
    mounted: root !== null,
    shell: root && {
      instance,
      position: root.dataset.dtbPosition ?? null,
      density: root.dataset.dtbDensity ?? null,
      colorScheme: root.dataset.dtbColorScheme ?? null,
      barLabel: bar?.getAttribute("aria-label") ?? null,
      barRect: bar
        ? (({ top, bottom, height, left, width }) => ({ top, bottom, height, left, width }))(
            bar.getBoundingClientRect(),
          )
        : null,
    },
    // The unsuffixed name belongs to instanceId "default" only; this app is "playground".
    heightVariable: heightVar && {
      name: heightVar,
      value: document.documentElement.style.getPropertyValue(heightVar).trim() || null,
      unsuffixed:
        document.documentElement.style.getPropertyValue("--dev-toolbar-height").trim() || null,
    },
    inset: (() => {
      const el = part("inset");
      return (
        el && {
          position: el.dataset.dtbPosition ?? null,
          paddingBottom: getComputedStyle(el).paddingBottom,
          paddingTop: getComputedStyle(el).paddingTop,
        }
      );
    })(),
    // A collapsed extension is REMOVED from its region and re-rendered inside
    // the `···` menu, so `bar` lists only what is still visible — there is no
    // "overflowed" flag on a bar item to wait for. `overflow.menuItems` is
    // empty until the menu is opened. Compare the two lists.
    bar: all('[data-dtb-part="region"] > [data-dtb-part="item"][data-dtb-ext-id]').map(item),
    overflow: {
      buttonVisible: part("overflow-button") !== null,
      buttonLabel: part("overflow-button")?.getAttribute("aria-label") ?? null,
      expanded: part("overflow-button")?.getAttribute("aria-expanded") ?? null,
      menuOpen: part("overflow-menu") !== null,
      menuItems: all('[data-dtb-part="overflow-menu-item"]').map(
        (el) => el.dataset.dtbExtId ?? null,
      ),
    },
    panel: panel && {
      extension: panel.dataset.dtbExtId ?? null,
      label: panel.getAttribute("aria-label"),
      height: panel.getBoundingClientRect().height,
      // Trimmed: a full panel dump drowns the diff. Grep the returned text instead.
      body: text(part("panel-body", panel))?.slice(0, 1200) ?? null,
    },
    commandMenu: dialog && {
      open: true,
      inputValue: part("cmd-input")?.value ?? null,
      empty: text(part("cmd-empty")),
      error: text(part("cmd-error")),
      // Browse mode (empty query) groups into `cmd-section` headings; search
      // mode drops the headings and puts the group on each option instead.
      sections: all('[data-dtb-part="cmd-section"]').map(text),
      options: all('[data-dtb-part="cmd-option"]').map((el) => ({
        label: text(part("cmd-option-label", el)),
        group: text(part("cmd-option-group", el)),
        selected: el.getAttribute("aria-selected") === "true",
      })),
    },
    // The host is `display: contents`, so its own computed `pointer-events`
    // and `z-index` are always `auto` and prove nothing. The layer is the
    // child: its presence is the on/off signal and its computed
    // `pointer-events` is the click-through one.
    overlays: all('[data-dtb-part="overlay"]').map((el) => {
      const layer = el.firstElementChild;
      return {
        extension: el.dataset.dtbExtId ?? null,
        children: el.children.length,
        childPointerEvents: layer ? getComputedStyle(layer).pointerEvents : null,
      };
    }),
    errorChips: all('[data-dtb-part="error-chip"]').map((el) => ({
      extension: el.dataset.dtbExtId ?? null,
      slot: el.dataset.dtbSlot ?? null,
      text: text(el),
    })),
    flags: {
      promoted: text(part("flag-promoted")),
      chip: text(part("flag-chip")),
      rows: all('[data-dtb-part="flag-row"]').map((el) => ({
        key: text(part("flag-key", el)),
        tags: all('[data-dtb-part="flag-tag"]', el).map((tag) => tag.dataset.dtbTag ?? text(tag)),
        // The four real handles, not the run-together text of their container:
        // the value spans carry no separating whitespace between them.
        values: {
          effective: flagValue(el, "effective"),
          base: flagValue(el, "base"),
          default: flagValue(el, "default"),
          source: text(part("flag-source", el))?.replace(/^source\s+/, "") ?? null,
        },
        switchChecked: q('[role="switch"]', el)?.getAttribute("aria-checked") ?? null,
      })),
      appReadout: all('[data-testid="flag-readout"] li').map(text),
    },
    environment: {
      chip: text(part("env-chip")),
      severity: part("env-chip")?.dataset.dtbSeverity ?? null,
      banner: text(part("env-banner")),
      rows: all('[data-dtb-part="env-group"]').flatMap((group) =>
        all('[data-dtb-part="env-row-label"]', group).map((label, i) => {
          const value = all('[data-dtb-part="env-row-value"]', group)[i];
          return {
            group: group.dataset.dtbGroup ?? null,
            label: text(label),
            // The `masked` / `detected` markers are sibling spans inside the
            // row value, so they are reported separately from the value.
            value: textWithout(value, '[data-dtb-part="env-tag"]'),
            markers: value
              ? all('[data-dtb-part="env-tag"]', value).map(
                  (tag) => tag.dataset.dtbTag ?? text(tag),
                )
              : [],
          };
        }),
      ),
    },
    themeTokens: all('[data-testid="theme-swatches"] .pg-theme-swatch').map(text),
    storage: Object.fromEntries(
      Object.keys(localStorage)
        .filter((key) => key.startsWith("dtb:v1:"))
        .sort()
        .map((key) => [key, localStorage.getItem(key)]),
    ),
  };
})();
