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

No GitHub Actions. Build locally, commit, push.

```bash
npm run build
```

Then commit the `docs/` folder and push `main` with GitHub Desktop (or git).

**One-time Pages setting:** **Settings → Pages → Deploy from a branch → `main` → `/docs`**

Site URL: https://kreatora.github.io/regulations_test/

### Alternative: gh-pages branch

```bash
npm run deploy
```

Then set Pages to branch **`gh-pages`**, folder **`/ (root)`**.

## Troubleshooting

**Site looks unstyled:** Delete `node_modules/`, run `npm install && npm run build`, commit `docs/`, push.

**Pushed but site is old:** You forgot `npm run build` before pushing, or Pages source is not `main` / `/docs`.

**Actions fail with 403 / account suspended:** Ignore Actions — this repo does not use them. Fix the GitHub account at https://support.github.com if pushes also fail.

**Build fails on Windows:** Ensure `npm install` completed; scripts use `cross-env`.
