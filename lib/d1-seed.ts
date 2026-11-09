import type { Sql, SqlStatement } from "./sql.ts";

export function reviewedSeedScript(statements: SqlStatement[]): string {
  const body = statements.map((statement) => {
    const literals = statement.params.map((value) => value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`);
    let index = 0;
    return statement.sql.replace(/\?/g, () => literals[index++] ?? "NULL") + ";";
  }).join("\n");
  return `${body}\n`;
}

/** One D1 batch, or one sqlite transaction. A thrown statement leaves no partial seed. */
export async function applySeedBatch(db: Sql, statements: SqlStatement[]): Promise<void> {
  if (db.batch) {
    await db.batch(statements);
    return;
  }
  await db.exec("BEGIN");
  try {
    for (const statement of statements) await db.run(statement.sql, ...statement.params);
    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}
