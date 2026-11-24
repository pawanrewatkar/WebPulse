# WebPulse – Website Change Detection & Monitoring

WebPulse automates weekly website QA audits. It saves a **baseline** of a website (screenshots, content, DOM, metadata for desktop and mobile), later **re-crawls** the site, and reports every change page by page with before/after evidence — plus downloadable Excel and PDF reports.

Runs entirely on your own computer with free, open-source tools. No paid APIs or cloud services.

## Features

- **Multiple websites** – public or login-protected (credentials encrypted), desktop + mobile, automatic page discovery (sitemap.xml + internal links), manual URLs, exclusions, per-site crawl settings. External domains are never crawled unless configured.
- **Save Website** – creates an immutable, versioned baseline. Older versions are kept and can be restored at any time.
- **Compare Website** – re-crawls and compares against any baseline version. Detects visual, text, heading, CTA/button, section, image, link (incl. broken links), metadata/SEO, form, DOM-structure and mobile-layout changes. Each change is classified as *added / removed / modified / potentially broken* with a severity.
- **Honest results** – a page is reported *removed* only when it really returns HTTP 404/410. Pages that fail to load are shown as **"crawl failed – not verified"**.
- **Review workflow** – confirm, ignore, "always ignore" (applies to future comparisons) or flag each change.
- **Baseline Explorer** – browse any stored capture without crawling: Screenshots, Sections, Content, Images, Links, Metadata and DOM tabs; side-by-side manual comparison with any other capture.
- **Reports** – Excel and PDF with page-wise and overall summaries, expected vs actual results, steps to verify, and evidence images.
- **Noise filtering** – animations disabled, timestamps/dates ignored, ads/cookie banners hidden, custom ignore selectors and text patterns.

## Requirements

- Windows, macOS or Linux
- Node.js 20.12 or newer
- About 500 MB disk for dependencies and the Chromium browser

## Setup

```bash
git clone https://github.com/pawanrewatkar/WebPulse.git
cd WebPulse
npm install
npx playwright install chromium
cp .env.example .env.local        # Windows: copy .env.example .env.local
```

## Run

Two processes are needed – the web app and the background worker that performs crawls:

```bash
npm run dev       # terminal 1 – web app at http://localhost:3000
npm run worker    # terminal 2 – background worker (required for Save/Compare)
```

Production mode: `npm run build` then `npm start` (plus `npm run worker`).

### Typical workflow

1. **Websites → Add website** – enter name and base URL (and login details if needed).
2. **Save Website** – capture the baseline (roughly 5–10 s per page per device).
3. After the site changes, **Compare Website** – then review changes and download Excel/PDF.
4. Use **Baseline Explorer** to inspect any stored capture.

### Try it with the built-in test site

```bash
npm run fixture   # test site at http://localhost:4400 (login: qa / secret123)
```

Add `http://localhost:4400` as a website and save a baseline, then switch the site to its changed version and compare:

```bash
curl -X POST "http://localhost:4400/__admin/version?v=2"
```

## Command line

Everything can also run without the web app:

```bash
npm run cli -- list
npm run cli -- add "My site" https://example.com
npm run cli -- baseline <websiteId> --label "Release 2"
npm run cli -- compare <websiteId> [baselineRunId]
npm run cli -- report <comparisonId> xlsx|pdf [outputFile]
npm run cli -- jobs
```

## Configuration (`.env.local`)

| Variable | Default | Purpose |
|---|---|---|
| `DATA_DIR` | `./data` | SQLite database and stored captures |
| `APP_SECRET` | auto-generated key file | Encrypts stored website passwords |
| `ALLOWED_PRIVATE_HOSTS` | `localhost,127.0.0.1` | Private/internal hosts allowed to be crawled (SSRF protection blocks all others) |
| `ALLOW_PRIVATE_NETWORKS` | `false` | Allow all private network targets (not recommended) |
| `WORKER_POLL_MS` | `2000` | Worker polling interval |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

All data lives in `DATA_DIR` – back it up to keep your baselines. It is excluded from git.

## Testing

```bash
npm run typecheck
npm test                          # unit + integration (real browser crawls of the test site)
npm run build && npm run test:e2e # end-to-end UI tests (uses a separate data-test/ folder)
```

## Project structure

```
src/        Next.js web app (UI + API routes; never runs the browser crawler)
core/       shared logic: db, storage, crawler, compare engine, reports, jobs, security
worker/     background worker
scripts/    CLI
tests/      unit, integration, e2e tests and the local fixture website
```

Tech stack: Next.js, React, TypeScript, Tailwind CSS, Playwright, SQLite (better-sqlite3), Pixelmatch, Sharp, ExcelJS, PDFKit, Vitest.

See [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) for completed features, known limitations and next steps, and [MEMORY.md](MEMORY.md) for design decisions and development notes.
