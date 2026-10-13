import type { NextConfig } from "next";
const config: NextConfig = { poweredByHeader: false, reactStrictMode: true, experimental: { cpus: 2 }, images: { unoptimized: true } };
export default config;
