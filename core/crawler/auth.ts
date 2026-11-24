import type { BrowserContext, Page } from "playwright";
import type { AuthSettings } from "../settings";
import type { Credentials } from "../db";
import { matchesAnyPattern, normalizeUrl } from "../security/url";
import { errorMessage, type Logger } from "../logger";

export class LoginError extends Error {}

async function firstVisible(page: Page, selector: string, timeout: number) {
  const loc = page.locator(selector).filter({ visible: true }).first();
  await loc.waitFor({ state: "visible", timeout });
  return loc;
}

/**
 * Performs a form login in the given context. Cookies/session storage stay in the context, so
 * every page subsequently opened in it is authenticated. Never logs the credentials.
 */
export async function performLogin(context: BrowserContext, auth: AuthSettings, creds: Credentials, timeoutMs: number, log: Logger): Promise<void> {
  const page = await context.newPage();
  try {
    const res = await page.goto(auth.loginUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    if (res && res.status() >= 400) throw new LoginError(`Login page returned HTTP ${res.status()}`);
    try {
      await (await firstVisible(page, auth.usernameSelector, 15_000)).fill(creds.username);
      await (await firstVisible(page, auth.passwordSelector, 5_000)).fill(creds.password);
    } catch {
      throw new LoginError(`Login form fields not found (username selector "${auth.usernameSelector}", password selector "${auth.passwordSelector}")`);
    }
    const before = page.url();
    let submit;
    try {
      submit = await firstVisible(page, auth.submitSelector, 5_000);
    } catch {
      throw new LoginError(`Login submit button not found (selector "${auth.submitSelector}")`);
    }
    await Promise.all([page.waitForLoadState("domcontentloaded").catch(() => {}), submit.click()]);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

    const after = page.url();
    if (auth.failureUrlPattern && matchesAnyPattern(after, [auth.failureUrlPattern])) {
      throw new LoginError(`Login failed: still on a login URL (${new URL(after).pathname}) after submitting`);
    }
    if (auth.successSelector) {
      try {
        await page.locator(auth.successSelector).first().waitFor({ state: "attached", timeout: 10_000 });
      } catch {
        throw new LoginError(`Login failed: logged-in indicator "${auth.successSelector}" not found after submitting`);
      }
    } else {
      // Heuristic: if we are on the same URL and a password field is still visible, login most likely failed.
      const pwVisible = await page.locator(auth.passwordSelector).filter({ visible: true }).count().catch(() => 0);
      if (pwVisible > 0 && normalizeUrl(before) === normalizeUrl(after)) {
        throw new LoginError("Login appears to have failed: the password field is still visible after submitting. Check credentials/selectors.");
      }
    }
    log.info("Login succeeded");
  } catch (e) {
    if (e instanceof LoginError) throw e;
    throw new LoginError(`Login failed: ${errorMessage(e)}`);
  } finally {
    await page.close().catch(() => {});
  }
}
