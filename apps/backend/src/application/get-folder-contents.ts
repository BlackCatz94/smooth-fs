import { FolderNotFoundError } from '../domain/errors';
import type { FolderContents, FolderRepository } from '../ports/folder-repository';

export interface GetFolderContentsInput {
  readonly folderId: string;
  readonly foldersCursor: string | null;
  readonly filesCursor: string | null;
  readonly limit: number;
}

export class GetFolderContentsService {
  constructor(private readonly folders: FolderRepository) {}

  async exec(input: GetFolderContentsInput): Promise<FolderContents> {
    const exists = await this.folders.getById(input.folderId);
    if (!exists) {
      throw new FolderNotFoundError(input.folderId);
    }
    return this.folders.getFolderContents(input);
  }
}
