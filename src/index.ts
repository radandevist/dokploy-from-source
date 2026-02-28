#!/usr/bin/env node

/**
 * dfs - dokploy-from-source
 *
 * A CLI for uploading local builds to Dokploy without using Git.
 *
 * Usage:
 *   dfs upload <path> --app <app-id>
 *   dfs auth <token>
 *   dfs init
 */

import { upload } from './commands/upload.js';
import { init } from './commands/init.js';
import { auth } from './commands/auth.js';

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
    case 'upload': {
        const uploadArgs = args.slice(1);
        upload(uploadArgs).catch((error) => {
            console.error('❌ Upload failed:', error);
            process.exit(1);
        });
        break;
    }
    case 'init': {
        const initArgs = args.slice(1);
        init(initArgs);
        break;
    }
    case 'auth': {
        const authArgs = args.slice(1);
        auth(authArgs).catch((error) => {
            console.error('❌ Auth failed:', error);
            process.exit(1);
        });
        break;
    }
    case '--help':
    case '-h':
    default:
        console.log(`
dfs - dokploy-from-source

CLI for deploying local builds to Dokploy without using Git.

Usage:
  dfs upload <path> --app <app-id>   Upload and deploy
  dfs auth <token>                  Set your API token
  dfs init                          Create config.js template

Configuration:
  dfs looks for config.js in the current directory.
  Auth token is stored in ~/.config/dfs/auth.json

Examples:
  # First time setup
  dfs init
  dfs auth YOUR_TOKEN
  dfs auth               # to enter interactively

  # Upload a build
  dfs upload ./dist --app YOUR_APP_ID

  # Or use app name from config
  dfs upload myapp

Docs: https://github.com/radandevist/dokploy-from-source
`);
        process.exit(0);
}
