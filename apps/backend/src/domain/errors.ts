/**
 * Base class for typed domain errors. Adapters (HTTP, queue) map these to
 * transport-specific responses in one place (see `adapters/http/error-mapper.ts`).
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class FolderNotFoundError extends DomainError {
  readonly code = 'FOLDER_NOT_FOUND';
  constructor(public readonly folderId: string) {
    super(`Folder not found: ${folderId}`);
  }
}

export class InvalidCursorError extends DomainError {
  readonly code = 'INVALID_CURSOR';
  constructor(reason: string) {
    super(`Invalid cursor: ${reason}`);
  }
}

export class DepthLimitExceededError extends DomainError {
  readonly code = 'DEPTH_LIMIT_EXCEEDED';
  constructor(
    public readonly requestedDepth: number,
    public readonly maxDepth: number,
  ) {
    super(`Requested traversal depth ${requestedDepth} exceeds max ${maxDepth}`);
  }
}

export class InvalidInputError extends DomainError {
  readonly code = 'INVALID_INPUT';
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}
