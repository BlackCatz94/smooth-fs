import { z } from 'zod';

/** ISO-8601 strings (API wire format) */
const isoDateTime = z.string().datetime();

/**
 * Folder node (adjacency list). `parentId` is null for the logical root.
 * `deletedAt` is set when soft-deleted (Phase 2+).
 */
export const folderNodeSchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  name: z.string().min(1).max(255),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  deletedAt: isoDateTime.nullable(),
});

export type FolderNode = z.infer<typeof folderNodeSchema>;

/**
 * File node, always bound to a folder.
 */
export const fileNodeSchema = z.object({
  id: z.string().uuid(),
  folderId: z.string().uuid(),
  name: z.string().min(1).max(255),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  deletedAt: isoDateTime.nullable(),
});

export type FileNode = z.infer<typeof fileNodeSchema>;
