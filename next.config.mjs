/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 린트는 `npm run lint`(flat config)로 별도 수행 — 빌드 중 Next 의 eslint-config-next 기대를 끔.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
