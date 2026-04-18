import type { FileNode, FolderNode } from '@smoothfs/shared';

/**
 * Internal domain representation. Uses native `Date` objects for timestamp
 * arithmetic; adapters translate from DB rows and to shared ISO DTOs at the
 * boundary (see `toFolderNodeDto` / `toFileNodeDto`).
 */
export interface Folder {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
  /**
   * Does this folder have at least one non-deleted folder child? Computed at
   * read time by the adapter (EXISTS subquery). Always populated — no
   * "unknown" state — so the DTO contract is uniform and the frontend can
   * render the tree chevron correctly before the user clicks to expand.
   *
   * Only folder children count; files are irrelevant to tree navigation.
   */
  readonly hasChildFolders: boolean;
}

export interface FileItem {
  readonly id: string;
  readonly folderId: string;
  readonly name: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

export function toFolderNodeDto(f: Folder): FolderNode {
  return {
    id: f.id,
    parentId: f.parentId,
    name: f.name,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
    deletedAt: f.deletedAt ? f.deletedAt.toISOString() : null,
    hasChildFolders: f.hasChildFolders,
  };
}

export function toFileNodeDto(f: FileItem): FileNode {
  return {
    id: f.id,
    folderId: f.folderId,
    name: f.name,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
    deletedAt: f.deletedAt ? f.deletedAt.toISOString() : null,
  };
}
