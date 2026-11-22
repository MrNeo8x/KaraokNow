import type { NextConfig } from 'next';
const backend = process.env.BACKEND_API_ORIGIN || 'http://localhost:3000';
const config: NextConfig = { async rewrites() { return [{ source: '/v1/:path*', destination: `${backend}/v1/:path*` }]; } };
export default config;
