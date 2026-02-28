/**
 * Upload command - uploads a build to Dokploy
 *
 * API: POST /trpc/application.dropDeployment
 * Body: multipart/form-data with:
 *   - zip: File (binary)
 *   - applicationId: string
 *   - dropBuildPath: string (optional)
 */

import { readFileSync, existsSync, statSync, mkdirSync, rmSync, createWriteStream } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import archiver from 'archiver';
import { getServer, getAuth, getAppConfig } from '../lib/config.js';

interface UploadArgs {
    path: string;
    app?: string;
    buildPath?: string;
}

async function createZip(sourcePath: string, zipName: string): Promise<string> {
    const zipPath = join(dirname(sourcePath), `${zipName}.zip`);

    console.log('   Creating zip archive...');

    await new Promise<void>((resolve, reject) => {
        const output = createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => resolve());
        archive.on('error', (err) => reject(err));

        archive.pipe(output);
        archive.directory(sourcePath, false);
        archive.finalize();
    });

    return zipPath;
}

export async function upload(args: UploadArgs): Promise<void> {
    // Get auth token
    const auth = getAuth();
    const server = await getServer();

    if (!auth?.token) {
        console.error('❌ Error: Not authenticated');
        console.log('   Run: dfs auth YOUR_TOKEN');
        process.exit(1);
    }

    let { path: localPath, app: appId, buildPath: serverBuildPath } = args;
    let appName = localPath;

    // If no appId from args, try config file (use path as app name)
    if (!appId && localPath) {
        const config = await getAppConfig(localPath);
        if (config) {
            appName = localPath; // Use the argument as app name
            appId = config.appId;
            serverBuildPath = config.serverBuildPath;
            localPath = config.localPath;
        }
    }

    if (!localPath) {
        console.error('❌ Error: Path is required');
        console.log('   Usage: dfs up <path> --app <app-id>');
        console.log('   Example: dfs up ./dist --app uqsJFzeXlkZhERc4f28O4');
        console.log('   Or use app name from config: dfs up myapp');
        process.exit(1);
    }

    if (!appId) {
        console.error('❌ Error: Application ID is required (--app)');
        console.log('   Usage: dfs up <path> --app <app-id>');
        process.exit(1);
    }

    // Check if path exists
    if (!existsSync(localPath)) {
        console.error(`❌ Error: Path does not exist: ${localPath}`);
        process.exit(1);
    }

    console.log(`📤 Uploading build to Dokploy...`);
    console.log(`   Local path: ${localPath}`);
    console.log(`   App ID: ${appId}`);

    // Create zip archive if path is a directory
    let filePath = localPath;
    const stat = statSync(localPath);

    if (stat.isDirectory()) {
        // Use app name for zip file, default to 'app' if not provided
        const name = appName || 'app';
        filePath = await createZip(localPath, name);
        console.log(`   Archive: ${filePath}`);
    }

    console.log('   Uploading...');

    // Read file
    const fileBuffer = readFileSync(filePath);

    // Create multipart form data
    const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);

    const parts: Buffer[] = [];

    // Add applicationId field
    parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="applicationId"\r\n\r\n` +
        `${appId}\r\n`
    ));

    // Add dropBuildPath field if provided (server-side build path)
    if (serverBuildPath) {
        parts.push(Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="dropBuildPath"\r\n\r\n` +
            `${serverBuildPath}\r\n`
        ));
    }

    // Add zip file
    const fileName = basename(filePath);
    parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="zip"; filename="${fileName}"\r\n` +
        `Content-Type: application/zip\r\n\r\n`
    ));

    // Add file content
    parts.push(fileBuffer);
    parts.push(Buffer.from('\r\n'));

    // Close boundary
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const response = await fetch(`${server}/api/trpc/application.dropDeployment`, {
        method: 'POST',
        headers: {
            'x-api-key': auth.token,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body: body,
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Upload failed: ${response.status} ${response.statusText}`);
        console.error(`   Error: ${errorText}`);
        process.exit(1);
    }

    console.log('✅ Upload successful!');
    console.log('   Deployment triggered automatically.');

    // Clean up temp archive if we created one
    if (stat.isDirectory()) {
        rmSync(filePath);
        console.log('   Cleaned up temporary archive.');
    }
}
