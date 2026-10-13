import type { NextConfig } from "next";
const config: NextConfig = { poweredByHeader: false, devIndicators: false, reactStrictMode: true, experimental: { cpus: 2, authInterrupts: true }, images: { unoptimized: true } };
export default config;
