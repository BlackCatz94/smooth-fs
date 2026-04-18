import { z } from 'zod';

/** ISO-8601 strings (API wire format) */
const isoDateTime = z.string().datetime();

/**
 * Folder node (adjacency list). `parentId` is null for the logical root.
 * `deletedAt` is set when soft-deleted (Phase 2+).
 *
 * `hasChildFolders` is computed by the adapter via an index-backed `EXISTS`
 * subquery against `folders(parent_id) WHERE deleted_at IS NULL`. It lets the
 * client render the tree chevron only for folders that actually have folder
 * children, so users don't get the "click, chevron disappears, nothing
 * happened" surprise on empty branches. Only folder children count — a folder
 * with 0 sub-folders but 100 files is a tree leaf (its files open in the
 * right panel when the folder is selected, mirroring Windows Explorer).
 */
export const folderNodeSchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  name: z.string().min(1).max(255),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  deletedAt: isoDateTime.nullable(),
  hasChildFolders: z.boolean(),
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
