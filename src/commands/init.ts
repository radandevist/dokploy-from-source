/**
 * Init command - creates a config.js file in the current directory
 */

import { writeFileSync, existsSync } from 'node:fs';

const CONFIG_TEMPLATE = `/**
 * dfs configuration
 *
 * This file configures your Dokploy deployments.
 * Docs: https://github.com/radandevist/dokploy-from-source
 */

export default {
    // Your Dokploy server URL
    server: 'https://your-dokploy-server.com',

    // Your applications
    apps: {
        // Example app - replace with your app name and ID
        myapp: {
            // Get the app ID from your Dokploy dashboard URL
            appId: 'YOUR_APP_ID_HERE',

            // Optional: local build folder (default: './dist')
            // localPath: './dist',

            // Optional: server build path (where app is served on server)
            // serverBuildPath: '/',
        },
    },
};
`;

export function init(args: string[]): void {
    const configPath = './dfs.config.js';

    if (existsSync(configPath)) {
        console.log(`⚠️  ${configPath} already exists.`);
        console.log('   Delete it first if you want to recreate.');
        process.exit(1);
    }

    writeFileSync(configPath, CONFIG_TEMPLATE);

    console.log('✅ Created config.js');
    console.log('');
    console.log('Next steps:');
    console.log('1. Edit config.js - add your server URL and app ID');
    console.log('2. Run: dfs auth YOUR_TOKEN');
    console.log('3. Run: dfs upload myapp');
}
