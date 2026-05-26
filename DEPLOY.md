# Deploy (read this — no GitHub Actions)

This site does **not** use GitHub Actions. If you see Actions failures about
`upload-pages-artifact` or `jekyll-build-pages`, that is the wrong deploy path.

## Fix GitHub settings (one time)

1. **Turn off Actions workflows**
   - Repo → **Settings** → **Actions** → **General**
   - Under “Actions permissions”, choose **Disable actions** (or leave enabled — there are no workflow files in this repo).

2. **Point Pages at the built folder on `main`**
   - Repo → **Settings** → **Pages**
   - **Build and deployment → Source:** **Deploy from a branch**
   - **Branch:** `main` · **Folder:** `/docs`
   - **Save**
   - Do **not** choose “GitHub Actions” as the source.

3. **Stop re-running old failed runs**
   - Repo → **Actions** → ignore / delete old “Deploy GitHub Pages” runs
   - Do not click **Re-run all jobs** on those — the workflow file was removed.

## Publish an update

```bash
npm run build
```

Commit the `docs/` folder (and any source changes), push `main` with GitHub Desktop.

Pages updates in 1–2 minutes: https://kreatora.github.io/regulations_test/

## If push fails with 403 / account suspended

Fix the GitHub account at https://support.github.com — no repo change fixes that.
