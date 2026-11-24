# Development Status

Website Change Detection & Monitoring System — **local-first**. Nothing is deployed.

## How to run (Windows, Node ≥ 20.12)

```powershell
npm install
npx playwright install chromium
copy .env.example .env.local      # already done; edit as needed
npm run dev                        # terminal 1: web app  → http://localhost:3000
npm run worker                     # terminal 2: background worker (required for crawls/comparisons)
npm run fixture                    # optional terminal 3: local test site → http://localhost:4400
```

Production mode: `npm run build` then `npm start` (+ `npm run worker`).

| Command | Purpose |
|---|---|
| `npm run typecheck` | TypeScript check |
| `npm test` | unit + integration tests (Vitest, real Playwright crawls of the fixture site) |
| `npm run test:unit` / `npm run test:integration` | subsets |
| `npm run build` then `npm run test:e2e` | E2E browser tests against the production build + real worker (uses `data-test/`) |
| `npm run cli -- list \| add \| baseline \| compare \| report \| jobs` | run everything without the web app (see `scripts/cli.ts`) |
| `npm run fixture` | local two-version test website; switch with `curl -X POST "http://localhost:4400/__admin/version?v=2"` (login: `qa` / `secret123`) |

## Architecture

```
src/            Next.js 16 app (App Router, React 19, Tailwind 4) – UI + API routes only, never runs Playwright
core/           framework-free shared logic (used by web, worker, CLI)
  db/           Repository interface + SQLite implementation (better-sqlite3, WAL). Swap point for PostgreSQL/Supabase.
  storage.ts    Storage interface + local implementation (DATA_DIR/storage). Swap point for Supabase Storage.
  crawler/      Playwright crawler: discovery (sitemap/robots + links), login, capture, extraction, link checks
  compare/      detectors (content/heading/CTA/metadata/section/image/link/form/DOM/responsive), pixel diff, engine
  reports/      Excel (ExcelJS) and PDF (pdfkit) reports
  jobs/         job handlers, runner, context (progress, logs, cancellation)
  security/     SSRF protection + URL normalisation, AES-256-GCM credential encryption
worker/         polling background worker (jobs table as queue, heartbeats, stale-job recovery)
scripts/cli.ts  CLI
tests/          unit, integration, e2e, fixtures/site-server.ts
```

Data: `data/app.db` (SQLite) and `data/storage/` (`runs/<runId>/<page>/<device>/screenshot.png|thumb.jpg|dom.html|data.json`, `comparisons/<id>/…` diffs & crops, `manual/…`, `reports/…`).

## Completed features

**Phase 1 – Foundation** ✅ project structure, dashboard, website CRUD with per-site crawl settings, SQLite + migrations, file storage, config (`.env.local`), structured logging with secret redaction, job queue, worker status indicator.

**Phase 2 – Crawler & baselines** ✅ Playwright crawler; desktop (1440×900) + mobile (390×844, touch, mobile UA); sitemap.xml/robots.txt + internal-link discovery (BFS, depth & page limits); manual include URLs, exclude patterns, extra internal domains (external domains never crawled otherwise); form login with encrypted credentials and success/failure checks; session-loss detection; retries, timeouts, crawl delay; full-page screenshots (height capped), DOM snapshot, extracted data (title/meta/OG, headings, text blocks, buttons/CTAs, images incl. load state, links, sections, forms, iframes, DOM stats & outline, layout/overflow, element bounding boxes); link checks (and HTTP verification of images that failed to render); versioned, immutable baselines.

**Phase 3 – Baseline Explorer** ✅ website → version/capture → page → desktop/mobile; tabs Screenshots, Sections, Content, Images, Links, Metadata, DOM – all from stored data; manual comparison against any other stored run or a fresh one-URL capture ("Capture current version now"), side-by-side (synced scroll) or diff overlay, with per-change crops.

**Phase 4 – Automatic comparison** ✅ every baseline URL is revisited; page states: unchanged / changed / new / removed (HTTP 404/410 only) / HTTP error / **crawl failed – not verified** (never reported as removed) / not checked. Detects visual (pixelmatch, region clustering), content, heading, CTA, section, image (changed URL, removed, broken), link (added/removed/text/broken), metadata/SEO (title, description, canonical, robots/noindex, OG, redirects), form, DOM structure, responsive overflow. Change types added/removed/modified/potentially_broken; severities critical/high/medium/low. Noise filtering: animations disabled, ignored selectors hidden, built-in ad/cookie selectors, date/time/relative-time text filters, custom text patterns, cache-busting image query strings, punctuation-only text. Review: confirm / ignore / always ignore (fingerprint rule, auto-applied in later comparisons, manageable on the website page) / flag with note / reset. Re-compare stored runs without crawling.

**Phase 5 – Reports** ✅ Excel: Summary, Pages (page-wise), Changes (website, baseline version & dates, page name, URL, device, category, type, severity, description, expected, actual, steps to reproduce/verify, before/after evidence – embedded crops + links, review status, page comparison status), Ignored changes. PDF: overall summary, page-wise table, per-page change details with before/after images. Generated on demand (reflect current review state), copy saved to `storage/reports/`.

**Phase 6 – Testing** ✅ (last run 2026-11-24)
- Unit: 26 tests (URL normalisation, SSRF, crypto, redaction, repository/services, text diff, detectors, visual diff, sitemap parsing).
- Integration: 14 tests with real Chromium against the fixture site — public crawl, login-protected crawl, wrong password, versioning, full v1→v2 comparison, evidence files, Excel & PDF generation, always-ignore rules.
- E2E: 7 Playwright tests through the UI on the production build with a real worker (SSRF rejection, Save Website, Explorer tabs + device switch, Compare, review, Excel/PDF downloads, manual comparison, new version confirmation, restore).
- `npm run build` passes; `tsc --noEmit` clean.

## Security & reliability notes
- Credentials: AES-256-GCM (`APP_SECRET`, or auto-generated `data/secret.key`); write-only in the API/UI; never logged or included in reports.
- SSRF: http/https only, no embedded credentials, DNS-resolved private/loopback/link-local/metadata ranges blocked for navigations, sub-resources, sitemap fetches, link checks and every redirect hop. Allow specific hosts via `ALLOWED_PRIVATE_HOSTS` (default `.env.local` allows `localhost,127.0.0.1` for local testing — remove for production).
- Worker: heartbeats, stale "running" jobs failed on restart, cancellation between pages, browser always closed, one active job per website.
- Stored HTML is served as text with a sandbox CSP (never rendered live). Storage keys are validated against path traversal.

## Known issues / limitations
- PDF layout was verified structurally in tests (valid PDF, pages, embedded images) but not visually inspected (no PDF renderer on this machine). Uses Arial/Segoe UI/DejaVu if present for Unicode, otherwise Helvetica with non-Latin characters replaced.
- Visual diff is position-based: inserting content shifts everything below it, inflating the diff % (the description notes height changes; structured detectors pinpoint the actual change).
- Broken-link findings repeat on each page/device that links to the same URL (accurate but verbose).
- Crawling is sequential (polite, predictable); large sites are slow. Max 1000 pages/site.
- DNS-rebinding between the SSRF check and Chromium's own lookup is not fully prevented.
- Only form-based login is supported (no SSO/MFA/CAPTCHA). Compressed `.xml.gz` sitemaps are skipped.
- No user accounts/authentication on the web app itself — intended for local single-user use until deployment.
- No automatic weekly scheduling yet (run "Compare Website" manually or call the CLI from Windows Task Scheduler).

## Pending / next steps
- Scheduler for weekly comparisons; email/Slack notifications.
- Deployment (not started, by design): Postgres `Repository` + Supabase Storage implementations, app authentication, Vercel for `src/` (no Playwright there), worker on a separate host. Free-tier limits: keep screenshot heights/page counts bounded, prune or archive old runs manually (nothing is deleted automatically).
