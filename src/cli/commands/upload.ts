/**
 * Upload CLI command
 */

import { uploadWithConfig } from '../../core/upload.js';
import { configure } from '../../core/config.js';
import { success, log, error } from '../output.js';
import { runCli } from '../run.js';

export interface UploadCliArgs {
    path?: string;
    app?: string;
    buildPath?: string;
    token?: string;
    server?: string;
}

/**
 * Run the upload command
 */
export async function runUpload(args: UploadCliArgs): Promise<void> {
    // Apply any CLI overrides
    if (args.token) {
        configure({ token: args.token });
    }
    if (args.server) {
        configure({ server: args.server });
    }

    const pathOrAppName = args.path || '';

    log(`Uploading build to Dokploy...`);
    if (args.path) {
        log(`   Local path: ${args.path}`);
    }
    if (args.app) {
        log(`   App ID: ${args.app}`);
    }

    // When user runs "dfs up myapp", pathOrAppName is "myapp" and we should
    // use it for config lookup. Don't pass it as path override since that
    // would override the config's localPath.
    // Only pass explicit path when user runs "dfs up ./dist --app ID"
    const hasExplicitPath = args.path && args.app;

    const result = await uploadWithConfig(pathOrAppName, {
        path: hasExplicitPath ? args.path : undefined,
        app: args.app,
        buildPath: args.buildPath,
    });

    if (result.success) {
        success(result.message);
    }
}

/**
 * Upload command entry point with error handling
 */
export async function uploadCommand(args: UploadCliArgs): Promise<number> {
    const result = await runCli(() => runUpload(args));
    return result.exitCode;
}
