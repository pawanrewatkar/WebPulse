import { z } from "zod";

export const authSettingsSchema = z.object({
  loginUrl: z.string().url(),
  usernameSelector: z.string().min(1).default("input[type=email], input[name=username], input[name=email], #username"),
  passwordSelector: z.string().min(1).default("input[type=password]"),
  submitSelector: z.string().min(1).default("button[type=submit], input[type=submit]"),
  /** Selector that must be present after a successful login (optional). */
  successSelector: z.string().optional().default(""),
  /** Text / pattern the URL must NOT match after login (e.g. "/login"); empty = not checked. */
  failureUrlPattern: z.string().optional().default(""),
});

export const websiteSettingsSchema = z.object({
  devices: z.array(z.enum(["desktop", "mobile"])).min(1).default(["desktop", "mobile"]),
  maxPages: z.number().int().min(1).max(1000).default(25),
  maxDepth: z.number().int().min(0).max(10).default(3),
  crawlDelayMs: z.number().int().min(0).max(60_000).default(500),
  pageTimeoutMs: z.number().int().min(5_000).max(180_000).default(45_000),
  retries: z.number().int().min(0).max(5).default(2),
  waitAfterLoadMs: z.number().int().min(0).max(30_000).default(750),
  useSitemap: z.boolean().default(true),
  followLinks: z.boolean().default(true),
  /** Extra URLs (absolute or site-relative) always captured. */
  includeUrls: z.array(z.string()).default([]),
  /** URL patterns ("*" wildcard or /regex/) never crawled or compared. */
  excludePatterns: z.array(z.string()).default([]),
  /** Additional domains treated as internal (e.g. a separate shop subdomain). External domains are never crawled otherwise. */
  allowedDomains: z.array(z.string()).default([]),
  /** CSS selectors hidden before screenshots and skipped during extraction (dynamic widgets, ads, chat bubbles...). */
  ignoreSelectors: z.array(z.string()).default([]),
  /** Text patterns removed before content comparison ("*" wildcard or /regex/). */
  ignoreTextPatterns: z.array(z.string()).default([]),
  /** Apply built-in noise filters (dates/times, common ad & cookie widgets). */
  builtInNoiseFilters: z.boolean().default(true),
  /** Hide "related products / related posts" blocks that show random items on every visit. */
  ignoreRelatedContent: z.boolean().default(true),
  /** Hide image sliders & carousels entirely (they are frozen on their first slide either way). */
  ignoreSliders: z.boolean().default(false),
  /** Skip extra listing pages (page 2, 3 … of blogs, categories and shops). */
  skipPaginatedListings: z.boolean().default(true),
  /** pixelmatch per-pixel colour threshold (0..1). */
  visualThreshold: z.number().min(0).max(1).default(0.1),
  /** Minimum % of differing pixels before a visual change is reported. */
  visualMinDiffPercent: z.number().min(0).max(100).default(0.3),
  maxScreenshotHeight: z.number().int().min(1000).max(30_000).default(12_000),
  checkLinks: z.boolean().default(true),
  checkExternalLinks: z.boolean().default(false),
  maxLinkChecks: z.number().int().min(0).max(2000).default(150),
  auth: authSettingsSchema.nullable().default(null),
});

export type WebsiteSettings = z.infer<typeof websiteSettingsSchema>;
export type AuthSettings = z.infer<typeof authSettingsSchema>;

export function parseSettings(input: unknown): WebsiteSettings {
  return websiteSettingsSchema.parse(input ?? {});
}

/** Built-in ignore selectors for common noise (ads, cookie banners, chat widgets). */
export const BUILTIN_IGNORE_SELECTORS = [
  "ins.adsbygoogle",
  "[id^='google_ads']",
  "iframe[src*='doubleclick']",
  "iframe[src*='googlesyndication']",
  "[class*='cookie-banner']",
  "[id*='cookie-banner']",
  "#onetrust-banner-sdk",
  "#CybotCookiebotDialog",
  "[class*='intercom-launcher']",
  "#hubspot-messages-iframe-container",
  "[data-wcm-ignore]",
];

/** Recommendation widgets that show random items on every page load (WooCommerce, Elementor, Jetpack, YARPP). */
export const RELATED_CONTENT_SELECTORS = [
  ".related.products",
  ".upsells.products",
  ".cross-sells",
  "[class*='related-products']",
  "[class*='related-posts']",
  ".jp-relatedposts",
  ".yarpp-related",
];

/** Popular slider / carousel plugins (Smart Slider 3, Slider Revolution, Elementor, Swiper, Slick, Owl, MetaSlider, Splide, Flickity, Bootstrap). */
export const SLIDER_SELECTORS = [
  ".n2-section-smartslider",
  ".rev_slider_wrapper",
  "rs-module-wrap",
  ".elementor-slides-wrapper",
  ".elementor-image-carousel-wrapper",
  ".elementor-widget-image-carousel",
  ".swiper",
  ".swiper-container",
  ".slick-slider",
  ".owl-carousel",
  ".metaslider",
  ".flexslider",
  ".splide",
  ".flickity-enabled",
  ".carousel.slide",
];

/** Built-in text noise: timestamps, dates and relative times. */
export const BUILTIN_IGNORE_TEXT = [
  String.raw`/\b\d{1,2}:\d{2}(:\d{2})?\s?(am|pm)?\b/gi`,
  String.raw`/\b\d{4}-\d{2}-\d{2}(t[\d:.]+z?)?\b/gi`,
  String.raw`/\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/g`,
  String.raw`/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(st|nd|rd|th)?,?\s+\d{4}\b/gi`,
  String.raw`/\b\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+\d{4}\b/gi`,
  String.raw`/\b\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago\b/gi`,
];
