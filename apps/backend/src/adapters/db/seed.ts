import { sql } from 'drizzle-orm';
import { InvalidEnvError, loadEnv, resetEnvCache } from '../../env';
import { createDbHandle, type DbHandle } from './db';
import { files, folders } from './schema';

export interface SeedOptions {
  /** Depth of linear chain attached at the root. */
  readonly depth: number;
  /** Width at each node where siblings fan out. */
  readonly width: number;
  /** Number of files per fanned-out folder. */
  readonly filesPerFolder: number;
}

export interface SeedResult {
  readonly rootId: string;
  readonly totalFolders: number;
  readonly totalFiles: number;
}

/**
 * Deterministic fixture: one root → linear "deep" chain + a "wide" fan-out at
 * the root. Shaped for recursion and pagination tests (no randomness).
 */
export async function seedFixture(
  handle: DbHandle,
  opts: SeedOptions,
): Promise<SeedResult> {
  return handle.withTransaction(async (tx) => {
    await tx.execute(sql`TRUNCATE TABLE files, folders RESTART IDENTITY CASCADE`);

    const [root] = await tx
      .insert(folders)
      .values({ parentId: null, name: 'root' })
      .returning();
    if (!root) {
      throw new Error('failed to insert root');
    }

    let totalFolders = 1;
    let totalFiles = 0;

    let parentId: string = root.id;
    for (let d = 1; d <= opts.depth; d += 1) {
      const [child] = await tx
        .insert(folders)
        .values({ parentId, name: `deep-${String(d).padStart(4, '0')}` })
        .returning();
      if (!child) {
        throw new Error('failed to insert deep child');
      }
      parentId = child.id;
      totalFolders += 1;
    }

    for (let w = 0; w < opts.width; w += 1) {
      const [wide] = await tx
        .insert(folders)
        .values({ parentId: root.id, name: `wide-${String(w).padStart(4, '0')}` })
        .returning();
      if (!wide) {
        throw new Error('failed to insert wide child');
      }
      totalFolders += 1;
      if (opts.filesPerFolder > 0) {
        const batch = Array.from({ length: opts.filesPerFolder }, (_, i) => ({
          folderId: wide.id,
          name: `file-${String(i).padStart(4, '0')}.txt`,
        }));
        await tx.insert(files).values(batch);
        totalFiles += batch.length;
      }
    }

    return { rootId: root.id, totalFolders, totalFiles };
  });
}

if (import.meta.main) {
  resetEnvCache();
  let env: ReturnType<typeof loadEnv>;
  try {
    env = loadEnv();
  } catch (err) {
    if (err instanceof InvalidEnvError) {
      console.error('Invalid environment configuration:');
      for (const [key, msgs] of Object.entries(err.fieldErrors)) {
        if (msgs && msgs.length > 0) console.error(`  ${key}: ${msgs.join('; ')}`);
      }
    } else {
      console.error('seed failed', err);
    }
    process.exit(1);
  }
  const handle = createDbHandle(env);
  try {
    const result = await seedFixture(handle, {
      depth: 32,
      width: 64,
      filesPerFolder: 8,
    });
    console.info('seed complete', result);
  } finally {
    await handle.close();
  }
}
