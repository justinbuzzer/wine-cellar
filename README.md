# Wine Cellar

A personal web app for a wine inventory and WSET-style tasting notes. The data lives in an
Excel workbook on OneDrive; the app reads and writes it through Microsoft Graph after you
sign in with a Microsoft account. No data is stored in this repository.

Live: https://justinbuzzer.github.io/wine-cellar/

## Run locally

```bash
npm install
npm run dev
```

Then open http://localhost:5173/wine-cellar/

## Deploy

Every push to `main` builds the site and publishes it to GitHub Pages
(`.github/workflows/deploy.yml`).

## Status

Step 1: sign-in and read-only loading of the `Inventory` and `Tasted` tables plus the
`List_*` dropdown lists.
