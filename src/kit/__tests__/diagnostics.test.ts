import { describe, expect, it } from "vitest";
import type { ExtensionDiagnostics } from "../../core/contract";
import { UNREADABLE } from "../../runtime";
import { readDiagnosticsRoster, redactForExport } from "../index";
import type { DiagnosticsRosterRead } from "../index";

const LEAKY = "fetch https://api.example.com/v1?token=abc123 failed";

const rosterOf = (...entries: ExtensionDiagnostics[]) => ({ getDiagnostics: () => entries });

const read = (entry: ExtensionDiagnostics) => readDiagnosticsRoster(rosterOf(entry));

describe("readDiagnosticsRoster", () => {
  it.each<[string, () => DiagnosticsRosterRead, DiagnosticsRosterRead]>([
    ["a null api", () => readDiagnosticsRoster(null), { gathered: false }],
    ["an undefined api", () => readDiagnosticsRoster(undefined), { gathered: false }],
    ["an api without getDiagnostics", () => readDiagnosticsRoster({}), { gathered: false }],
    [
      "a throwing getDiagnostics",
      () =>
        readDiagnosticsRoster({
          getDiagnostics: () => {
            throw new Error(LEAKY);
          },
        }),
      {
        gathered: false,
        error: "Error: fetch https://api.example.com/v1?token=[redacted] failed",
      },
    ],
    [
      "a getDiagnostics that returns no array",
      () => readDiagnosticsRoster({ getDiagnostics: () => null as unknown as [] }),
      { gathered: false },
    ],
    [
      "an absent entry",
      () => read({ id: "a", label: "A", status: "absent" }),
      { gathered: true, entries: [{ id: "a", label: "A", status: "absent" }] },
    ],
    [
      "an ok entry whose data redacts to undefined",
      () => read({ id: "a", label: "A", status: "ok", data: undefined }),
      { gathered: true, entries: [{ id: "a", label: "A", status: "absent" }] },
    ],
    [
      "an ok entry whose data serialises",
      () => read({ id: "a", label: "A", status: "ok", data: { token: "abc", n: 1 } }),
      {
        gathered: true,
        entries: [{ id: "a", label: "A", status: "ok", data: { token: "[redacted]", n: 1 } }],
      },
    ],
    [
      "an ok entry whose data will not serialise",
      () => read({ id: "a", label: "A", status: "ok", data: { n: 1n } }),
      {
        gathered: true,
        entries: [
          {
            id: "a",
            label: "A",
            status: "unserialisable",
            error: expect.stringContaining("BigInt") as string,
          },
        ],
      },
    ],
    [
      "a failed entry",
      () =>
        read({ id: "a", label: "A", status: "failed", error: LEAKY, errorName: "Bearer secret" }),
      {
        gathered: true,
        entries: [
          {
            id: "a",
            label: "A",
            status: "failed",
            error: "fetch https://api.example.com/v1?token=[redacted] failed",
            errorName: "Bearer [redacted]",
          },
        ],
      },
    ],
    [
      "a failed entry with no error or name",
      () => read({ id: "a", label: "A", status: "failed" }),
      {
        gathered: true,
        entries: [{ id: "a", label: "A", status: "failed", error: "diagnostics() threw." }],
      },
    ],
    [
      "a status core does not emit, read as ok the way diagnostics does",
      () =>
        read({
          id: "a",
          label: "A",
          status: "later" as ExtensionDiagnostics["status"],
          data: { secret: "s" },
        }),
      {
        gathered: true,
        entries: [{ id: "a", label: "A", status: "ok", data: { secret: "[redacted]" } }],
      },
    ],
  ])("%s", (_name, run, expected) => {
    expect(run()).toEqual(expected);
  });

  it("honours a custom mask on every string it masks", () => {
    const result = readDiagnosticsRoster(
      rosterOf(
        { id: "a", label: "A", status: "ok", data: { token: "abc" } },
        { id: "b", label: "B", status: "failed", error: LEAKY, errorName: "Bearer secret" },
      ),
      { mask: "MASKED" },
    );
    expect(result).toEqual({
      gathered: true,
      entries: [
        { id: "a", label: "A", status: "ok", data: { token: "MASKED" } },
        {
          id: "b",
          label: "B",
          status: "failed",
          error: "fetch https://api.example.com/v1?token=MASKED failed",
          errorName: "Bearer MASKED",
        },
      ],
    });
    expect(
      readDiagnosticsRoster(
        {
          getDiagnostics: () => {
            throw new Error(LEAKY);
          },
        },
        { mask: "MASKED" },
      ),
    ).toEqual({
      gathered: false,
      error: "Error: fetch https://api.example.com/v1?token=MASKED failed",
    });
  });

  it("passes extraKeys through to data", () => {
    const result = readDiagnosticsRoster(
      rosterOf({ id: "a", label: "A", status: "ok", data: { tenant: "acme" } }),
      { extraKeys: ["tenant"] },
    );
    expect(result).toEqual({
      gathered: true,
      entries: [{ id: "a", label: "A", status: "ok", data: { tenant: "[redacted]" } }],
    });
  });

  it("tags a throwing getter inside data instead of throwing", () => {
    const data = {
      get boom(): never {
        throw new Error("nope");
      },
    };
    expect(read({ id: "a", label: "A", status: "ok", data })).toEqual({
      gathered: true,
      entries: [{ id: "a", label: "A", status: "ok", data: { boom: "[getter threw]" } }],
    });
  });

  it("tags a cycle inside data instead of throwing", () => {
    const data: Record<string, unknown> = { n: 1 };
    data.self = data;
    expect(read({ id: "a", label: "A", status: "ok", data })).toEqual({
      gathered: true,
      entries: [{ id: "a", label: "A", status: "ok", data: { n: 1, self: "[circular]" } }],
    });
  });

  it("masks a failed entry whose error is not a string without throwing", () => {
    const entry = {
      id: "a",
      label: "A",
      status: "failed",
      error: 42,
    } as unknown as ExtensionDiagnostics;
    expect(read(entry)).toEqual({
      gathered: true,
      entries: [{ id: "a", label: "A", status: "failed", error: UNREADABLE }],
    });
  });
});

describe("redactForExport", () => {
  it.each<[string, unknown, ReturnType<typeof redactForExport>]>([
    [
      "a serialisable value",
      { password: "p", ok: true },
      { status: "ok", value: { password: "[redacted]", ok: true } },
    ],
    ["undefined", undefined, { status: "absent" }],
    [
      "a BigInt",
      { n: 1n },
      { status: "unserialisable", error: expect.stringContaining("BigInt") as string },
    ],
    [
      "a throwing toJSON, neutralised because redact walks first",
      [
        {
          toJSON() {
            throw new Error("Bearer secret");
          },
        },
      ],
      { status: "ok", value: [{ toJSON: "[function]" }] },
    ],
  ])("%s", (_name, value, expected) => {
    expect(redactForExport(value)).toEqual(expected);
  });
});
