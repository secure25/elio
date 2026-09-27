/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root — a stray lockfile in the home directory otherwise
  // makes Next infer C:\Users\<you> as the root.
  outputFileTracingRoot: import.meta.dirname,
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
