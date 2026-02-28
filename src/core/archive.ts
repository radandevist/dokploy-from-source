/**
 * Archive module - streaming ZIP creation
 *
 * Creates ZIP archives without buffering entire contents in memory.
 * Uses temp directory with UUID filenames for safety.
 */

import { createWriteStream, createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import archiver from 'archiver';
import type { Readable } from 'node:stream';

/**
 * Sanitize a string for use as a filename
 */
function sanitizeFilename(name: string): string {
    return name
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_{2,}/g, '_')
        .substring(0, 100);
}

/**
 * Create a streaming ZIP archive from a source path
 *
 * @param sourcePath - Path to file or directory to archive
 * @param baseName - Base name for the ZIP file (without extension)
 * @returns Path to the created ZIP file
 */
export async function createZipStream(
    sourcePath: string,
    baseName: string
): Promise<string> {
    const sanitizedName = sanitizeFilename(baseName || 'archive');
    const zipFileName = `${sanitizedName}_${randomUUID()}.zip`;
    const zipPath = join(tmpdir(), zipFileName);

    await new Promise<void>((resolve, reject) => {
        const output = createWriteStream(zipPath);
        const archive = archiver('zip', {
            zlib: { level: 9 },
        });

        output.on('close', () => resolve());
        output.on('error', (err) => reject(err));
        archive.on('error', (err) => reject(err));

        archive.pipe(output);

        // Archive directory contents at root (not including the directory name)
        // Using false as the destination places contents at the archive root
        archive.directory(sourcePath, false);

        archive.finalize();
    });

    return zipPath;
}

/**
 * Clean up a temporary ZIP file
 *
 * @param zipPath - Path to the ZIP file to delete
 */
export async function cleanupZip(zipPath: string): Promise<void> {
    try {
        await rm(zipPath, { force: true, recursive: true });
    } catch {
        // Ignore cleanup errors
    }
}

/**
 * Create a readable stream from a file path
 *
 * @param filePath - Path to the file
 * @returns Readable stream
 */
export function createFileStream(filePath: string): Readable {
    return createReadStream(filePath);
}
