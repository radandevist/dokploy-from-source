/**
 * CLI runner - error handling for CLI commands
 *
 * Wraps CLI command execution to catch errors and display
 * user-friendly messages. Uses process.exitCode instead of
 * process.exit() for proper cleanup.
 */

import { DfsError, ConfigError, AuthError, UploadError } from '../core/errors.js';
import { error, log } from './output.js';

export interface CliResult {
    success: boolean;
    exitCode: number;
}

/**
 * Run a CLI command with error handling
 *
 * @param fn - Async function to run
 * @returns Result object with exit code
 */
export async function runCli<T>(fn: () => Promise<T>): Promise<CliResult> {
    try {
        await fn();
        return { success: true, exitCode: 0 };
    } catch (err) {
        const exitCode = handleError(err);
        return { success: false, exitCode };
    }
}

/**
 * Handle an error and return exit code
 */
function handleError(err: unknown): number {
    if (err instanceof DfsError) {
        // Handle specific error types with helpful messages
        if (err instanceof ConfigError) {
            error(err.message);
            if (err.code === 'NO_SERVER') {
                log('Add your Dokploy server URL to dfs.config.cjs');
            }
            return 1;
        }

        if (err instanceof AuthError) {
            error(err.message);
            if (err.code === 'NO_TOKEN') {
                log('Run: dfs auth YOUR_TOKEN');
            }
            return 1;
        }

        if (err instanceof UploadError) {
            error(err.message);
            // Only show "Server returned" for actual HTTP responses
            if (err.isHttp && err.statusCode) {
                log(`Server returned: ${err.statusCode}`);
            }
            if (err.responseBody) {
                log(`Response: ${err.responseBody}`);
            }
            return 1;
        }

        // Generic DfsError
        error(err.message);
        return 1;
    }

    if (err instanceof Error) {
        error(err.message);
        return 1;
    }

    error(String(err));
    return 1;
}

/**
 * Exit with code (sets exitCode instead of process.exit)
 */
export function exit(code: number): void {
    process.exitCode = code;
}
