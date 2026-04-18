import { FileNotFoundError } from '../domain/errors';
import type { FileRepository } from '../ports/file-repository';

export interface SoftDeleteFileInput {
  readonly fileId: string;
}

/**
 * Soft-deletes a single file row. Mirrors `SoftDeleteFolderService` but
 * scoped to one file — there is no subtree to traverse, so no `maxDepth`
 * dependency. We still do a presence check first so unknown ids surface
 * `FileNotFoundError` (mapped to 404) instead of being silently no-op'd
 * by the idempotent UPDATE in the adapter — clients want feedback when
 * they target the wrong id.
 */
export class SoftDeleteFileService {
  constructor(
    private readonly files: FileRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async exec(input: SoftDeleteFileInput): Promise<void> {
    const existing = await this.files.getById(input.fileId);
    if (!existing) {
      throw new FileNotFoundError(input.fileId);
    }
    await this.files.softDelete({
      fileId: input.fileId,
      deletedAt: this.now(),
    });
  }
}
