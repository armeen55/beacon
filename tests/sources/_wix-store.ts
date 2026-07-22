/**
 * Shared in-memory Supabase-admin fake for the Wix mappings-store suites
 * (wix-field-mapping + wix-mappings-store).
 *
 * Both suites drive the SAME `mappings-store` persistence layer through an
 * identical fake admin client: per-PK upsert, tenant-scoped `.select().eq()`,
 * and a scoped `.delete().eq().in()`. The only divergence is the `no_table`
 * mode (undefined_table 42P01 soft-fallback) which mappings-store exercises and
 * field-mapping does not — the shared fake honors it either way, so a suite that
 * never enters `no_table` behaves exactly as before.
 *
 * The `vi.hoisted` mock state and the `vi.mock(...)` factories stay in each test
 * file (hoisting is per-module); only the pure builders live here.
 */

export interface WixStoreState {
  /** "ok" | "no_env" | "no_table" — widened to string so each suite's own union assigns. */
  mode: string;
  tables: Map<string, Array<Record<string, unknown>>>;
  tenant: string;
  files: Map<string, unknown[]>;
}

/** Conflict keys per table, mirroring the real store's onConflict targets. */
export const WIX_PK: Record<string, string[]> = {
  wix_collection_config: ["tenant_id", "data_collection_id"],
  wix_url_map: ["tenant_id", "url"],
};

/** undefined_table (not yet migrated) — the 42P01 the real client would return. */
const UNDEFINED_TABLE = { code: "42P01" };

export function wixTableRows(
  state: WixStoreState,
  name: string,
): Array<Record<string, unknown>> {
  if (!state.tables.has(name)) state.tables.set(name, []);
  return state.tables.get(name)!;
}

/**
 * A behavioral in-memory Supabase admin: real per-tenant persistence
 * (upsert-by-PK + scoped delete) so assertions are behavioral, not call-shape.
 */
export function makeWixFakeAdmin(state: WixStoreState) {
  return {
    from(table: string) {
      return {
        select(_cols?: string) {
          return {
            eq(col: string, val: unknown) {
              if (state.mode === "no_table") {
                return Promise.resolve({ data: null, error: UNDEFINED_TABLE });
              }
              return Promise.resolve({
                data: wixTableRows(state, table).filter((r) => r[col] === val),
                error: null,
              });
            },
          };
        },
        upsert(newRows: Array<Record<string, unknown>>, opts?: { onConflict?: string }) {
          if (state.mode === "no_table") return Promise.resolve({ error: UNDEFINED_TABLE });
          const conflict = (opts?.onConflict ?? WIX_PK[table]?.join(",") ?? "").split(",");
          const arr = wixTableRows(state, table);
          for (const nr of newRows) {
            const idx = arr.findIndex((r) => conflict.every((k) => r[k] === nr[k]));
            if (idx >= 0) arr[idx] = { ...nr };
            else arr.push({ ...nr });
          }
          return Promise.resolve({ error: null });
        },
        delete() {
          return {
            eq(eqCol: string, eqVal: unknown) {
              return {
                in(inCol: string, list: unknown[]) {
                  if (state.mode === "no_table") return Promise.resolve({ error: UNDEFINED_TABLE });
                  const set = new Set(list);
                  state.tables.set(
                    table,
                    wixTableRows(state, table).filter(
                      (r) => !(r[eqCol] === eqVal && set.has(r[inCol])),
                    ),
                  );
                  return Promise.resolve({ error: null });
                },
              };
            },
          };
        },
      };
    },
  };
}
