export type CompoundActionGroup = {
  key: string;
  label: string;
  actionTypes: string[];
  changeCount: number;
};

const normPath = (value: string) =>
  ((value || "/").replace(/^https?:\/\/[^/]+/, "") || "/").replace(/[?#].*$/, "").replace(/\/$/, "") || "/";

const readable = (value: string) => value.replace(/_/g, " ");

/** Same-page, same-ship-date rows are one intentional package. This creates a
 * stable bundle identity without pretending any member caused the outcome. */
export function compoundActionGroupsById(
  records: ReadonlyArray<{ id: string; path: string; shippedAt: string; actionType: string }>,
): Map<string, CompoundActionGroup> {
  const buckets = new Map<string, typeof records[number][]>();
  for (const record of records) {
    const key = `${normPath(record.path)}::${record.shippedAt.slice(0, 10)}`;
    buckets.set(key, [...(buckets.get(key) ?? []), record]);
  }
  const out = new Map<string, CompoundActionGroup>();
  for (const rows of buckets.values()) {
    if (rows.length < 2) continue;
    const actionTypes = [...new Set(rows.map((row) => row.actionType).filter(Boolean))].sort();
    const group = {
      key: `combo:${actionTypes.join("+")}`,
      label: actionTypes.map(readable).join(" + "),
      actionTypes,
      changeCount: rows.length,
    };
    for (const row of rows) out.set(row.id, group);
  }
  return out;
}
