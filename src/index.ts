#!/usr/bin/env node

/**
 * dfs - dokploy-from-source
 *
 * A CLI for uploading local builds to Dokploy without using Git.
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { uploadCommand, authCommand, initCommand } from './cli/index.js';
import { exit } from './cli/run.js';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface UploadArgs {
    path: string;
    app?: string;
    'build-path'?: string;
    token?: string;
    server?: string;
}

interface AuthArgs {
    token?: string;
}

/**
 * Get version from package.json
 */
async function getVersion(): Promise<string> {
    try {
        const pkgPath = resolve(__dirname, '../package.json');
        const content = await readFile(pkgPath, 'utf-8');
        const pkg = JSON.parse(content);
        return pkg.version || '1.0.0';
    } catch {
        return '1.0.0';
    }
}

async function main() {
    const version = await getVersion();

    await yargs(hideBin(process.argv))
        .command(
            'init',
            'Create dfs.config.cjs template',
            (yargs) => yargs,
            async () => {
                const code = await initCommand();
                exit(code);
            }
        )
        .command(
            ['upload <path>', 'up <path>'],
            'Upload and deploy a build to Dokploy',
            (yargs) => {
                return yargs
                    .positional('path', {
                        describe: 'Local build folder path or app name from config',
                        type: 'string',
                        demandOption: true,
                    })
                    .option('app', {
                        describe: 'Dokploy application ID',
                        type: 'string',
                    })
                    .option('build-path', {
                        describe: 'Server build path',
                        type: 'string',
                    })
                    .option('token', {
                        describe: 'API token override',
                        type: 'string',
                    })
                    .option('server', {
                        describe: 'Server URL override',
                        type: 'string',
                    });
            },
            async (argv) => {
                const args = argv as UploadArgs;
                const code = await uploadCommand({
                    path: args.path,
                    app: args.app,
                    buildPath: args['build-path'],
                    token: args.token,
                    server: args.server,
                });
                exit(code);
            }
        )
        .command(
            ['auth [token]'],
            'Set and validate your API token',
            (yargs) => {
                return yargs
                    .positional('token', {
                        describe: 'API token',
                        type: 'string',
                    })
                    .option('token', {
                        describe: 'API token (alternative to positional)',
                        type: 'string',
                    });
            },
            async (argv) => {
                const args = argv as AuthArgs;
                const code = await authCommand({
                    token: args.token,
                });
                exit(code);
            }
        )
        .demandCommand(1, 'You need to specify a command')
        .help()
        .alias('help', 'h')
        .version(version)
        .alias('version', 'v')
        .alias('upload', 'up')
        .alias('init', 'i')
        .alias('auth', 'a')
        .describe('upload, up', 'Upload and deploy a build')
        .describe('init', 'Create config template')
        .describe('auth', 'Set API token')
        .example('dfs init', 'Create dfs.config.cjs template')
        .example('dfs auth YOUR_TOKEN', 'Set API token')
        .example('dfs up myapp', 'Upload build using config')
        .example('dfs up ./dist --app ID', 'Upload with explicit args')
        .epilogue('For more information, see https://github.com/radandevist/dokploy-from-source')
        .parse();
}

main().catch((error) => {
    console.error('Unexpected error:', error);
    exit(1);
});
