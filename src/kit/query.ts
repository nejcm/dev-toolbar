/** Match a normalized query against any defined string in a list. */
export function matchesQuery(haystack: readonly (string | undefined)[], query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return haystack.some((value) => value?.toLowerCase().includes(needle) ?? false);
}
