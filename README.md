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
dfs init                    # Creates config.js
dfs auth YOUR_TOKEN         # Set your API token

# Use
dfs upload ./dist --app YOUR_APP_ID
# Or use app name from config
dfs upload myapp
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

Creates a `config.js` file in the current directory with default settings.

```bash
dfs init
```

This creates:

```javascript
// config.js
export default {
    server: 'https://your-dokploy-server.com',

    apps: {
        myapp: {
            appId: 'YOUR_APP_ID_HERE',
            // buildPath: '/dist', // optional
        },
    },
};
```

### `dfs auth`

Stores and validates your API token securely in `~/.config/dfs/auth.json`.

```bash
# Pass token as argument
dfs auth YOUR_TOKEN

# Or enter interactively
dfs auth

# Or from environment variable
export DOKPLOY_TOKEN=YOUR_TOKEN
dfs auth
```

To get your API token:
1. Go to your Dokploy dashboard
2. Navigate to **Settings → Profile**
3. Click **Generate** to create an API token

### `dfs upload`

Uploads a build to Dokploy and triggers deployment.

```bash
# Upload a directory (will be archived automatically)
dfs upload ./dist --app YOUR_APP_ID

# Or use app name from config.js
dfs upload myapp

# Upload a pre-made archive
dfs upload ./build.tar.gz --app YOUR_APP_ID

# Specify build path if needed
dfs upload ./dist --app YOUR_APP_ID --build-path /app
```

## Configuration

### config.js

Create a `config.js` file in your project directory:

```javascript
// config.js
export default {
    // Your Dokploy server URL
    server: 'https://your-dokploy-server.com',

    // Your applications
    apps: {
        // Short name -> config
        myapp: {
            appId: 'YOUR_APP_ID',
            buildPath: '/dist',
        },

        api: {
            appId: 'ANOTHER_APP_ID',
        },
    },
};
```

Then use short names:

```bash
dfs upload myapp    # uses config.apps.myapp
dfs upload api      # uses config.apps.api
```

### Auth Storage

Your API token is stored in:

```
~/.config/dfs/auth.json
```

This keeps your token out of your project files and environment variables.

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

## Options

| Option | Alias | Description |
|--------|-------|-------------|
| `--app` | `-a` | Your Dokploy application ID |
| `--build-path` | `-b` | Path to build directory inside the archive |

## Examples

### React/Vite App

```bash
# Build locally
cd my-app
npm run build

# Upload to Dokploy
dfs upload ./dist --app YOUR_APP_ID
# or
dfs upload myapp   # if configured in config.js
```

### .NET App

```bash
# Build locally
cd apps/api
dotnet publish -c Release -o ./publish

# Upload to Dokploy
dfs upload ./publish --app YOUR_APP_ID --build-path /
```

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

1. The **build path** is correct (use `--build-path` if needed)
2. Your **start command** is configured in Dokploy
3. The **port** matches what Dokploy expects

## License

MIT
