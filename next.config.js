/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Required for server-only packages used in API routes
  serverExternalPackages: ['@react-pdf/renderer'],
  // Include DOCX contract templates in the server bundle (for API routes)
  outputFileTracingIncludes: {
    '/api/signwell/send': ['./public/contract-templates/**'],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'wqzicwrmmwhnafaihhqh.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
}

module.exports = nextConfig
