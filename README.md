# dokploy-from-source

A CLI for deploying local builds to Dokploy without using Git.

Instead of pushing to Git and letting Dokploy build from source, you build locally and upload the result directly. This is useful when:

- You want full control over the build process
- You're behind a firewall or have limited Git access
- You prefer local builds over Git-based deployments

## Quick Start

```bash
# Install
git clone https://github.com/radandevist/dokploy-from-source.git
cd dokploy-from-source
npm install
npm link

# Setup
dfs init                    # Creates dfs.config.cjs
dfs auth YOUR_TOKEN         # Set your API token

# Use
dfs up myapp
```

## Installation

```bash
# Clone the repo
git clone https://github.com/radandevist/dokploy-from-source.git
cd dokploy-from-source

# Install dependencies
npm install

# Link the CLI globally
npm link
```

## Commands

### `dfs init`

Creates a `dfs.config.cjs` file in the current directory with default settings.

```bash
dfs init
```

This creates:

```javascript
// dfs.config.cjs
module.exports = {
    server: 'https://your-dokploy-server.com',

    apps: {
        myapp: {
            appId: 'YOUR_APP_ID_HERE',
            localPath: './dist',        // optional: local build folder
            serverBuildPath: '/',       // optional: server path
        },
    },
};
```

### `dfs auth`

Stores and validates your API token per server in `~/.config/dfs/auth.json`.

```bash
# Pass token as argument (uses server from dfs.config.cjs)
dfs auth YOUR_TOKEN

# Or specify server explicitly
dfs auth YOUR_TOKEN --server https://your-dokploy.com

# Or enter interactively
dfs auth
```

Tokens are stored per-server, so you can have different tokens for different Dokploy deployments.

To get your API token:
1. Go to your Dokploy dashboard
2. Navigate to **Settings → Profile**
3. Click **Generate** to create an API token

### `dfs up` (alias: `dfs upload`)

Uploads a build to Dokploy and triggers deployment.

```bash
# Use app name from config
dfs up myapp

# Or with explicit path and app ID
dfs up ./dist --app YOUR_APP_ID

# Upload a pre-made archive
dfs up ./build.zip --app YOUR_APP_ID

# Specify server build path
dfs up ./dist --app YOUR_APP_ID --build-path /app
```

## Configuration

### dfs.config.cjs

Create a `dfs.config.cjs` file in your project directory:

```javascript
// dfs.config.cjs
module.exports = {
    // Your Dokploy server URL
    server: 'https://your-dokploy-server.com',

    // Your applications
    apps: {
        // Short name -> config
        myapp: {
            appId: 'YOUR_APP_ID',
            localPath: './dist',         // optional: local build folder (default: ./dist)
            serverBuildPath: '/',       // optional: server path where app is served
        },

        api: {
            appId: 'ANOTHER_APP_ID',
            localPath: './publish',      // for .NET apps
        },
    },
};
```

Then use short names:

```bash
dfs up myapp    # uses config.apps.myapp
dfs up api      # uses config.apps.api
```

### Config Options

| Option | Type | Description |
|--------|------|-------------|
| `appId` | string | Your Dokploy application ID (required) |
| `localPath` | string | Local build folder path (default: `./dist`) |
| `serverBuildPath` | string | Server path where app is served (optional) |

### Build Type Configuration

You can configure the build type in your config. When `build` is specified with a `buildType`, the CLI will automatically sync these settings to Dokploy on each upload.

**Static (SPA):**
```javascript
myapp: {
    appId: 'YOUR_APP_ID',
    localPath: './dist',
    build: {
        buildType: 'static',
        publishDirectory: './dist',
        isStaticSpa: true,  // enables SPA mode (handles client-side routing)
    },
},
```

**Dockerfile:**
```javascript
myapp: {
    appId: 'YOUR_APP_ID',
    localPath: './dist',
    build: {
        buildType: 'dockerfile',
        dockerfile: 'Dockerfile',
        dockerContextPath: '.',
        dockerBuildStage: 'build',  // optional: for multi-stage builds
    },
},
```

**Nixpacks:**
```javascript
myapp: {
    appId: 'YOUR_APP_ID',
    localPath: './dist',
    build: {
        buildType: 'nixpacks',
        publishDirectory: './dist',  // optional: specify output directory
    },
},
```

**Railpack:**
```javascript
myapp: {
    appId: 'YOUR_APP_ID',
    localPath: './dist',
    build: {
        buildType: 'railpack',
        railpackVersion: '0.15.4',  // optional: specify version
    },
},
```

**Heroku Buildpacks:**
```javascript
myapp: {
    appId: 'YOUR_APP_ID',
    localPath: './dist',
    build: {
        buildType: 'heroku_buildpacks',
        herokuVersion: '24',  // optional: specify builder version
    },
},
```

**Paketo Buildpacks:**
```javascript
myapp: {
    appId: 'YOUR_APP_ID',
    localPath: './dist',
    build: {
        buildType: 'paketo_buildpacks',  // no additional options
    },
},
```

**Build Type Options by Type:**

| Option | dockerfile | heroku | paketo | nixpacks | static | railpack |
|--------|-----------|--------|--------|----------|--------|----------|
| `dockerfile` | ✓ | - | - | - | - | - |
| `dockerContextPath` | ✓ | - | - | - | - | - |
| `dockerBuildStage` | ✓ | - | - | - | - | - |
| `herokuVersion` | - | ✓ | - | - | - | - |
| `railpackVersion` | - | - | - | - | - | ✓ |
| `publishDirectory` | - | - | - | ✓ | ✓ | - |
| `isStaticSpa` | - | - | - | - | ✓ | - |
| `allowUnknownOptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

**Note:** When `build` is configured, the CLI syncs settings to Dokploy on each `dfs up`. Only explicitly specified options are sent — Dokploy determines how omitted options are handled. If the API call fails, the upload will fail.

By default, the CLI rejects unknown or irrelevant options for the selected `buildType` (to catch typos). If Dokploy adds new build options and you need to proceed before updating this CLI, you can set `allowUnknownOptions: true` to skip unknown-option validation.

### Auth Storage

Tokens are stored per-server in:

```
~/.config/dfs/auth.json
```

Format:
```json
{
  "servers": {
    "https://prod.dokploy.com": "token-for-prod",
    "https://staging.dokploy.com": "token-for-staging"
  }
}
```

This keeps your tokens out of your project files. Each project uses the token matching its configured server.

The CLI uses the `x-api-key` header for authentication (consistent across upload and auth commands).

## Getting Your App ID

The application ID is the last part of the URL in your Dokploy dashboard:

```
https://your-dokploy-server.com/dashboard/project/.../services/application/YOUR_APP_ID
```

## How It Works

1. **Build locally** - Run your build process (`npm run build`, `dotnet publish`, etc.)
2. **Upload** - The CLI packages your build output and uploads it to Dokploy
3. **Deploy** - Dokploy extracts the archive and starts your application

The uploaded files are stored in `/var/lib/dokploy/applications/{appName}/code/` on your Dokploy server.

## Examples

### React/Vite App

```bash
# Build locally
cd my-app
npm run build

# Upload to Dokploy
dfs up myapp
```

### .NET App

```bash
# Build locally
cd apps/api
dotnet publish -c Release -o ./publish

# Upload to Dokploy (with custom localPath in config)
dfs up api
```

## Programmatic API

Use `dokploy-from-source` as a library in your IaC pipelines.

### Installation

```bash
npm install dokploy-from-source
```

### Usage

```javascript
import { configure, upload } from 'dokploy-from-source';
```

### Configuration

Set global overrides that take precedence over `dfs.config.cjs` and `auth.json`:

```javascript
configure({
    server: 'https://dokploy.example.com',
    token: 'your-api-token'
});
```

### Upload

**Option 1: Use app name from config**

```javascript
await upload({ appName: 'myapp' });
```

**Option 2: Pass all options programmatically**

```javascript
await upload({
    path: './dist',
    appId: 'YOUR_APP_ID',
    buildPath: '/app'
});
```

**Option 3: Mixed (use config for some, override others)**

```javascript
await upload({
    appName: 'myapp',           // looks up appId and localPath from config
    token: 'override-token',     // overrides the stored token
    buildPath: '/custom-path'    // overrides config
});
```

### Full API Reference

| Function | Description |
|----------|-------------|
| `configure(options)` | Set global server/token overrides |
| `upload(options)` | Upload a build |
| `getConfigOverrides()` | Get current configuration |
| `resetConfigure()` | Clear configuration overrides |

### Upload Options

| Option | Type | Description |
|--------|------|-------------|
| `path` | string | Local file/folder path |
| `appName` | string | App name from dfs.config.cjs |
| `appId` | string | Dokploy app ID |
| `localPath` | string | Local build folder |
| `buildPath` | string | Server build path |
| `token` | string | API token override |
| `server` | string | Server URL override |

## Troubleshooting

### "Not authenticated"

Run `dfs auth YOUR_TOKEN` to store your API token.

### "Upload failed: 401 Unauthorized"

Your API token is invalid or expired. Generate a new one and run:

```bash
dfs auth NEW_TOKEN
```

### "Upload failed: 403 Forbidden"

You don't have permission to deploy this application. Check your user permissions in Dokploy.

### Build Issues

If your app doesn't start after upload:

1. The **serverBuildPath** is correct (use `--build-path` if needed)
2. Your **start command** is configured in Dokploy
3. The **port** matches what Dokploy expects

## License

MIT
