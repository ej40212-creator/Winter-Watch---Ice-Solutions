import type { Sql } from "./sql.ts";

type D1Like = {
  exec(sql: string): Promise<unknown>;
  prepare(sql: string): {
    bind(...params: unknown[]): {
      run(): Promise<{ meta?: { changes?: number } }>;
      first<T>(): Promise<T | null>;
      all<T>(): Promise<{ results?: T[] }>;
    };
  };
};

export function wrapD1(db: D1Like): Sql {
  const statement = (sql: string, params: unknown[]) => (params.length ? db.prepare(sql).bind(...params) : db.prepare(sql).bind());
  return {
    async exec(sql: string) {
      await db.exec(sql);
    },
    async run(sql: string, ...params: unknown[]) {
      const result = await statement(sql, params).run();
      return { changes: result.meta?.changes ?? 0 };
    },
    async get<T>(sql: string, ...params: unknown[]) {
      const row = await statement(sql, params).first<T>();
      return row ?? undefined;
    },
    async all<T>(sql: string, ...params: unknown[]) {
      const result = await statement(sql, params).all<T>();
      return result.results ?? [];
    },
  };
}
