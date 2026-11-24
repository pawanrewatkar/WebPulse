import type { Device } from "./types";

/** Device emulation profiles (kept free of Playwright imports so the web app can use them). */
export const DEVICE_PROFILES: Record<Device, { viewport: { width: number; height: number }; isMobile: boolean; hasTouch: boolean; userAgent?: string; label: string }> = {
  desktop: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, label: "Desktop 1440×900" },
  mobile: {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    label: "Mobile 390×844",
  },
};
