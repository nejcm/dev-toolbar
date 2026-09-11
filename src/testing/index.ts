/**
 * `@nejcm/dev-toolbar/testing` — test helpers for extension authors. Core
 * values come through `@nejcm/dev-toolbar`, never a relative `../core/*`
 * import — the CJS build doesn't code-split, so a relative import would
 * inline a second core into `dist/testing.cjs` and give a CJS consumer two
 * instances. Types may still come from `../core/*` since they erase.
 *
 * `renderWithToolbar` needs the optional peer `@testing-library/react`;
 * nothing else here imports it statically, so the rest of this subpath works
 * without it.
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
export type {
  InstallToolbarLayoutOptions,
  ToolbarLayoutHandle,
  ToolbarLayoutObserver,
} from "./layout";

export { installClipboard } from "./clipboard";
export type { ClipboardStub, ClipboardWrite } from "./clipboard";

// Package specifier, not `../core/storage` — see this file's header.
export { createMemoryStorage, createNullStorage } from "@nejcm/dev-toolbar";
