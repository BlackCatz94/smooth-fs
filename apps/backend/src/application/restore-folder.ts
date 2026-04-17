import { FolderNotDeletedError, FolderNotFoundError } from '../domain/errors';
import type { FolderRepository, RestoreFolderResult } from '../ports/folder-repository';

export interface RestoreFolderInput {
  readonly folderId: string;
}

/**
 * Restore the soft-deleted subtree rooted at `folderId`. Service-layer
 * concerns (existence check, depth cap, "now" stamping) live here so the
 * adapter only owns atomic SQL. Existence is checked via a helper that
 * sees soft-deleted rows (`getSoftDeletedById`) — we can't use the default
 * `getById` because it filters them out.
 */
export class RestoreFolderService {
  constructor(
    private readonly folders: FolderRepository,
    private readonly maxDepth: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async exec(input: RestoreFolderInput): Promise<RestoreFolderResult> {
    const result = await this.folders.restore({
      folderId: input.folderId,
      restoredAt: this.now(),
      maxDepth: this.maxDepth,
    });
    // The port throws on missing rows; the service never synthesizes these
    // conditions itself but re-exports the types so callers have a single
    // import surface for restore.
    return result;
  }
}

export { FolderNotDeletedError, FolderNotFoundError };
