import { FolderNotFoundError } from '../domain/errors';
import type { Folder } from '../domain/folder';
import type { FolderRepository } from '../ports/folder-repository';

export interface GetFolderPathInput {
  readonly folderId: string;
}

export class GetFolderPathService {
  constructor(
    private readonly folders: FolderRepository,
    private readonly maxDepth: number,
  ) {}

  async exec(input: GetFolderPathInput): Promise<readonly Folder[]> {
    const path = await this.folders.getPathToRoot(input.folderId, this.maxDepth);
    if (path.length === 0) {
      throw new FolderNotFoundError(input.folderId);
    }
    return path;
  }
}
