export type SqlStatement = { sql: string; params: unknown[] };

export type Sql = {
  exec(sql: string): Promise<void>;
  run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
  batch?(statements: SqlStatement[]): Promise<void>;
};

type StatementSync = {
  run(...params: unknown[]): { changes: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};

type DatabaseSyncLike = {
  exec(sql: string): void;
  prepare(sql: string): StatementSync;
};

export function wrapNodeSqlite(db: DatabaseSyncLike): Sql {
  return {
    async exec(sql: string) {
      db.exec(sql);
    },
    async run(sql: string, ...params: unknown[]) {
      const result = db.prepare(sql).run(...params);
      return { changes: Number(result.changes) };
    },
    async get<T>(sql: string, ...params: unknown[]) {
      return db.prepare(sql).get(...params) as T | undefined;
    },
    async all<T>(sql: string, ...params: unknown[]) {
      return db.prepare(sql).all(...params) as T[];
    },
    async batch(statements) {
      db.exec("BEGIN");
      try {
        for (const statement of statements) db.prepare(statement.sql).run(...statement.params);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
