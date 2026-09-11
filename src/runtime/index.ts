/**
 * `@nejcm/dev-toolbar/runtime`
 *
 * Opt-in machinery for extensions that *measure* something: an event bus,
 * bounded ring buffers, a store that coalesces high-frequency writes, a
 * derived store that owns snapshot revisions, one shared
 * `fetch`/`XMLHttpRequest` interceptor, and `redact()`. The root entry never
 * imports this subpath, so a toolbar that is three buttons doesn't ship a
 * ring buffer.
 *
 * Framework-free on purpose — nothing here imports React, so a collector can
 * run in a worker. `createThrottledStore()` exposes the `subscribe`/
 * `getSnapshot` pair `useSyncExternalStore` wants.
 */

export { createEventBus } from "./bus";
export type {
  AnyBusEvent,
  AnyBusHandler,
  BusEvent,
  BusEventName,
  BusHandler,
  BusLike,
  BusSubscribeOptions,
  CreateEventBusOptions,
  EventBus,
  ToolbarBus,
  ToolbarEventMap,
} from "./bus";

export { createNumericRing, createRingBuffer, createTimeSeries } from "./ringBuffer";
export type {
  NumericRing,
  NumericRingStats,
  NumericRingView,
  RingBuffer,
  TimeSeries,
} from "./ringBuffer";

export { createThrottledStore } from "./throttledStore";
export type { CreateThrottledStoreOptions, ThrottledStore, Unsubscribe } from "./throttledStore";

export { createDerivedStore } from "./derivedStore";
export type { CreateDerivedStoreOptions, DerivedStore } from "./derivedStore";

export { instrumentFetch, instrumentXhr } from "./network";
export type { NetworkSink, NetworkSinkResult } from "./network";

export { STYLE_ATTRIBUTE, ensureStyleSheet } from "./styles";

export { writeClipboardText, writeClipboardTextOrThrow } from "./clipboard";

export {
  DEFAULT_SENSITIVE_KEYS,
  REDACTED,
  UNREADABLE,
  isSensitiveKey,
  redact,
  redactHeaders,
  redactProse,
  redactText,
  redactUrl,
} from "./redact";
export type { HeaderLike, RedactOptions, RedactTextOptions } from "./redact";

export { describeError, describeErrorUnmasked, formatError } from "./describeError";
export type { ErrorDescription } from "./describeError";
