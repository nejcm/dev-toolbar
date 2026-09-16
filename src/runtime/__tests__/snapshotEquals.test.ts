import { describe, expect, it } from "vitest";
import { snapshotEquals } from "../snapshotEquals";
import type { SnapshotKeyPath } from "../snapshotEquals";

const equals = snapshotEquals();

const record = (entries: Record<string, unknown>): Record<string, unknown> =>
  Object.assign(Object.create(null) as Record<string, unknown>, entries);

describe("snapshotEquals", () => {
  it.each([
    ["equal strings", "a", "a", true],
    ["different strings", "a", "b", false],
    ["equal numbers", 1, 1, true],
    ["null and undefined", null, undefined, false],
    ["false and zero", false, 0, false],
    ["empty string and zero", "", 0, false],
  ])("compares primitives: %s", (_case, a, b, expected) => {
    expect(equals(a, b)).toBe(expected);
  });

  it("treats NaN as equal to itself at every depth", () => {
    expect(equals(Number.NaN, Number.NaN)).toBe(true);
    expect(equals({ views: [{ value: Number.NaN }] }, { views: [{ value: Number.NaN }] })).toBe(
      true,
    );
  });

  it("reports -0 and 0 as different, unlike a string signature", () => {
    expect(String(-0)).toBe(String(0));
    expect(equals({ x: -0 }, { x: 0 })).toBe(false);
    expect(equals([-0], [0])).toBe(false);
  });

  it("compares nested arrays and objects structurally", () => {
    const a = { rows: [{ id: "a", tags: ["x", "y"] }], meta: { count: 1 } };
    expect(equals(a, { rows: [{ id: "a", tags: ["x", "y"] }], meta: { count: 1 } })).toBe(true);
    expect(equals(a, { rows: [{ id: "a", tags: ["x", "z"] }], meta: { count: 1 } })).toBe(false);
    expect(equals(a, { rows: [{ id: "a", tags: ["x", "y"] }], meta: { count: 2 } })).toBe(false);
  });

  it("makes array length and order matter", () => {
    expect(equals([1, 2], [1, 2, 3])).toBe(false);
    expect(equals([1, 2], [2, 1])).toBe(false);
    expect(equals([1, 2], { 0: 1, 1: 2, length: 2 })).toBe(false);
  });

  it("reads an array hole as undefined and ignores extra array properties", () => {
    const sparse: (number | undefined)[] = [1, 2, 3];
    delete sparse[1];
    expect(equals(sparse, [1, undefined, 3])).toBe(true);
    const labelled = Object.assign([1, 2], { note: "extra" });
    expect(equals(labelled, [1, 2])).toBe(true);
  });

  it("treats an undefined value as a missing key, both ways round", () => {
    expect(equals({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(equals({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(equals({ a: 1 }, { a: 1, b: null })).toBe(false);
    expect(equals({ a: 1, b: undefined }, { a: 1, b: null })).toBe(false);
    expect(equals({ views: [{ hint: undefined }] }, { views: [{}] })).toBe(true);
  });

  it("compares null-prototype records, including against a plain object", () => {
    // `parseRecord` from /kit hands the runtimes null-prototype records.
    expect(equals(record({ a: "1" }), record({ a: "1" }))).toBe(true);
    expect(equals(record({ a: "1" }), record({ a: "2" }))).toBe(false);
    expect(equals(record({ a: "1" }), { a: "1" })).toBe(true);
  });

  it("compares own properties named like prototype members", () => {
    // Metric ids are consumer strings: `constructor` and `__proto__` are legal ones.
    const withKey = (key: string, value: string): Record<string, unknown> => {
      const target = record({});
      target[key] = value;
      return target;
    };
    expect(equals(withKey("constructor", "a"), withKey("constructor", "b"))).toBe(false);
    expect(equals(withKey("__proto__", "a"), withKey("__proto__", "a"))).toBe(true);
    expect(equals(withKey("__proto__", "a"), record({}))).toBe(false);
  });

  it("reads only own properties from the right-hand side", () => {
    // `right["__proto__"]` would answer `Object.prototype`, which walks as an empty object.
    const left = Object.fromEntries([["__proto__", {}]]);
    expect(equals(left, { other: {} })).toBe(false);
    expect(equals({ other: {} }, left)).toBe(false);
    expect(equals(left, Object.fromEntries([["__proto__", {}]]))).toBe(true);
  });

  it.each([
    ["a class instance", () => new (class Point {})()],
    ["a function", () => () => "x"],
    ["a Date", () => new Date(0)],
  ])("compares %s by identity", (_case, make) => {
    const value = make();
    expect(equals({ value }, { value })).toBe(true);
    expect(equals({ value }, { value: make() })).toBe(false);
  });

  it("short-circuits on identity without walking the value", () => {
    const shared = { deep: { fn: () => "x", when: new Date(0) } };
    expect(equals(shared, shared)).toBe(true);
    expect(equals({ shared }, { shared })).toBe(true);
  });

  it("exhausts the stack on a cycle rather than answering", () => {
    // Snapshots are acyclic by contract; this pins the failure mode, not a feature.
    const a: Record<string, unknown> = {};
    a["self"] = a;
    const b: Record<string, unknown> = {};
    b["self"] = b;
    expect(() => equals(a, b)).toThrow(RangeError);
  });

  describe("ignorePaths", () => {
    const flagsEquals = snapshotEquals<Record<string, unknown>>({
      ignorePaths: [
        ["revision"],
        ["at"],
        ["flags", "promotedLabel"],
        ["flags", "promotedIcon"],
        ["promoted", "promotedLabel"],
        ["promoted", "promotedIcon"],
      ],
    });

    const flagsSnapshot = (): Record<string, unknown> => ({
      revision: 1,
      at: 1000,
      flags: [{ key: "a", label: "A", promotedLabel: "Pinned A" }],
      promoted: [{ key: "a", label: "A", promotedLabel: "Pinned A" }],
      adapterErrors: record({ revision: "storage refused", a: "write failed" }),
    });

    it("ignores the counters at the root", () => {
      const changed = { ...flagsSnapshot(), revision: 2, at: 2000 };
      expect(flagsEquals(flagsSnapshot(), changed)).toBe(true);
    });

    it("ignores promotion metadata on every element of the named arrays", () => {
      const changed = flagsSnapshot();
      (changed["flags"] as Record<string, unknown>[])[0]!["promotedLabel"] = "Renamed";
      (changed["promoted"] as Record<string, unknown>[])[0]!["promotedIcon"] = "star";
      expect(flagsEquals(flagsSnapshot(), changed)).toBe(true);
    });

    it("stays transparent through arrays at any depth", () => {
      const nested = (promotedLabel: string, label: string) => ({
        flags: [[{ label, promotedLabel }]],
      });
      expect(flagsEquals(nested("Pinned", "A"), nested("Renamed", "A"))).toBe(true);
      expect(flagsEquals(nested("Pinned", "A"), nested("Pinned", "B"))).toBe(false);
    });

    it("still compares a flag field that is not excluded", () => {
      const changed = flagsSnapshot();
      (changed["flags"] as Record<string, unknown>[])[0]!["label"] = "renamed";
      expect(flagsEquals(flagsSnapshot(), changed)).toBe(false);
    });

    it("does not ignore a dictionary key that happens to be named `revision`", () => {
      // The regression PR #81 fixed: `adapterErrors` is keyed by flag name, so a
      // flag called `revision` must not have its adapter error silently dropped.
      const changed = flagsSnapshot();
      (changed["adapterErrors"] as Record<string, unknown>)["revision"] = "storage still refused";
      expect(flagsEquals(flagsSnapshot(), changed)).toBe(false);
    });

    it("does not ignore a nested view whose id happens to be `revision` or `at`", () => {
      // Metric collector ids are consumer strings that pass id validation, so an
      // entire custom view lives under `custom.revision`.
      const metricsEquals = snapshotEquals<Record<string, unknown>>({
        ignorePaths: [["revision"], ["at"]],
      });
      const snapshot = (label: string): Record<string, unknown> => ({
        revision: 1,
        at: 1000,
        custom: { revision: { id: "revision", label }, at: { id: "at", label } },
      });
      expect(metricsEquals(snapshot("Queue depth"), snapshot("Queue depth"))).toBe(true);
      expect(metricsEquals(snapshot("Queue depth"), snapshot("Queue size"))).toBe(false);
    });

    it("captures the paths when the comparator is created", () => {
      const paths: SnapshotKeyPath[] = [["revision"]];
      const captured = snapshotEquals<Record<string, unknown>>({ ignorePaths: paths });
      paths.push(["label"]);
      (paths[0] as string[]).push("nested");
      expect(captured({ revision: 1, label: "a" }, { revision: 2, label: "a" })).toBe(true);
      expect(captured({ revision: 1, label: "a" }, { revision: 1, label: "b" })).toBe(false);
    });

    it("ignores nothing when no paths are given", () => {
      expect(equals({ revision: 1 }, { revision: 2 })).toBe(false);
      expect(snapshotEquals({ ignorePaths: [] })({ revision: 1 }, { revision: 2 })).toBe(false);
    });
  });
});
