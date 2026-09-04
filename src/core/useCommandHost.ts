import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  CONTRACT_VERSION,
  type AnyToolbarCommand,
  type DevToolbarExtension,
  type ExtensionRuntimeApi,
} from "./contract";
import type { DevToolbarContextValue } from "./context";
import { collectCommands, invokeCommand, registerCommandHost } from "./commands";
import { collectDiagnostics } from "./diagnostics";

const EMPTY_EXTENSIONS: readonly DevToolbarExtension[] = [];

export function useCommandHost(
  input: readonly DevToolbarExtension[] | undefined,
  enabled: boolean,
): {
  extensions: readonly DevToolbarExtension[];
  commands: readonly AnyToolbarCommand[];
  getCommands(): readonly AnyToolbarCommand[];
  runCommand: DevToolbarContextValue["runCommand"];
  invokeCommand: DevToolbarContextValue["invokeCommand"];
  getDiagnostics: ExtensionRuntimeApi["getDiagnostics"];
} {
  const extensions = useMemo(() => {
    const merged: DevToolbarExtension[] = [];
    const seen = new Set<string>();
    for (const extension of input ?? EMPTY_EXTENSIONS) {
      if (seen.has(extension.id)) continue;
      seen.add(extension.id);
      merged.push(extension);
    }
    return merged;
  }, [input]);

  // Keeps the extension list, not the aggregated commands, in a ref: every
  // imperative path re-enumerates via `getCommands` below instead of reading
  // a stale aggregation.
  const extensionsRef = useRef(extensions);
  // Written in render, not an effect: an effect would leave `getCommands()`
  // a render behind the list it exists to enumerate.
  // oxlint-disable-next-line react/refs
  extensionsRef.current = extensions;

  const getCommands = useCallback(() => collectCommands(extensionsRef.current), []);

  /**
   * The declarative snapshot behind `useToolbarCommands()`. Recomputed only
   * when the extension list changes. Anything that must be current (a
   * palette opening, `runCommand`) calls `getCommands()` instead.
   */
  const commands = useMemo(() => collectCommands(extensions), [extensions]);

  useEffect(() => {
    if (!enabled) return;
    return registerCommandHost({ getCommands });
  }, [enabled, getCommands]);

  const scopedRunCommand = useCallback(
    (id: string, input?: unknown) =>
      invokeCommand(id, { input, scope: getCommands() }).then((outcome) => outcome.ok),
    [getCommands],
  );

  const scopedInvokeCommand = useCallback(
    <Out>(id: string, input?: unknown) => invokeCommand<Out>(id, { input, scope: getCommands() }),
    [getCommands],
  );

  const getDiagnostics = useCallback(() => collectDiagnostics(extensionsRef.current), []);

  // Contract version check, deduped by id (not object): an `extensions` array
  // rebuilt inside render re-runs this effect every render, which without the
  // ref would flood the console in exactly the case the warning is for.
  const contractWarnedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!enabled) return;
    for (const extension of extensions) {
      if (
        extension.contractVersion !== undefined &&
        extension.contractVersion !== CONTRACT_VERSION &&
        !contractWarnedRef.current.has(extension.id)
      ) {
        contractWarnedRef.current.add(extension.id);
        // eslint-disable-next-line no-console
        console.warn(
          `[dev-toolbar] extension "${extension.id}" targets contract version ` +
            `${extension.contractVersion}, but this core implements ${CONTRACT_VERSION}. ` +
            "It may not render correctly.",
        );
      }
    }
  }, [extensions, enabled]);

  return {
    extensions,
    commands,
    getCommands,
    runCommand: scopedRunCommand,
    invokeCommand: scopedInvokeCommand,
    getDiagnostics,
  };
}
