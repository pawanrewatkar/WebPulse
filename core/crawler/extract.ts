/**
 * Browser-side scripts. They are plain JavaScript strings (not TS functions) so that no
 * transpiler helpers (e.g. esbuild's __name) end up inside page.evaluate().
 */

/** CSS that removes animation/transition noise and hides ignored elements before capture. */
export function buildNoiseCss(ignoreSelectors: string[]): string {
  const base = `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important;scroll-behavior:auto!important}`;
  // One rule per selector, so an invalid selector only invalidates its own rule.
  const hide = ignoreSelectors
    .filter((s) => s && !/[{}<>]/.test(s))
    .map((s) => `${s}{visibility:hidden!important}`)
    .join("\n");
  return base + "\n" + hide;
}

/** Scrolls through the page to trigger lazy-loaded content, pauses media, then returns to the top. */
export const SETTLE_SCRIPT = String.raw`(async (maxHeight) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelectorAll('video, audio').forEach((m) => { try { m.pause(); m.currentTime = 0; } catch (e) {} });
  let y = 0;
  for (let i = 0; i < 40; i++) {
    const h = Math.min(document.documentElement.scrollHeight, maxHeight);
    if (y >= h) break;
    y += Math.max(200, Math.floor(window.innerHeight * 0.9));
    window.scrollTo(0, y);
    await sleep(120);
  }
  window.scrollTo(0, 0);
  await sleep(150);
  const imgs = Array.from(document.images).filter((img) => !img.complete);
  await Promise.race([
    Promise.all(imgs.map((img) => new Promise((r) => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); }))),
    sleep(4000),
  ]);
  try { await document.fonts.ready; } catch (e) {}
  return document.documentElement.scrollHeight;
})`;

/** Extracts structured page data. Called as `(${EXTRACT_SCRIPT})(options)`. Returns PageData. */
export const EXTRACT_SCRIPT = String.raw`((opts) => {
  const MAX = 3000;
  const norm = (s) => (s || '').replace(/[\s ​]+/g, ' ').trim();
  const ignored = new Set();
  for (const sel of (opts.ignoreSelectors || [])) {
    try { document.querySelectorAll(sel).forEach((e) => ignored.add(e)); } catch (e) {}
  }
  const isIgnored = (el) => { for (let e = el; e; e = e.parentElement) if (ignored.has(e)) return true; return false; };
  const isVisible = (el) => {
    if (el.checkVisibility) return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const ok = (el) => !isIgnored(el) && isVisible(el);
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, '\\$&'));
  const cssPath = (el) => {
    try {
      if (el.id && document.querySelectorAll('#' + esc(el.id)).length === 1) return '#' + esc(el.id);
    } catch (e) {}
    const parts = [];
    let e = el;
    while (e && e.nodeType === 1 && e !== document.documentElement && parts.length < 6) {
      let part = e.tagName.toLowerCase();
      if (e.id) {
        try { if (document.querySelectorAll('#' + esc(e.id)).length === 1) { parts.unshift('#' + esc(e.id)); break; } } catch (x) {}
      }
      const p = e.parentElement;
      if (p) {
        const same = Array.from(p.children).filter((c) => c.tagName === e.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(e) + 1) + ')';
      }
      parts.unshift(part);
      if (e === document.body) break;
      e = p;
    }
    return parts.join(' > ');
  };
  const box = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.left + window.scrollX), Math.round(r.top + window.scrollY), Math.round(r.width), Math.round(r.height)]; };
  const abs = (u) => { try { return new URL(u, location.href).href; } catch (e) { return u || ''; } };

  // ---- metadata
  const metaContent = (sel) => { const m = document.querySelector(sel); return m ? norm(m.getAttribute('content')) : ''; };
  const og = {}, twitter = {};
  document.querySelectorAll('meta[property^="og:"]').forEach((m) => { og[m.getAttribute('property')] = norm(m.getAttribute('content')); });
  document.querySelectorAll('meta[name^="twitter:"]').forEach((m) => { twitter[m.getAttribute('name')] = norm(m.getAttribute('content')); });
  const canonicalEl = document.querySelector('link[rel="canonical"]');

  // ---- headings
  const headings = [];
  document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
    if (!ok(h)) return;
    const text = norm(h.innerText);
    if (text) headings.push({ level: Number(h.tagName[1]), text: text.slice(0, 500), selector: cssPath(h), box: box(h) });
  });

  // ---- text blocks: block-level text containers, plus leftover "own text" in generic containers
  const BLOCK = new Set(['P','LI','BLOCKQUOTE','DD','DT','FIGCAPTION','TD','TH','LABEL','SUMMARY','PRE','CAPTION','ADDRESS']);
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','SVG','CANVAS','IFRAME','H1','H2','H3','H4','H5','H6','BUTTON','SELECT','OPTION','TEXTAREA','INPUT','HEAD','TITLE']);
  const textBlocks = [];
  const covered = new Set();
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
  let node = walker.currentNode;
  const insideCovered = (el) => { for (let e = el.parentElement; e; e = e.parentElement) if (covered.has(e)) return true; return false; };
  while (node && textBlocks.length < MAX) {
    const el = node;
    if (SKIP.has(el.tagName) || el.closest('h1,h2,h3,h4,h5,h6,button,svg')) { node = walker.nextNode(); continue; }
    if (BLOCK.has(el.tagName)) {
      const hasInnerBlock = Array.from(el.querySelectorAll('p,li,blockquote,dd,dt,td,th,pre')).length > 0;
      if (!hasInnerBlock && !insideCovered(el) && ok(el)) {
        const text = norm(el.innerText);
        if (text) { textBlocks.push({ tag: el.tagName.toLowerCase(), text: text.slice(0, 2000), selector: cssPath(el), box: box(el) }); covered.add(el); }
      }
    } else if (!insideCovered(el)) {
      let own = '';
      el.childNodes.forEach((c) => { if (c.nodeType === 3) own += ' ' + c.textContent; });
      own = norm(own);
      if (own.length >= 2 && /[\p{L}\p{N}]/u.test(own) && ok(el) && !el.closest('a,label')) {
        textBlocks.push({ tag: el.tagName.toLowerCase(), text: own.slice(0, 2000), selector: cssPath(el), box: box(el) });
      }
    }
    node = walker.nextNode();
  }

  // ---- buttons / CTAs
  const buttons = [];
  const seenBtn = new Set();
  document.querySelectorAll('button, input[type=submit], input[type=button], input[type=reset], [role=button], a[class*="btn"], a[class*="button"], a[class*="cta"], a[class*="Button"], a[class*="Btn"]').forEach((b) => {
    if (seenBtn.has(b) || !ok(b)) return;
    seenBtn.add(b);
    const text = norm(b.innerText || b.value || b.getAttribute('aria-label') || b.getAttribute('title'));
    if (!text) return;
    buttons.push({ text: text.slice(0, 200), tag: b.tagName.toLowerCase(), href: b.tagName === 'A' ? abs(b.getAttribute('href')) : null, selector: cssPath(b), box: box(b) });
  });

  // ---- images
  const images = [];
  document.querySelectorAll('img').forEach((img) => {
    if (isIgnored(img) || images.length >= MAX) return;
    const src = img.currentSrc || img.src || img.getAttribute('data-src') || '';
    if (!src || src.startsWith('data:image/gif')) return;
    if (img.naturalWidth === 1 && img.naturalHeight === 1) return; // tracking pixel
    const r = img.getBoundingClientRect();
    images.push({
      src: abs(src), alt: norm(img.getAttribute('alt')), width: Math.round(r.width), height: Math.round(r.height),
      naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
      loaded: img.complete && img.naturalWidth > 0, selector: cssPath(img), box: box(img),
    });
  });

  // ---- links
  const links = [];
  document.querySelectorAll('a[href]').forEach((a) => {
    if (isIgnored(a) || links.length >= MAX) return;
    const raw = a.getAttribute('href') || '';
    if (!raw || raw.startsWith('#') || /^javascript:/i.test(raw)) return;
    links.push({ href: abs(raw), text: norm(a.innerText || a.getAttribute('aria-label') || a.getAttribute('title')).slice(0, 200), rel: a.getAttribute('rel') || '', target: a.getAttribute('target') || '', selector: cssPath(a), box: box(a) });
  });

  // ---- sections (landmarks and major blocks)
  const sections = [];
  const sectionSel = 'header, nav, main, footer, aside, section, article, [role=banner], [role=navigation], [role=main], [role=contentinfo], [role=region], form';
  document.querySelectorAll(sectionSel).forEach((s) => {
    if (sections.length >= 200 || !ok(s)) return;
    const r = s.getBoundingClientRect();
    if (r.height < 10) return;
    const h = s.querySelector('h1,h2,h3,h4,h5,h6');
    const text = norm(s.innerText);
    sections.push({
      tag: s.tagName.toLowerCase(), id: s.id || '', classes: (typeof s.className === 'string' ? s.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 4).join(' '),
      role: s.getAttribute('role') || '', heading: h ? norm(h.innerText).slice(0, 200) : '', textLength: text.length, textSample: text.slice(0, 160),
      top: Math.round(r.top + window.scrollY), height: Math.round(r.height), selector: cssPath(s), box: box(s),
    });
  });

  // ---- forms
  const forms = [];
  document.querySelectorAll('form').forEach((f) => {
    if (!ok(f)) return;
    const fields = [];
    f.querySelectorAll('input, select, textarea').forEach((i) => {
      const type = (i.getAttribute('type') || i.tagName).toLowerCase();
      if (type === 'hidden') return;
      let label = '';
      if (i.id) { const l = document.querySelector('label[for="' + esc(i.id) + '"]'); if (l) label = norm(l.innerText); }
      if (!label) label = norm(i.getAttribute('aria-label') || i.getAttribute('placeholder'));
      fields.push({ name: i.getAttribute('name') || i.id || '', type, label: label.slice(0, 120) });
    });
    forms.push({ action: f.getAttribute('action') ? abs(f.getAttribute('action')) : '', method: (f.getAttribute('method') || 'get').toLowerCase(), selector: cssPath(f), box: box(f), fields });
  });

  // ---- DOM stats and outline
  const tagCounts = {};
  let elementCount = 0, maxDepth = 0;
  const OUT_SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','LINK','META','BR','WBR']);
  const outline = [];
  const sig = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id && !/\d{3,}/.test(el.id)) s += '#' + el.id;
    const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter((c) => c && !/\d{3,}|^(is-|has-|active|show|open|hover|focus)/.test(c)).sort().slice(0, 3);
    if (cls.length) s += '.' + cls.join('.');
    return s;
  };
  const walk = (el, depth) => {
    elementCount++;
    tagCounts[el.tagName.toLowerCase()] = (tagCounts[el.tagName.toLowerCase()] || 0) + 1;
    if (depth > maxDepth) maxDepth = depth;
    const kids = Array.from(el.children).filter((c) => !OUT_SKIP.has(c.tagName) && !ignored.has(c));
    if (el.tagName === 'svg' || el.tagName === 'SVG') { kids.length = 0; }
    let i = 0;
    while (i < kids.length) {
      const s = sig(kids[i]);
      let n = 1;
      while (i + n < kids.length && sig(kids[i + n]) === s) n++;
      if (depth < 10 && outline.length < 2500) outline.push('  '.repeat(depth) + s + (n > 1 ? ' x' + n : ''));
      for (let k = 0; k < n; k++) walk(kids[i + k], depth + 1);
      i += n;
    }
  };
  if (document.body) walk(document.body, 0);

  const de = document.documentElement;
  return {
    url: opts.requestedUrl,
    finalUrl: location.href,
    title: norm(document.title),
    lang: de.getAttribute('lang') || '',
    meta: {
      description: metaContent('meta[name="description"]'),
      keywords: metaContent('meta[name="keywords"]'),
      robots: metaContent('meta[name="robots"]'),
      canonical: canonicalEl ? abs(canonicalEl.getAttribute('href')) : '',
      viewport: metaContent('meta[name="viewport"]'),
      og, twitter,
    },
    headings, textBlocks, buttons, images, links, sections, forms,
    iframes: Array.from(document.querySelectorAll('iframe')).filter((f) => !isIgnored(f)).map((f) => abs(f.getAttribute('src') || '')).filter(Boolean).slice(0, 100),
    domStats: { elementCount, maxDepth, tagCounts },
    outline,
    layout: {
      // clientWidth = layout viewport; innerWidth grows when mobile browsers zoom out to fit overflowing content.
      scrollWidth: de.scrollWidth, scrollHeight: de.scrollHeight, viewportWidth: de.clientWidth, viewportHeight: de.clientHeight,
      horizontalOverflow: de.scrollWidth > de.clientWidth + 2,
    },
  };
})`;
