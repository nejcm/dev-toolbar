/**
 * Structural equality over published snapshots. [dev-toolbar/runtime]
 *
 * A store's `equals` decides whether a snapshot reaches the panel, and a
 * hand-written comparator drifts from its snapshot type the moment a field is
 * added. This compares the snapshot instead: `Object.is` first, arrays
 * elementwise and in order, plain and null-prototype objects by their own
 * enumerable string keys, and everything else — functions, class instances,
 * `Date` — by identity. Two objects with equal contents are equal whether
 * their prototype is `Object.prototype` or `null`.
 *
 * A key whose value is `undefined` equals a missing key, symmetrically and at
 * every depth, so an optional field compares the way a reader experiences it;
 * an array hole reads as `undefined` the same way. `Object.is(0, -0)` is
 * false, so a sign flip on a zero notifies where a string signature would not,
 * and `Object.is(NaN, NaN)` is true at every depth.
 *
 * Supported input is acyclic plain data that nothing mutates after
 * publication. Outside that contract: a cycle exhausts the stack rather than
 * answering; symbol-keyed, non-enumerable and inherited properties are never
 * compared, nor are extra properties hung on an array; a getter or proxy trap
 * runs as an ordinary read and a throw propagates to whoever published.
 *
 * Exclusions are paths from the snapshot root, never bare key names: flags'
 * `adapterErrors` is keyed by flag name, so "ignore `revision` at any depth"
 * would silently drop a real adapter error for a flag called `revision`.
 */

/** A path of keys from the snapshot root. Array indices are not segments: an array's elements share its path. */
export type SnapshotKeyPath = readonly string[];

export interface SnapshotEqualsOptions {
  /** Paths whose final key is ignored at exactly that location. Copied when the comparator is created. */
  ignorePaths?: readonly SnapshotKeyPath[];
}

interface IgnoreNode {
  keys: Set<string>;
  children: Map<string, IgnoreNode>;
}

const node = (): IgnoreNode => ({ keys: new Set(), children: new Map() });

function buildIgnoreTree(paths: readonly SnapshotKeyPath[]): IgnoreNode | null {
  let root: IgnoreNode | null = null;
  for (const path of paths) {
    if (path.length === 0) continue;
    root ??= node();
    let current = root;
    for (let depth = 0; depth < path.length - 1; depth += 1) {
      const segment = path[depth] as string;
      let child = current.children.get(segment);
      if (child === undefined) {
        child = node();
        current.children.set(segment, child);
      }
      current = child;
    }
    current.keys.add(path[path.length - 1] as string);
  }
  return root;
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function equal(a: unknown, b: unknown, ignore: IgnoreNode | null): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      if (!equal(a[index], b[index], ignore)) return false;
    }
    return true;
  }
  if (Array.isArray(b) || !isPlainObject(a) || !isPlainObject(b)) return false;

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  let unmatched = 0;
  for (const key of Object.keys(right)) {
    if (right[key] !== undefined && ignore?.keys.has(key) !== true) unmatched += 1;
  }
  for (const key of Object.keys(left)) {
    const value = left[key];
    if (value === undefined || ignore?.keys.has(key) === true) continue;
    // Not `right[key]`: an own `__proto__` key on the left would read the right's prototype.
    const other = Object.hasOwn(right, key) ? right[key] : undefined;
    if (other === undefined) return false;
    if (!equal(value, other, ignore?.children.get(key) ?? null)) return false;
    unmatched -= 1;
  }
  return unmatched === 0;
}

/** Builds a comparator over plain-data snapshots; see the module docblock for the supported input and the exclusion paths. */
export function snapshotEquals<T>(options: SnapshotEqualsOptions = {}): (a: T, b: T) => boolean {
  const ignore = buildIgnoreTree(options.ignorePaths ?? []);
  return (a, b) => equal(a, b, ignore);
}
