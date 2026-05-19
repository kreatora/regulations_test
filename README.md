# STP Website

A multi-page website built with Vite, React, TypeScript, and Tailwind CSS.

## Prerequisites

- **Node.js** (v18 or later) — download from https://nodejs.org/

To check if Node.js is installed, run:

```bash
node -v
npm -v
```

## Important: FAUbox Sync

The `node_modules/` and `docs/` folders must **NOT** be synced between machines via FAUbox.
Each person must run `npm install` and `npm run build` locally.

If FAUbox has already synced these folders to your machine, delete them first:

```powershell
Remove-Item -Recurse -Force node_modules
Remove-Item -Recurse -Force docs
```

Then follow the setup steps below.

## First-Time Setup

```bash
npm install
npm run build
```

## Development

Start a local dev server with hot reload:

```bash
npm run dev
```

## Building for Production

Default build (outputs to `docs/`):

```bash
npm run build
```

Alternative output folders:

```bash
npm run build:docs   # outputs to docs/
npm run build:dist   # outputs to dist/
```

## Preview a Production Build

```bash
npm run preview          # preview default build
npm run preview:docs     # preview docs/ on port 4173
npm run preview:dist     # preview dist/ on port 4174
```

## Deploy to GitHub Pages

```bash
npm run deploy
```

## Troubleshooting

**The site looks unstyled (no CSS) or only some pages look broken:**
Delete `node_modules/` and `docs/`, then run `npm install && npm run build` again.
This is usually caused by FAUbox syncing corrupted files between machines.

**`npm install` fails:**
Make sure you have Node.js v18+ installed. Delete `node_modules/` and `package-lock.json`, then run `npm install` again.

**Build scripts fail on Windows:**
The build scripts use `cross-env` for cross-platform environment variable support. Make sure `npm install` completed successfully.
