/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@jarvis/agent", "@jarvis/integrations", "@jarvis/types"],
  serverExternalPackages: ["@anthropic-ai/sdk", "stripe", "googleapis"],
};

export default nextConfig;
