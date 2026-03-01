/**
 * Init CLI command
 *
 * Creates a dfs.config.cjs file in the current directory.
 */

import { writeFile, access } from 'node:fs/promises';
import { success, log, error, warning } from '../output.js';
import { runCli } from '../run.js';

const CONFIG_TEMPLATE = `/**
 * dfs configuration
 *
 * This file configures your Dokploy deployments.
 * Docs: https://github.com/radandevist/dokploy-from-source
 */

module.exports = {
    // Your Dokploy server URL
    server: 'https://your-dokploy-server.com',

    // Your applications
    apps: {
        // Example app - replace with your app name and ID
        myapp: {
            // Get the app ID from your Dokploy dashboard URL
            appId: 'YOUR_APP_ID_HERE',

            // Local build folder (required)
            localPath: './dist',

            // Optional: server build path (where app is served on server)
            // serverBuildPath: '/',

            // Optional: build type (auto-syncs to Dokploy on upload)
            // build: {
            //     buildType: 'static',       // dockerfile, heroku_buildpacks, paketo_buildpacks, nixpacks, static, railpack
            //     publishDirectory: './dist', // for nixpacks/static types
            //     isStaticSpa: true,          // for static type - enables SPA mode
            // },
        },
    },
};
`;

/**
 * Check if file exists
 */
async function fileExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

/**
 * Run the init command
 */
export async function runInit(): Promise<void> {
    const configPath = './dfs.config.cjs';

    // Check for old .js config file
    const oldConfigPath = './dfs.config.js';
    if (await fileExists(oldConfigPath)) {
        warning(`${oldConfigPath} already exists.`);
        log('The new config format uses .cjs extension for CommonJS compatibility.');
        log('Please delete or rename the old file if you want to create a new one.');
        throw new Error('Config file already exists');
    }

    if (await fileExists(configPath)) {
        warning(`${configPath} already exists.`);
        log('Delete it first if you want to recreate.');
        throw new Error('Config file already exists');
    }

    await writeFile(configPath, CONFIG_TEMPLATE);

    success('Created dfs.config.cjs');
    log('');
    log('Next steps:');
    log('1. Edit dfs.config.cjs - add your app ID');
    log('2. Run: dfs auth YOUR_TOKEN');
    log('3. Run: dfs up myapp');
}

/**
 * Init command entry point with error handling
 */
export async function initCommand(): Promise<number> {
    const result = await runCli(() => runInit());
    return result.exitCode;
}
