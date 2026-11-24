/**
 * Local test website with two switchable versions (v1 = baseline, v2 = changed) used by integration
 * and E2E tests, and handy for manual local testing:
 *
 *   npm run fixture            -> http://localhost:4400  (v1)
 *   POST /__admin/version?v=2  -> switch to v2
 *
 * Login: username "qa", password "secret123" at /login; /account is protected.
 */
import http from "node:http";
import { fileURLToPath } from "node:url";

type Version = 1 | 2;

const css = (v: Version) => `
  body{font-family:Arial,Helvetica,sans-serif;margin:0;color:#222;background:#fff}
  img{max-width:100%;height:auto}
  header{background:${v === 1 ? "#1e3a8a" : "#7c2d12"};color:#fff;padding:16px 24px;display:flex;gap:16px;align-items:center}
  header a{color:#fff;text-decoration:none}
  .hero{padding:48px 24px;background:#eef2ff}
  .hero h1{font-size:40px;margin:0 0 12px}
  .btn{display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;margin-right:8px}
  .features{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:24px}
  .card{border:1px solid #ddd;border-radius:8px;padding:16px}
  footer{padding:24px;background:#111;color:#bbb}
  footer a{color:#bbb}
  @media (max-width:600px){.features{grid-template-columns:1fr}.hero h1{font-size:28px}}
  .wide{width:700px;height:20px;background:#fca5a5}
`;

function layout(v: Version, title: string, body: string, opts: { description?: string; loggedIn?: boolean } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${opts.description ?? "Acme Widgets – quality widgets since 1999"}">
<meta property="og:title" content="${title}">
<link rel="canonical" href="/">
<style>${css(v)}</style></head><body>
<header><strong>Acme</strong>
<nav><a href="/">Home</a> · <a href="/about">About</a> · <a href="/products">Products</a> · <a href="/contact">Contact</a>${v === 2 ? ' · <a href="/pricing">Pricing</a>' : ""} · <a href="/account">${opts.loggedIn ? "My account" : "Account"}</a></nav>
</header>
${body}
<footer><p>© Acme Widgets. Last updated: ${new Date().toISOString().slice(0, 10)} ${new Date().toTimeString().slice(0, 8)}</p>
<p><a href="https://example.org/partner">Partner site</a> · <a href="/privacy">Privacy</a></p></footer>
</body></html>`;
}

const svg = (color: string, label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="${color}"/><text x="20" y="110" font-size="32" fill="#fff" font-family="Arial">${label}</text></svg>`;

function home(v: Version) {
  return layout(
    v,
    v === 1 ? "Acme Widgets – Home" : "Acme Widgets – Home of Better Widgets",
    `<section class="hero" id="hero">
  <h1>${v === 1 ? "Welcome to Acme Widgets" : "Welcome to Acme Widgets Co."}</h1>
  <p>${v === 1 ? "We build reliable widgets for every business." : "We build reliable, affordable widgets for every business."}</p>
  <a class="btn" href="/products">Get Started</a>${v === 1 ? '<a class="btn" href="/contact">Contact Sales</a>' : ""}
  <img src="/img/hero.svg" alt="Hero widget" width="400" height="200">
</section>
<section class="features" id="features">
  <div class="card"><h3>Durable</h3><p>Made from tested materials.</p></div>
  <div class="card"><h3>Fast</h3><p>Ships in 2 days.</p></div>
  <div class="card"><h3>Supported</h3><p>${v === 1 ? "24/7 customer support." : "Business-hours customer support."}</p></div>
</section>
${v === 2 ? '<section id="newsletter" class="newsletter"><h2>Newsletter</h2><p>Subscribe for monthly widget news.</p><div class="wide"></div></section>' : ""}
<section id="links"><h2>Resources</h2><ul><li><a href="/blog/first-post">Read our first post</a></li>${v === 2 ? '<li><a href="/old-page">Old resources</a></li>' : ""}</ul>
${v === 2 ? '<img src="/img/missing.png" alt="Promo banner">' : ""}</section>`,
    { description: v === 1 ? "Acme Widgets – quality widgets since 1999" : "Acme Widgets – better widgets since 1999" },
  );
}

const pages: Record<string, (v: Version) => string | null> = {
  "/": home,
  "/about": (v) =>
    v === 1 ? layout(v, "About Acme", `<main><h1>About us</h1><p>Founded in 1999 by widget enthusiasts.</p><p>Our team has 40 people.</p></main>`) : null,
  "/products": (v) =>
    layout(
      v,
      "Products – Acme",
      `<main><h1>Products</h1>
<div class="features"><div class="card"><h2>Widget A</h2><img src="/img/widget-a.svg" alt="Widget A"><p>Price: $19</p></div>
<div class="card"><h2>Widget B</h2><img src="/img/${v === 1 ? "widget-b" : "widget-b-new"}.svg" alt="Widget B"><p>Price: ${v === 1 ? "$29" : "$34"}</p></div></div></main>`,
    ),
  "/contact": (v) =>
    layout(
      v,
      "Contact – Acme",
      `<main><h1>Contact</h1><form action="/contact" method="post">
<label for="name">Name</label><input id="name" name="name">
<label for="email">Email</label><input id="email" name="email" type="email">
${v === 2 ? '<label for="phone">Phone</label><input id="phone" name="phone" type="tel">' : ""}
<textarea name="message" aria-label="Message"></textarea><button type="submit">Send</button></form></main>`,
    ),
  "/pricing": (v) => (v === 2 ? layout(v, "Pricing – Acme", `<main><h1>Pricing</h1><p>Plans start at $19.</p></main>`) : null),
  "/blog/first-post": (v) => layout(v, "First post – Acme", `<article><h1>Our first post</h1><p>Widgets are great.</p></article>`),
  // Standalone page (no shared layout): identical in v1 and v2 except a timestamp, which must be filtered as noise.
  "/terms": () =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Terms</title></head><body style="font-family:Arial;padding:24px"><h1>Terms of service</h1><p>Use widgets responsibly.</p><p>Generated ${new Date().toISOString().slice(0, 19)}</p></body></html>`,
  "/privacy": (v) => layout(v, "Privacy – Acme", `<main><h1>Privacy</h1><p>We respect your privacy.</p></main>`),
};

export interface FixtureServer {
  url: string;
  port: number;
  setVersion(v: Version): void;
  getVersion(): Version;
  close(): Promise<void>;
}

export function startFixtureServer(port = 4400, initial: Version = 1): Promise<FixtureServer> {
  let version: Version = initial;
  const sockets = new Set<import("node:net").Socket>();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const p = url.pathname.replace(/\/$/, "") || "/";
    const cookies = Object.fromEntries((req.headers.cookie ?? "").split(/;\s*/).filter(Boolean).map((c) => c.split("=")));
    const loggedIn = cookies.session === "valid-session";
    const send = (status: number, body: string, type = "text/html; charset=utf-8", headers: Record<string, string> = {}) => {
      res.writeHead(status, { "Content-Type": type, ...headers });
      res.end(req.method === "HEAD" ? undefined : body);
    };

    if (p === "/__admin/version") {
      const v = Number(url.searchParams.get("v"));
      if (req.method === "POST" && (v === 1 || v === 2)) version = v;
      return send(200, JSON.stringify({ version }), "application/json");
    }
    if (p === "/robots.txt") return send(200, `User-agent: *\nAllow: /\nSitemap: http://localhost:${port}/sitemap.xml\n`, "text/plain");
    if (p === "/sitemap.xml")
      return send(
        200,
        `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${["/", "/about", "/products", "/contact", "/blog/first-post", "/slow", "/terms"]
          .map((x) => `<url><loc>http://localhost:${port}${x}</loc></url>`)
          .join("")}</urlset>`,
        "application/xml",
      );
    if (p.startsWith("/img/")) {
      const name = p.slice(5);
      const colors: Record<string, [string, string]> = {
        "hero.svg": ["#2563eb", "Hero"],
        "widget-a.svg": ["#059669", "Widget A"],
        "widget-b.svg": ["#d97706", "Widget B"],
        "widget-b-new.svg": ["#dc2626", "Widget B v2"],
      };
      if (colors[name]) return send(200, svg(...colors[name]), "image/svg+xml");
      return send(404, "not found", "text/plain");
    }
    if (p === "/slow") {
      // v1: normal page. v2: never responds in time -> crawl failure (must NOT be reported as removed).
      if (version === 2) return void setTimeout(() => send(200, layout(version, "Slow", "<main><h1>Slow</h1></main>")), 120_000);
      return send(200, layout(version, "Slow page – Acme", `<main><h1>Slow page</h1><p>This page loads normally in v1.</p></main>`));
    }
    if (p === "/login") {
      if (req.method === "POST") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const f = new URLSearchParams(body);
          if (f.get("username") === "qa" && f.get("password") === "secret123") {
            res.writeHead(302, { Location: "/account", "Set-Cookie": "session=valid-session; Path=/; HttpOnly" });
            return res.end();
          }
          send(401, layout(version, "Login – Acme", `<main><h1>Login</h1><p class="error">Invalid credentials</p>${loginForm}</main>`));
        });
        return;
      }
      return send(200, layout(version, "Login – Acme", `<main><h1>Login</h1>${loginForm}</main>`));
    }
    if (p === "/logout") return send(302, "", "text/html", { Location: "/", "Set-Cookie": "session=; Path=/; Max-Age=0" });
    if (p === "/account" || p.startsWith("/account/")) {
      if (!loggedIn) return send(302, "", "text/html", { Location: "/login?next=" + encodeURIComponent(p) });
      if (p === "/account")
        return send(
          200,
          layout(
            version,
            "My account – Acme",
            `<main><h1>Welcome back, QA</h1><p>${version === 1 ? "You have 3 open orders." : "You have no open orders."}</p><a href="/account/orders">Orders</a> · <a href="/logout">Log out</a></main>`,
            { loggedIn },
          ),
        );
      if (p === "/account/orders") return send(200, layout(version, "Orders – Acme", `<main><h1>Your orders</h1><ul><li>Order #1001</li><li>Order #1002</li></ul></main>`, { loggedIn }));
    }
    const render = pages[p];
    const html = render?.(version);
    if (html) return send(200, html);
    return send(404, layout(version, "Not found – Acme", `<main><h1>Page not found</h1><p>Error 404</p></main>`));
  });
  const loginForm = `<form method="post" action="/login"><label for="username">Username</label><input id="username" name="username">
<label for="password">Password</label><input id="password" name="password" type="password"><button type="submit">Sign in</button></form>`;
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      resolve({
        url: `http://localhost:${port}`,
        port,
        setVersion: (v) => (version = v),
        getVersion: () => version,
        close: () =>
          new Promise<void>((r) => {
            for (const s of sockets) s.destroy();
            server.close(() => r());
          }),
      });
    });
  });
}

// Run directly: npm run fixture [-- --port 4400 --version 1]
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (name: string, d: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : d;
  };
  const port = Number(process.env.FIXTURE_PORT || arg("port", "4400"));
  startFixtureServer(port, Number(arg("version", "1")) === 2 ? 2 : 1).then((s) => {
    console.log(`Fixture site running at ${s.url} (version ${s.getVersion()}). Switch: curl -X POST "${s.url}/__admin/version?v=2"`);
  });
}
