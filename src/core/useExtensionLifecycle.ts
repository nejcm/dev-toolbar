import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type {
  AnyToolbarCommand,
  DevToolbarExtension,
  ExtensionRuntimeApi,
  ToolbarStorage,
} from "./contract";
import { createExtensionStorage } from "./storage";
import type { ToolbarStore } from "./store";

interface RunningExtension {
  controller: AbortController;
  dispose?: () => void;
  start: unknown;
}

export function useExtensionLifecycle(options: {
  enabled: boolean;
  extensions: readonly DevToolbarExtension[];
  activePanelId: string | null;
  store: ToolbarStore;
  rawStorage: ToolbarStorage;
  instanceId: string;
  visibleRef: RefObject<boolean>;
  subscribeVisibility(callback: (visible: boolean) => void): () => void;
  getCommands(): readonly AnyToolbarCommand[];
  runCommand: ExtensionRuntimeApi["runCommand"];
  invokeCommand: ExtensionRuntimeApi["invokeCommand"];
  getDiagnostics: ExtensionRuntimeApi["getDiagnostics"];
}): void {
  const {
    enabled,
    extensions,
    activePanelId,
    store,
    rawStorage,
    instanceId,
    visibleRef,
    subscribeVisibility,
    getCommands,
    runCommand,
    invokeCommand,
    getDiagnostics,
  } = options;

  // A panel open when its extension becomes hidden must close, not just stop
  // painting: `activePanelId` is persisted, so leaving it set would reopen the
  // panel next reload. Only a *present and hidden* extension closes — an
  // absent id is left alone, so a persisted panel survives until its
  // extension registers.
  useEffect(() => {
    if (!enabled) return;
    if (activePanelId === null) return;
    const match = extensions.find((extension) => extension.id === activePanelId);
    if (match?.hidden === true) store.closePanel(activePanelId);
  }, [activePanelId, enabled, extensions, store]);

  // start(api): once per extension id while it is present *and not hidden*.
  // Core reports visibility and never pauses an extension on its behalf.
  const runningRef = useRef(new Map<string, RunningExtension>());
  const identityWarnedRef = useRef(new Set<string>());
  useEffect(() => {
    const running = runningRef.current;

    // Disabling at runtime is a real teardown: abort every signal and run
    // every dispose, rather than leaving timers alive until unmount.
    if (!enabled) {
      for (const [id, entry] of Array.from(running)) stopExtension(id, entry);
      running.clear();
      return;
    }

    // `hidden` means this extension does not exist for this actor. Running
    // its collectors anyway would be exactly the leak `hidden` exists to
    // prevent, so a hidden extension is stopped, not merely unpainted.
    const present = new Set(
      extensions.filter((extension) => extension.hidden !== true).map((extension) => extension.id),
    );

    // Copied: the loop deletes from `running`.
    for (const [id, entry] of Array.from(running)) {
      if (present.has(id)) continue;
      stopExtension(id, entry);
      running.delete(id);
    }

    for (const extension of extensions) {
      if (extension.hidden === true || typeof extension.start !== "function") {
        continue;
      }
      const existing = running.get(extension.id);
      if (existing) {
        // The running lifecycle belongs to the object that was started. If the
        // consumer rebuilt the extension inside render, its state is silently
        // lost. `{...ext, hidden}` keeps the same `start` reference, so this
        // does not fire for that legitimate pattern.
        if (existing.start !== extension.start && !identityWarnedRef.current.has(extension.id)) {
          identityWarnedRef.current.add(extension.id);
          // eslint-disable-next-line no-console
          console.warn(
            `[dev-toolbar] extension "${extension.id}" was rebuilt after it started. ` +
              "Its start() lifecycle still belongs to the first object, so whatever " +
              "that object owns is unreachable from what the bar now renders. Build " +
              "extensions once, at module scope, not inside render.",
          );
        }
        continue;
      }
      const controller = new AbortController();
      const api: ExtensionRuntimeApi = {
        signal: controller.signal,
        isVisible: () => visibleRef.current,
        subscribeVisibility: (callback) => {
          // The signal is documented as aborted on teardown, and this is the
          // subscription abort must release, so an extension keeping only the
          // signal is a legal reading of the contract. Already aborted at call
          // time: subscribe to nothing rather than leak an unreleasable listener.
          if (controller.signal.aborted) return () => {};

          const subscriber = (next: boolean) => {
            try {
              callback(next);
            } catch (error) {
              // eslint-disable-next-line no-console
              console.error(
                `[dev-toolbar] extension "${extension.id}" threw from its ` +
                  "subscribeVisibility() callback.",
                error,
              );
            }
          };
          const unsubscribeVisibility = subscribeVisibility(subscriber);

          // Idempotent and removes the abort listener too, so nothing leaks
          // regardless of whether the extension unsubscribes or the signal
          // aborts first.
          let released = false;
          const unsubscribe = () => {
            if (released) return;
            released = true;
            unsubscribeVisibility();
            controller.signal.removeEventListener("abort", unsubscribe);
          };
          controller.signal.addEventListener("abort", unsubscribe, { once: true });
          return unsubscribe;
        },
        storage: createExtensionStorage(rawStorage, instanceId, extension.id),
        getCommands: () => getCommands(),
        runCommand: (id: string, input?: unknown) => runCommand(id, input),
        invokeCommand: <Out>(id: string, input?: unknown) => invokeCommand<Out>(id, input),
        // Reads through the ref, like `getCommands`, so a snapshot taken now
        // reflects the extension list now.
        getDiagnostics: () => getDiagnostics(),
      };
      const entry: RunningExtension = { controller, start: extension.start };
      running.set(extension.id, entry);
      try {
        const dispose = extension.start(api);
        if (typeof dispose === "function") entry.dispose = dispose;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(`[dev-toolbar] extension "${extension.id}" threw from start().`, error);
      }
    }
  }, [
    enabled,
    extensions,
    getCommands,
    getDiagnostics,
    instanceId,
    invokeCommand,
    rawStorage,
    runCommand,
    subscribeVisibility,
    visibleRef,
  ]);

  useEffect(() => {
    const running = runningRef.current;
    return () => {
      for (const [id, entry] of Array.from(running)) stopExtension(id, entry);
      running.clear();
    };
  }, []);
}

function stopExtension(id: string, entry: RunningExtension): void {
  try {
    entry.controller.abort();
  } catch {
    /* ignore */
  }
  try {
    entry.dispose?.();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[dev-toolbar] extension "${id}" threw from its start() cleanup.`, error);
  }
}
