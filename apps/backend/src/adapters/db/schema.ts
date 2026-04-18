import { sql } from 'drizzle-orm';
import { foreignKey, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Adjacency-list folder model. `parentId = null` marks a root folder (locked
 * decision in Phase 2). `deletedAt` drives soft delete; the BullMQ cleanup
 * worker hard-deletes rows whose `deletedAt` is older than the retention window.
 */
export const folders = pgTable(
  'folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    foreignKey({
      name: 'folders_parent_id_fk',
      columns: [t.parentId],
      foreignColumns: [t.id],
    }).onDelete('cascade'),
    index('folders_parent_id_idx').on(t.parentId),
    index('folders_parent_id_name_idx').on(t.parentId, t.name),
    index('folders_deleted_at_idx').on(t.deletedAt),
    // Partial keyset indexes added in migration 0002. The `(parent_id, name,
    // id)` index lets the children-listing query satisfy its ORDER BY and
    // keyset WHERE with a single index scan; the `(name, id)` index backs
    // the search endpoint's ordered page after trigram filtering.
    index('folders_parent_name_id_live_idx')
      .on(t.parentId, t.name, t.id)
      .where(sql`${t.deletedAt} IS NULL`),
    index('folders_name_id_live_idx')
      .on(t.name, t.id)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    folderId: uuid('folder_id').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    foreignKey({
      name: 'files_folder_id_fk',
      columns: [t.folderId],
      foreignColumns: [folders.id],
    }).onDelete('cascade'),
    index('files_folder_id_idx').on(t.folderId),
    index('files_deleted_at_idx').on(t.deletedAt),
    // Mirrors `folders_parent_name_id_live_idx` — keyset ordering for the
    // files list under a folder.
    index('files_folder_name_id_live_idx')
      .on(t.folderId, t.name, t.id)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type FolderRow = typeof folders.$inferSelect;
export type FolderInsert = typeof folders.$inferInsert;
export type FileRow = typeof files.$inferSelect;
export type FileInsert = typeof files.$inferInsert;
