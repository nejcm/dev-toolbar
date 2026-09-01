/**
 * `@nejcm/dev-toolbar/testing`
 *
 * Test helpers for people writing extensions — in this repo and outside it.
 * Imports only from `src/core/*`; never from `src/runtime/` or `src/ext/*`.
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
  MockClock,
} from "./mockBus";

export { installToolbarLayout } from "./layout";
export type { InstallToolbarLayoutOptions, ToolbarLayoutHandle } from "./layout";

export { createMemoryStorage, createNullStorage } from "../core/storage";
