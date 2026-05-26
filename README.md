# STP Website

A multi-page website built with Vite, React, TypeScript, and Tailwind CSS.

## Prerequisites

- **Node.js** (v18 or later) — https://nodejs.org/

```bash
node -v
npm -v
```

## Important: FAUbox Sync

Do **not** sync `node_modules/` via FAUbox between machines. Run `npm install` locally on each machine.

The built `docs/` folder **is** committed to git — that is how GitHub Pages is updated.

## First-Time Setup

```bash
npm install
npm run build
```

## Development

```bash
npm run dev
```

## Deploy to GitHub Pages

**No GitHub Actions.** See **[DEPLOY.md](./DEPLOY.md)** if Actions keep failing.

```bash
npm run build
```

Commit `docs/`, push `main`.

**Settings → Pages → Deploy from a branch → `main` → `/docs`**

Do **not** set Pages source to “GitHub Actions”.

## Troubleshooting

**Site looks unstyled:** Delete `node_modules/`, run `npm install && npm run build`, commit `docs/`, push.

**Actions fail with upload-pages-artifact / jekyll:** Wrong deploy mode. Read [DEPLOY.md](./DEPLOY.md) — switch Pages to **Deploy from branch → main → /docs** and stop re-running old workflow jobs.

**Pushed but site is old:** You forgot `npm run build` before pushing, or Pages source is not `main` / `/docs`.

**Build fails on Windows:** Ensure `npm install` completed; scripts use `cross-env`.
