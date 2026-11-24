# Project Memory

Key decisions, rules and lessons learned for WebPulse. Read this before changing the code. Keep it short and update it when a decision changes.

## Non-negotiable rules

- **A crawl failure is never a removed page.** Only a real HTTP 404/410 counts as "removed". Timeouts and load errors become `crawl_failed` ("not verified").
- **Baselines are immutable.** "Save Website" always creates a new version. Nothing deletes historical data automatically. "Rollback" only changes `websites.active_baseline_id`.
- **No fake results.** Every finding must come from an actual capture. Unverifiable things are labelled as such (e.g. "image did not render (not verified over HTTP)").
- **Credentials never leave the server.** They are encrypted (AES-256-GCM) and write-only in the API. The logger redacts sensitive keys. Never include them in logs, reports or API responses.
- **Playwright never runs inside Next.js.** Crawls run only in the worker or CLI, so the web app can later be deployed to Vercel serverless.

## Architecture decisions

- **One npm package, three entry points:** web (`src/`), worker (`worker/index.ts`), CLI (`scripts/cli.ts`). Shared logic lives in `core/` and must stay free of Next.js imports.
- **Database:** all SQL lives in `core/db/sqlite.ts` behind the async `Repository` interface (`core/db/repository.ts`). For Supabase, add a Postgres implementation of the same interface. Schema changes go in the `MIGRATIONS` array (versioned with `PRAGMA user_version`); never edit an already-shipped migration.
- **Storage:** `core/storage.ts` interface; keys like `runs/<runId>/<pageSlug>/<device>/screenshot.png`. Keys are validated against path traversal.
- **Job queue:** the `jobs` table. The worker claims jobs atomically and heartbeats; on start it fails stale "running" jobs. Only one active job per website.
- **Comparison crawls** always revisit every baseline URL (`requiredUrls`), plus headroom for discovering new pages.
- **Reports** are generated on demand so they reflect the latest review status.
- `core/devices.ts` holds device profiles without importing Playwright, so the web app can use them.

## Detection details worth knowing

- Browser-side extraction (`core/crawler/extract.ts`) is a **plain JavaScript string**, not a TS function, so that transpiler helpers (esbuild `__name`) don't break `page.evaluate`. Inside `String.raw`, write regex escapes like `\p{L}` literally.
- **Mobile overflow:** use `documentElement.clientWidth`, not `window.innerWidth` — under mobile emulation Chromium zooms out and `innerWidth` grows with the content.
- **Text pairing:** a removed + added block in the same diff hunk becomes "modified" when similar (word + bigram Dice ≥ 0.3), or always when the hunk is exactly 1:1.
- Punctuation-only text (e.g. nav separators `· · ·`) is ignored. Image identity ignores query strings (cache busting).
- **"Always ignore"** stores a fingerprint (URL, device, category, type, expected, actual). Matching changes in later comparisons are auto-ignored, but still recorded.
- The visual diff is position-based: inserted content shifts everything below it and inflates the %. The structured detectors pinpoint the real change.

## Security

- SSRF checks (`core/security/url.ts`) run on navigations, every sub-resource request (`context.route`), sitemap fetches, link checks and every redirect hop (redirects are followed manually).
- `ALLOWED_PRIVATE_HOSTS` in `.env.local` allows localhost for testing only — remove it for any shared deployment.
- Stored HTML is served as plain text with a sandbox CSP; it is never rendered live.

## Development environment notes (Windows)

- **Do not edit files with PowerShell `Get-Content`/`Set-Content`.** Windows PowerShell 5.1 reads UTF-8 as ANSI and writes a BOM, which corrupted `–` characters once. Use an editor or Node scripts.
- `git commit -F -` with a PowerShell here-string doesn't work; use a message file or `-m`.
- TypeScript is pinned to 5.9 (TS 7 / the native compiler is not used by Next.js type checking).
- Tailwind v4: component classes (`.btn`, `.input`, …) must stay inside `@layer components`, otherwise they override utilities like `w-auto`.
- `next dev` generates `AGENTS.md`; it is committed intentionally.

## Testing notes

- The fixture site (`tests/fixtures/site-server.ts`) has v1/v2. v2 deliberately: changes title/H1/text, removes a CTA, makes `/about` 404, makes `/slow` hang (crawl failure), adds `/pricing`, a broken link, a broken image, a form field and a mobile overflow. `/terms` only changes a timestamp (must stay "unchanged").
- In v2 every layout page genuinely changes (the nav gains "Pricing"), so use `/terms` to test "unchanged".
- E2E uses `data-test/`, which is wiped once at Playwright config load (before servers open the database). The worker is started in `tests/e2e/global-setup.ts`.
- Async UI effects must ignore stale responses (an E2E test caught a slow comparison overwriting the current one in the Explorer).
