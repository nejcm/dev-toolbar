/**
 * `@nejcm/dev-toolbar/testing` — test helpers for extension authors, in this
 * repo and outside it. Reaches only core, never `src/runtime/` or `src/ext/*`;
 * core values come through `@nejcm/dev-toolbar` (so a CommonJS consumer shares
 * one instance), types come from `../core/*`.
 *
 * `renderWithToolbar` needs the optional peer `@testing-library/react`, which
 * nothing else here imports statically — so this subpath still works without
 * it, and `renderWithToolbar()` throws a message naming the remedy if it's missing.
 */
export { renderWithToolbar } from "./renderWithToolbar";
export type {
  RenderWithToolbarOptions,
  RenderWithToolbarResult,
  ToolbarHandle,
} from "./renderWithToolbar";

export { cleanupToolbar, mountToolbar } from "./lifecycle";

export { setTestingLibrary, testingLibraryReady } from "./reactTestingLibrary";
export type { ReactTestingLibrary } from "./reactTestingLibrary";

export { makeCommand, makeExtension, resetExtensionIds } from "./makeExtension";
export type { MakeCommandOptions, MakeExtensionOptions } from "./makeExtension";

export { fakeExtensionApi } from "./fakeExtensionApi";
export type { FakeExtensionApi, FakeExtensionApiOptions } from "./fakeExtensionApi";

export { createMockBus } from "./mockBus";
export type {
  CreateMockBusOptions,
  MockBus,
  MockBusEvent,
  MockBusHandler,
  MockBusSubscribeOptions,
  MockClock,
} from "./mockBus";

export { installToolbarLayout } from "./layout";
export type { InstallToolbarLayoutOptions, ToolbarLayoutHandle } from "./layout";

// The package's own specifier, not `../core/storage` — AGENTS.md, *Conventions*.
export { createMemoryStorage, createNullStorage } from "@nejcm/dev-toolbar";
