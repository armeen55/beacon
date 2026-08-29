/** ONE in-memory Postgres for the tests that each hand-rolled the same chainable query engine over an array of rows: filters, order, limit/range, update, upsert, thenable. What one file needs differently rides in as an option: `rows` picks the array behind a table name, `error` is the failure a table hands back instead of running, `same` is the identity an upsert lands on (the id by default), `clash` is a unique index the write must not violate, `insertDefaults` are the columns a fresh INSERT gets and an update never touches, `landsNothing` is the write Postgres accepts and stores nothing for. Anything a file's fake does that is not here stays in that file. */
export type Row = Record<string, unknown>;
type Err = { code?: string; message: string } | null;
type Op = "select" | "update" | "upsert";
export type SupabaseFakeOptions = { rows: (table: string) => Row[]; error?: (table: string, op: Op) => Err;
  same?: (stored: Row, sent: Row) => boolean; clash?: (sent: Row, rows: Row[]) => Err;
  insertDefaults?: () => Row; landsNothing?: () => boolean;
  /** Every SELECT this fake runs, so a test can prove a reader asked for a BOUNDED page and never the lot. */
  onSelect?: (table: string, read: { max: number; head: boolean; cols: string }) => void };
export function supabaseFake(o: SupabaseFakeOptions) {
  const same = o.same ?? ((stored: Row, sent: Row) => stored.id === sent.id);
  const from = (table = "") => {
    const tests: ((r: Row) => boolean)[] = [];
    let op: Op = "select", patch: Row = {}, sent: Row[] = [], skipDup = false;
    const orders: [string, boolean][] = [];
    let first = 0, max = Number.MAX_SAFE_INTEGER, counting = false, head = false, cols = "";
    const cmp = (a: Row, b: Row, c: string) => (typeof a[c] === "number" && typeof b[c] === "number"
      ? (a[c] as number) - (b[c] as number) : String(a[c] ?? "").localeCompare(String(b[c] ?? "")));
    const rows = () => o.rows(table);
    const run = () => {
      const failure = o.error?.(table, op);
      if (failure) return { data: null, error: failure };
      const hit = rows().filter((r) => tests.every((t) => t(r)));
      if (op === "update") { for (const r of hit) Object.assign(r, patch); return { data: hit.map((r) => ({ ...r })), error: null }; }
      if (op === "select") {
        o.onSelect?.(table, { max, head, cols });
        if (orders.length) hit.sort((a, b) => { for (const [c, asc] of orders) { const d = cmp(a, b, c); if (d !== 0) return asc ? d : -d; } return 0; });
        // ASK FOR WHAT YOU READ: a projection hands back the columns it named and nothing else, so a reader that quietly depends on a heavy column it did not select is caught here rather than in production.
        const want = cols && cols !== "*" ? cols.split(",").map((c) => c.trim()).filter(Boolean) : null;
        const page = hit.slice(first, first + max)
          .map((r) => (want ? Object.fromEntries(want.filter((c) => c in r).map((c) => [c, r[c]])) : { ...r }));
        return counting ? { data: head ? null : page, count: hit.length, error: null } : { data: page, error: null };}
      if (o.landsNothing?.()) return { data: [], error: null }; // accepted, landed nothing
      for (const row of sent) {
        const clash = o.clash?.(row, rows());
        if (clash) return { data: null, error: clash };
        const at = rows().findIndex((r) => same(r, row));
        if (at >= 0) { if (!skipDup) rows()[at] = { ...rows()[at], ...row }; continue; }
        rows().push({ ...o.insertDefaults?.(), ...row });}
      return { data: sent.map((r) => ({ id: r.id })), error: null };};
    const where = (t: (r: Row) => boolean) => { tests.push(t); return q; };
    const q: Record<string, unknown> = {
      select: (c?: string, x?: { count?: string; head?: boolean }) => {
        cols = c ?? ""; counting = !!x?.count; head = x?.head === true; return q; },
      update: (p: Row) => { op = "update"; patch = p; return q; },
      upsert: (r: Row | Row[], x?: { ignoreDuplicates?: boolean }) => { op = "upsert"; sent = Array.isArray(r) ? r : [r]; skipDup = x?.ignoreDuplicates === true; return q; },
      order: (c: string, x?: { ascending?: boolean }) => { orders.push([c, x?.ascending !== false]); return q; },
      limit: (n: number) => { max = n; return q; }, range: (a: number, z: number) => { first = a; max = z - a + 1; return q; },
      eq: (c: string, v: unknown) => where((r) => (r[c] ?? null) === v), is: (c: string, v: unknown) => where((r) => (r[c] ?? null) === v),
      in: (c: string, vs: readonly unknown[]) => where((r) => vs.includes(r[c])),
      // SQL LIKE, honoring backslash-escaped wildcards, so a basis prefix containing an underscore matches itself and nothing else.
      like: (c: string, v: string) => { const rx = new RegExp(`^${v.replace(/\\([%_\\])|([.*+?^${}()|[\]])|%|_/g,
        (m, esc: string, meta: string) => esc ? esc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : meta ? `\\${meta}` : m === "%" ? ".*" : ".")}$`, "s");
        return where((r) => typeof r[c] === "string" && rx.test(r[c] as string)); },
      gte: (c: string, v: string) => where((r) => typeof r[c] === "string" && (r[c] as string) >= v),
      lte: (c: string, v: string) => where((r) => r[c] != null && String(r[c]) <= v),
      lt: (c: string, v: string) => where((r) => r[c] != null && String(r[c]) < v),
      gt: (c: string, v: unknown) => where((r) => r[c] != null && (typeof v === "number" ? (r[c] as number) > v : String(r[c]) > String(v))),
      // The ONE keyset shape every paged reader here builds: strictly past one row, in the query's own order.
      or: (expr: string) => { const m = /^(\w+)\.lt\."([^"]*)",and\(\w+\.eq\."[^"]*",id\.lt\."([^"]*)"\)$/.exec(expr);
        return m ? where((r) => String(r[m[1]!] ?? "") < m[2]! || (String(r[m[1]!] ?? "") === m[2]! && String(r.id) < m[3]!)) : q; },
      then: (resolve: (v: unknown) => void) => resolve(run()),};
    return q;};
  return { from };}
