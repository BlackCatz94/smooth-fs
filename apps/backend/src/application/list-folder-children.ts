import type { Folder } from '../domain/folder';
import type { FolderRepository, Page } from '../ports/folder-repository';

export interface ListFolderChildrenInput {
  readonly parentId: string | null;
  readonly cursor: string | null;
  readonly limit: number;
}

export class ListFolderChildrenService {
  constructor(private readonly folders: FolderRepository) {}

  async exec(input: ListFolderChildrenInput): Promise<Page<Folder>> {
    return this.folders.listChildren(input);
  }
}
