// A tiny stand-in for the Supabase client in unit tests: tables are arrays of rows, and only what the
// simple reads need is supported (select of plain columns or "*", eq, neq, in, is, order, limit, single,
// maybeSingle, await). Embedded selects and writes are not: a test that needs them uses the local stack.

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Filter[] = [];
  private columns: string[] | null = null;
  private orderBy: { column: string; ascending: boolean } | null = null;
  private max: number | null = null;

  constructor(private readonly rows: Row[]) {}

  select(columns = "*"): this {
    if (columns.includes("(")) throw new Error(`fake-db: embedded selects are not supported (${columns})`);
    this.columns = columns.trim() === "*" ? null : columns.split(",").map((c) => c.trim());
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push((r) => r[column] === value);
    return this;
  }
  neq(column: string, value: unknown): this {
    this.filters.push((r) => r[column] !== value);
    return this;
  }
  in(column: string, values: unknown[]): this {
    this.filters.push((r) => values.includes(r[column]));
    return this;
  }
  is(column: string, value: null): this {
    this.filters.push((r) => (r[column] ?? null) === value);
    return this;
  }
  order(column: string, opts: { ascending?: boolean } = {}): this {
    this.orderBy = { column, ascending: opts.ascending ?? true };
    return this;
  }
  limit(n: number): this {
    this.max = n;
    return this;
  }

  private result(): Row[] {
    let out = this.rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      // A stable sort, like the database's order for the fixture's distinct values.
      out = [...out].sort((a, b) => (a[column] === b[column] ? 0 : (a[column] as never) < (b[column] as never) ? (ascending ? -1 : 1) : ascending ? 1 : -1));
    }
    if (this.max !== null) out = out.slice(0, this.max);
    const columns = this.columns;
    return columns ? out.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null]))) : out.map((r) => ({ ...r }));
  }

  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    const rows = this.result();
    if (rows.length > 1) throw new Error("fake-db: maybeSingle matched more than one row");
    return { data: rows[0] ?? null, error: null };
  }
  async single(): Promise<{ data: Row; error: null }> {
    const rows = this.result();
    if (rows.length !== 1) throw new Error(`fake-db: single matched ${rows.length} rows`);
    return { data: rows[0], error: null };
  }
  then<A = { data: unknown; error: null }, B = never>(onfulfilled?: ((value: { data: unknown; error: null }) => A | PromiseLike<A>) | null, onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve({ data: this.result() as unknown, error: null }).then(onfulfilled, onrejected);
  }
}

/** A read-only client over the given tables; any table not given reads as empty. */
export function fakeDb(tables: Record<string, Row[]>) {
  return { from: (table: string) => new FakeQuery(tables[table] ?? []) };
}
