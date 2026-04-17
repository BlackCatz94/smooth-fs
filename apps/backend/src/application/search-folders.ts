import { InvalidInputError } from '../domain/errors';
import type { Folder } from '../domain/folder';
import type { FolderRepository, Page } from '../ports/folder-repository';

export interface SearchFoldersInput {
  readonly query: string;
  readonly cursor: string | null;
  readonly limit: number;
}

/**
 * Bounded substring search over folder names. The service enforces semantic
 * rules (non-empty trimmed query, length caps) so both HTTP and queue callers
 * share the same guarantees; the adapter assumes these are already satisfied.
 */
export class SearchFoldersService {
  static readonly MIN_QUERY_LENGTH = 2;
  static readonly MAX_QUERY_LENGTH = 100;

  constructor(private readonly folders: FolderRepository) {}

  async exec(input: SearchFoldersInput): Promise<Page<Folder>> {
    const query = input.query.trim();
    if (query.length < SearchFoldersService.MIN_QUERY_LENGTH) {
      throw new InvalidInputError(
        `Search query must be at least ${SearchFoldersService.MIN_QUERY_LENGTH} characters`,
        { received: query.length },
      );
    }
    if (query.length > SearchFoldersService.MAX_QUERY_LENGTH) {
      throw new InvalidInputError(
        `Search query must be at most ${SearchFoldersService.MAX_QUERY_LENGTH} characters`,
        { received: query.length },
      );
    }
    return this.folders.searchFolders({
      query,
      cursor: input.cursor,
      limit: input.limit,
    });
  }
}
