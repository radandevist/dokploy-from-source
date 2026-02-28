#!/usr/bin/env node

/**
 * dfs - dokploy-from-source
 *
 * A CLI for uploading local builds to Dokploy without using Git.
 */

import yargs, { Arguments } from 'yargs';
import { hideBin } from 'yargs/helpers';
import { upload } from './commands/upload.js';
import { init } from './commands/init.js';
import { auth } from './commands/auth.js';

interface UploadArguments extends Arguments {
    path?: string;
    app?: string;
    a?: string;
    'build-path'?: string;
    b?: string;
}

interface AuthArguments extends Arguments {
    token?: string;
    t?: string;
}

async function main() {
    await yargs(hideBin(process.argv))
        .command(
            'init',
            'Create dfs.config.js template',
            (yargs) => {
                return yargs;
            },
            (argv) => {
                init([]);
            }
        )
        .command(
            ['upload <path>', 'up <path>'],
            'Upload and deploy a build to Dokploy',
            (yargs) => {
                return yargs
                    .positional('path', {
                        describe: 'Local build folder path',
                        type: 'string',
                    })
                    .option('app', {
                        alias: 'a',
                        describe: 'Dokploy application ID',
                        type: 'string',
                    })
                    .option('build-path', {
                        alias: 'b',
                        describe: 'Server build path',
                        type: 'string',
                    });
            },
            async (argv) => {
                const args = argv as UploadArguments;

                await upload({
                    path: args.path || '',
                    app: args.app || args.a,
                    buildPath: args['build-path'] || args.b,
                });
            }
        )
        .command(
            ['auth [token]', 'auth'],
            'Set and validate your API token',
            (yargs) => {
                return yargs
                    .positional('token', {
                        describe: 'API token',
                        type: 'string',
                    })
                    .option('token', {
                        alias: 't',
                        describe: 'API token',
                        type: 'string',
                    });
            },
            async (argv) => {
                const args = argv as AuthArguments;

                await auth(args.token || args.t);
            }
        )
        .demandCommand(1, 'You need to specify a command')
        .help()
        .alias('help', 'h')
        .version('1.0.0')
        .alias('version', 'v')
        .alias('version', 'V')
        .alias('upload', 'up')
        .alias('init', 'i')
        .alias('auth', 'a')
        .describe('upload, up', 'Upload and deploy a build')
        .describe('init', 'Create config template')
        .describe('auth', 'Set API token')
        .example('dfs init', 'Create dfs.config.js template')
        .example('dfs auth YOUR_TOKEN', 'Set API token')
        .example('dfs up myapp', 'Upload build using config')
        .example('dfs up ./dist --app ID', 'Upload with explicit args')
        .epilogue('For more information, see https://github.com/radandevist/dokploy-from-source')
        .parse();
}

main().catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
});
