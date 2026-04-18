import { FileNotDeletedError, FileNotFoundError } from '../domain/errors';
import type {
  FileRepository,
  RestoreFileResult,
} from '../ports/file-repository';

export interface RestoreFileInput {
  readonly fileId: string;
}

/**
 * Single-file restore counterpart to `RestoreFolderService`. The adapter
 * already throws `FileNotFoundError` / `FileNotDeletedError` from its
 * pre-check, so this service is a thin orchestration layer: it owns the
 * "now" stamp and re-exports the error types so the controller has a single
 * import surface for restore.
 *
 * We intentionally do *not* re-implement the existence check here even
 * though `SoftDeleteFileService` does. The reasoning is asymmetric: for
 * delete, we want a fast 404 when the row was already tombstoned (the
 * idempotent UPDATE in the adapter would silently succeed and confuse
 * clients). For restore, the adapter's pre-check already produces both
 * 404 and 409 with the right error types — adding a second check here
 * would just race the adapter and double the round-trips.
 */
export class RestoreFileService {
  constructor(
    private readonly files: FileRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async exec(input: RestoreFileInput): Promise<RestoreFileResult> {
    return this.files.restore({
      fileId: input.fileId,
      restoredAt: this.now(),
    });
  }
}

export { FileNotDeletedError, FileNotFoundError };
