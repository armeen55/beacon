import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `.data` is local/dev state and is deliberately gitignored. Hosted runtime
  // truth comes from Supabase; tracing local tenant files or backup archives
  // into every server function both bloats artifacts and risks packaging data
  // that must never leave the workstation.
  outputFileTracingExcludes: {
    "/**": [
      ".data/**",
      ".claude/**",
      ".codex/**",
      "docs/**",
      "migrations/**",
      "scripts/**",
      "src/**",
      "supabase/**",
      "tests/**",
      "tmp/**",
      "*.md",
      "*.ts",
      "*.mjs",
      "components.json",
      "package-lock.json",
      "tsconfig*.json",
      "vercel.json",
    ],
  },
};

export default nextConfig;
