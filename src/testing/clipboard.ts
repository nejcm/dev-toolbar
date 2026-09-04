interface ClipboardInstall {
  clipboard: { writeText(text: string): Promise<void> } | undefined;
}

interface ClipboardState {
  previous: PropertyDescriptor | undefined;
  installs: ClipboardInstall[];
}

const states = new WeakMap<object, ClipboardState>();

const apply = (navigator: Navigator, state: ClipboardState): void => {
  const active = state.installs.at(-1);
  if (active !== undefined) {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: active.clipboard,
    });
    return;
  }
  states.delete(navigator);
  if (state.previous === undefined) delete (navigator as { clipboard?: unknown }).clipboard;
  else Object.defineProperty(navigator, "clipboard", state.previous);
};

/** A clipboard stub's completed writes and idempotent cleanup. */
export interface ClipboardStub {
  /** Live, readonly view of completed writes; retained references observe later writes. */
  readonly writes: readonly string[];
  restore(): void;
}

/** An optional clipboard implementation used to stage success or failure. */
export type ClipboardWrite = (text: string) => void | Promise<void>;

/** Install a recording clipboard, or pass `null` to stage an unavailable clipboard. */
export function installClipboard(write: ClipboardWrite | null = () => {}): ClipboardStub {
  const navigator = globalThis.navigator;
  let state = states.get(navigator);
  if (state === undefined) {
    state = {
      previous: Object.getOwnPropertyDescriptor(navigator, "clipboard"),
      installs: [],
    };
    states.set(navigator, state);
  }

  const writes: string[] = [];
  const install: ClipboardInstall = {
    clipboard:
      write === null
        ? undefined
        : {
            writeText(text: string): Promise<void> {
              let result: void | Promise<void>;
              try {
                result = write(text);
              } catch (error) {
                return Promise.reject(error);
              }
              if (result === undefined) {
                writes.push(text);
                return Promise.resolve();
              }
              return result.then(() => void writes.push(text));
            },
          },
  };
  state.installs.push(install);
  apply(navigator, state);

  let installed = true;
  return {
    writes,
    restore() {
      if (!installed) return;
      installed = false;
      const index = state.installs.indexOf(install);
      if (index !== -1) state.installs.splice(index, 1);
      apply(navigator, state);
    },
  };
}
