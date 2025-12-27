// Force NODE_ENV to development for Next.js dev server
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  swcMinify: true,
  // Ensure proper React JSX runtime resolution
  compiler: {
    reactRemoveProperties: false,
  },
  // Force webpack to resolve React correctly and set NODE_ENV
  webpack: (config, { isServer, webpack }) => {
    // Force NODE_ENV to development for webpack
    config.plugins.push(
      new webpack.DefinePlugin({
        'process.env.NODE_ENV': JSON.stringify('development'),
      })
    );
    
    // Force webpack to use development mode
    config.mode = 'development';
    
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
