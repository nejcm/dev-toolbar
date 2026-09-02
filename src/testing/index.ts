/**
 * `@nejcm/dev-toolbar/testing`
 *
 * Test helpers for people writing extensions — in this repo and outside it.
 * Reaches nothing but core, and never `src/runtime/` or `src/ext/*`. Core
 * *values* come through `@nejcm/dev-toolbar` so that a CommonJS consumer shares
 * the host's one instance; only types come from `../core/*`.
 *
 * `renderWithToolbar` needs `@testing-library/react`, which is an optional peer
 * dependency. Nothing else here does — and nothing here imports it statically,
 * so this subpath imports cleanly on a project that never installed it. Calling
 * `renderWithToolbar()` without it throws a message naming both remedies.
 */
export { renderWithToolbar } from "./renderWithToolbar";
export type {
  RenderWithToolbarOptions,
  RenderWithToolbarResult,
  ToolbarHandle,
} from "./renderWithToolbar";

export { setTestingLibrary, testingLibraryReady } from "./reactTestingLibrary";
export type { ReactTestingLibrary } from "./reactTestingLibrary";

export { makeCommand, makeExtension, resetExtensionIds } from "./makeExtension";
export type { MakeCommandOptions, MakeExtensionOptions } from "./makeExtension";

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
