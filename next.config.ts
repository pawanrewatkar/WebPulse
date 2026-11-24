import type { NextConfig } from "next";
import path from "node:path";

const root = path.resolve(import.meta.dirname);

const nextConfig: NextConfig = {
  // Native / heavy Node modules must not be bundled; they are loaded at runtime on the server.
  serverExternalPackages: ["better-sqlite3", "sharp", "playwright", "pdfkit", "exceljs", "pixelmatch", "pngjs"],
  poweredByHeader: false,
  turbopack: { root },
  outputFileTracingRoot: root,
  outputFileTracingExcludes: { "*": ["data/**", "data-test/**", "tests/**"] },
};

export default nextConfig;
