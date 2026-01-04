/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // Use 'standalone' for Cloud Run, 'export' for Cloudflare Pages
  output: process.env.NEXT_OUTPUT_MODE || 'standalone',
  // Skip ESLint during builds (lint separately in CI)
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Skip TypeScript errors during builds
  typescript: {
    ignoreBuildErrors: true,
  },
  // Disable image optimization (not supported in static export)
  images: {
    unoptimized: true,
  },
  // Trailing slashes for static hosting compatibility
  trailingSlash: process.env.NEXT_OUTPUT_MODE === 'export',
  // Ensure proper React JSX runtime resolution
  compiler: {
    reactRemoveProperties: false,
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
