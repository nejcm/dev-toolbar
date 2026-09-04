import { createRef } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { installClipboard } from "@nejcm/dev-toolbar/testing";
import type { ClipboardStub, ClipboardWrite } from "@nejcm/dev-toolbar/testing";
import { CopyButton, useCopyStatus } from "../CopyButton";

const statusText = {
  idle: "Nothing copied yet.",
  ok: "Copied one value.",
  failed: "Clipboard unavailable.",
};

let clipboard: ClipboardStub | undefined;

const stubClipboard = (write?: ClipboardWrite | null): ClipboardStub => {
  clipboard = installClipboard(write);
  return clipboard;
};

afterEach(() => {
  clipboard?.restore();
  clipboard = undefined;
  cleanup();
});

describe("CopyButton", () => {
  it("forwards button attributes and its ref while rendering the native action DOM", () => {
    stubClipboard();
    const ref = createRef<HTMLButtonElement>();
    const { getByRole } = render(
      <CopyButton
        ref={ref}
        text="release-42"
        statusText={statusText}
        statusProps={{ "data-dtb-part": "example-note" }}
        data-dtb-part="example-action"
        data-dtb-action="copy"
        className="consumer-class"
      >
        Copy release
      </CopyButton>,
    );

    const button = getByRole("button", { name: "Copy release" });
    const status = getByRole("status");
    expect(ref.current).toBe(button);
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("data-dtb-kind")).toBe("action");
    expect(button.getAttribute("data-dtb-part")).toBe("example-action");
    expect(button.classList.contains("consumer-class")).toBe(true);
    expect(status.getAttribute("data-dtb-kind")).toBe("note");
    expect(status.getAttribute("data-dtb-part")).toBe("example-note");
    expect(status.textContent).toBe(statusText.idle);
  });

  it("writes lazily resolved text and announces success", async () => {
    const installed = stubClipboard();
    const { getByRole } = render(
      <CopyButton text={() => "release-42"} statusText={statusText}>
        Copy release
      </CopyButton>,
    );

    await act(async () => fireEvent.click(getByRole("button")));

    expect(installed.writes).toEqual(["release-42"]);
    expect(getByRole("status").textContent).toBe(statusText.ok);
  });

  it("announces rejected and unavailable writes", async () => {
    stubClipboard(async () => {
      throw new Error("permission denied");
    });
    const { getByRole } = render(
      <CopyButton text="release-42" statusText={statusText}>
        Copy release
      </CopyButton>,
    );

    await act(async () => fireEvent.click(getByRole("button")));
    expect(getByRole("status").textContent).toBe(statusText.failed);

    clipboard?.restore();
    stubClipboard(null);
    await act(async () => fireEvent.click(getByRole("button")));
    expect(getByRole("status").textContent).toBe(statusText.failed);
  });

  it("runs a consumer onClick without letting preventDefault suppress copying", async () => {
    const installed = stubClipboard();
    const { getByRole } = render(
      <CopyButton
        type="submit"
        text="release-42"
        statusText={statusText}
        onClick={(event) => event.preventDefault()}
      >
        Copy release
      </CopyButton>,
    );

    const button = getByRole("button");
    await act(async () => fireEvent.click(button));
    expect(button.getAttribute("type")).toBe("submit");
    expect(installed.writes).toEqual(["release-42"]);
    expect(getByRole("status").textContent).toBe(statusText.ok);
  });

  it("allows the status role and live-region priority to be overridden", () => {
    stubClipboard();
    const { getByRole } = render(
      <CopyButton
        text="release-42"
        statusText={statusText}
        statusProps={{ role: "alert", "aria-live": "assertive" }}
      >
        Copy release
      </CopyButton>,
    );

    const alert = getByRole("alert");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(alert.getAttribute("data-dtb-kind")).toBe("note");
  });
});

function MultipleCopyButtons() {
  const { status, copy } = useCopyStatus();
  return (
    <>
      <button type="button" onClick={() => copy("summary")}>
        Copy summary
      </button>
      <button type="button" onClick={() => copy("json")}>
        Copy JSON
      </button>
      <button type="button" onClick={() => copy(null)}>
        Copy missing link
      </button>
      <span role="status">{statusText[status]}</span>
    </>
  );
}

describe("useCopyStatus", () => {
  it("shares one status machine across any number of copy buttons", async () => {
    const installed = stubClipboard();
    const { getByRole } = render(<MultipleCopyButtons />);

    await act(async () => fireEvent.click(getByRole("button", { name: "Copy summary" })));
    await act(async () => fireEvent.click(getByRole("button", { name: "Copy JSON" })));
    expect(installed.writes).toEqual(["summary", "json"]);
    expect(getByRole("status").textContent).toBe(statusText.ok);

    fireEvent.click(getByRole("button", { name: "Copy missing link" }));
    expect(installed.writes).toEqual(["summary", "json"]);
    expect(getByRole("status").textContent).toBe(statusText.failed);
  });
});
