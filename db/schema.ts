// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const cache = sqliteTable('weather_cache', { key: text('key').primaryKey(), value: text('value').notNull(), expires: integer('expires').notNull() });
