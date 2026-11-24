import { chromium, type Browser, type BrowserContext } from "playwright";
import { isSafeUrl } from "../security/url";
import type { Device } from "../types";
import { DEVICE_PROFILES } from "../devices";

export { DEVICE_PROFILES };

export async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage", "--hide-scrollbars", "--mute-audio"] });
  } catch (e) {
    const msg = (e as Error).message;
    if (/Executable doesn't exist|browserType.launch/i.test(msg)) {
      throw new Error("Playwright Chromium is not installed. Run: npx playwright install chromium");
    }
    throw e;
  }
}

/**
 * Creates an isolated browser context for a device. Every request (documents and sub-resources)
 * is checked against the SSRF policy; blocked requests are aborted.
 */
export async function createDeviceContext(browser: Browser, device: Device): Promise<BrowserContext> {
  const p = DEVICE_PROFILES[device];
  const context = await browser.newContext({
    viewport: p.viewport,
    isMobile: p.isMobile,
    hasTouch: p.hasTouch,
    userAgent: p.userAgent,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    locale: "en-US",
    timezoneId: "UTC",
    serviceWorkers: "block",
    acceptDownloads: false,
  });
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (!/^https?:/i.test(url)) return route.continue();
    if (await isSafeUrl(url)) return route.continue();
    return route.abort("blockedbyclient");
  });
  return context;
}
