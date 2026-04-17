import { FolderNotFoundError } from '../domain/errors';
import type { FolderRepository } from '../ports/folder-repository';

export interface SoftDeleteFolderInput {
  readonly folderId: string;
}

export class SoftDeleteFolderService {
  constructor(
    private readonly folders: FolderRepository,
    private readonly maxDepth: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async exec(input: SoftDeleteFolderInput): Promise<void> {
    const existing = await this.folders.getById(input.folderId);
    if (!existing) {
      throw new FolderNotFoundError(input.folderId);
    }
    await this.folders.softDelete({
      folderId: input.folderId,
      deletedAt: this.now(),
      maxDepth: this.maxDepth,
    });
  }
}
