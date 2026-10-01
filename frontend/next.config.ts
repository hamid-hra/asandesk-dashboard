import type { NextConfig } from "next";

// در داکر nginx مسیرهای /api و /admin را به Django می‌فرستد.
// برای اجرای مستقیم `npm run dev` (بدون nginx) همین مسیرها به BACKEND_URL پراکسی می‌شوند.
const backend = process.env.BACKEND_URL;

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async rewrites() {
    if (!backend) return [];
    return ["/api/:path*", "/admin/:path*", "/static/:path*", "/releases/:path*"].map((source) => ({
      source,
      destination: `${backend}${source}`,
    }));
  },
};

export default nextConfig;
