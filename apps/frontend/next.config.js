/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output for Docker: copies only the minimal files needed at runtime
  output: 'standalone',
  // Skip TS and ESLint checks during build — errors are caught in CI/local dev
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // All API calls proxy to backend — configure in .env.local / container env
  // NEXT_PUBLIC_API_URL=http://localhost:3001
};

module.exports = nextConfig;
