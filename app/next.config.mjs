import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // Set NEXT_DIST_DIR=.next-test to run a second dev server without touching the main one's build folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    // This app lives in a pnpm workspace: its dependencies (next, react…) are installed at the repo root, outside app/.
    // Tracing from the root lets the server bundle (Netlify's function) include them.
    outputFileTracingRoot: path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
  },
};
