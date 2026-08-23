import { setupDevPlatform } from "@cloudflare/next-on-pages/next-dev";

// 本地开发时（next dev）初始化 Cloudflare 绑定/平台，
// 让 API 路由在本地也能按 edge 环境运行；生产构建不受影响。
if (process.env.NODE_ENV === "development") {
  await setupDevPlatform();
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      allowedOrigins: ["*"],
    },
  },
};

export default nextConfig;
