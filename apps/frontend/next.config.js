/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output for Docker: copies only the minimal files needed at runtime
  output: 'standalone',
  typedRoutes: true,
  // All API calls proxy to backend — configure in .env.local / container env
  // NEXT_PUBLIC_API_URL=http://localhost:3001
};

module.exports = nextConfig;
