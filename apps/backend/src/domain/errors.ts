/**
 * Base class for typed domain errors. Adapters (HTTP, queue) map these to
 * transport-specific responses in one place (see `adapters/http/error-mapper.ts`).
 *
 * Each subclass declares its own `httpStatus` so adding a new domain error does
 * not require editing the mapper's instanceof ladder (Open/Closed). The mapper
 * falls back to 500 for any subclass that forgets to declare one.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class FolderNotFoundError extends DomainError {
  readonly code = 'FOLDER_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(public readonly folderId: string) {
    super(`Folder not found: ${folderId}`);
  }
}

export class FileNotFoundError extends DomainError {
  readonly code = 'FILE_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(public readonly fileId: string) {
    super(`File not found: ${fileId}`);
  }
}

export class InvalidCursorError extends DomainError {
  readonly code = 'INVALID_CURSOR';
  readonly httpStatus = 400;
  constructor(reason: string) {
    super(`Invalid cursor: ${reason}`);
  }
}

export class DepthLimitExceededError extends DomainError {
  readonly code = 'DEPTH_LIMIT_EXCEEDED';
  readonly httpStatus = 422;
  constructor(
    public readonly requestedDepth: number,
    public readonly maxDepth: number,
  ) {
    super(`Requested traversal depth ${requestedDepth} exceeds max ${maxDepth}`);
  }
}

export class InvalidInputError extends DomainError {
  readonly code = 'INVALID_INPUT';
  readonly httpStatus = 422;
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

/**
 * Thrown when restore is called on a folder that is not soft-deleted. Restore
 * is only defined over rows with a non-null `deletedAt`; treating a live folder
 * as "restore target" would be a no-op with confusing client semantics, so we
 * surface it as a 409 Conflict via `error-mapper.ts`.
 */
export class FolderNotDeletedError extends DomainError {
  readonly code = 'FOLDER_NOT_DELETED';
  readonly httpStatus = 409;
  constructor(public readonly folderId: string) {
    super(`Folder is not soft-deleted and cannot be restored: ${folderId}`);
  }
}

/**
 * Symmetric counterpart to `FolderNotDeletedError` for single-file restore.
 * 409 (Conflict) — the request is well-formed but the row's current state
 * (already live) makes the operation illegal. Distinct from 404: the file
 * exists, it just isn't a restore target.
 */
export class FileNotDeletedError extends DomainError {
  readonly code = 'FILE_NOT_DELETED';
  readonly httpStatus = 409;
  constructor(public readonly fileId: string) {
    super(`File is not soft-deleted and cannot be restored: ${fileId}`);
  }
}
