/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // Set NEXT_DIST_DIR=.next-test to run a second dev server without touching the main one's build folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};
