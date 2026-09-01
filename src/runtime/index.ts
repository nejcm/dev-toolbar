/**
 * `@nejcm/dev-toolbar/runtime`
 *
 * Opt-in machinery for extensions that *measure* something: an event bus,
 * bounded ring buffers, a store that coalesces high-frequency writes, and
 * `redact()`.
 *
 * The root entry never imports any of this. A toolbar that is three buttons
 * should not ship a ring buffer, and this subpath is how that stays true.
 *
 * It is also framework-free on purpose — nothing here imports React, so a
 * collector can run in a worker. `createThrottledStore()` exposes exactly the
 * `subscribe` / `getSnapshot` pair `useSyncExternalStore` wants.
 */

export { createEventBus } from "./bus";
export type {
  BusEvent,
  BusHandler,
  BusSubscribeOptions,
  CreateEventBusOptions,
  EventBus,
  ToolbarBus,
  ToolbarEventMap,
} from "./bus";

export {
  createNumericRing,
  createRingBuffer,
  createTimeSeries,
} from "./ringBuffer";
export type {
  NumericRing,
  NumericRingStats,
  RingBuffer,
  TimeSeries,
} from "./ringBuffer";

export { createThrottledStore } from "./throttledStore";
export type {
  CreateThrottledStoreOptions,
  ThrottledStore,
  Unsubscribe,
} from "./throttledStore";

export { STYLE_ATTRIBUTE, ensureStyleSheet } from "./styles";

export { writeClipboardText, writeClipboardTextOrThrow } from "./clipboard";

export {
  DEFAULT_SENSITIVE_KEYS,
  REDACTED,
  isSensitiveKey,
  redact,
  redactHeaders,
  redactUrl,
} from "./redact";
export type { HeaderLike, RedactOptions } from "./redact";
