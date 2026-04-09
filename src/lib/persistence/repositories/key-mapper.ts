/**
 * snake_case ↔ camelCase key mapping for DB ↔ TypeScript round-tripping.
 *
 * Used by the Supabase backend for stores whose TS types use camelCase
 * (PersistedIssue, ChangeContract) while the DB columns are snake_case.
 */

export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function mapRowToEntity<T>(row: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    result[snakeToCamel(key)] = value;
  }
  return result as T;
}
