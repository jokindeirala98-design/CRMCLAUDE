/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Include templates in the server bundle (for API routes on Vercel)
  outputFileTracingIncludes: {
    '/api/signwell/send': ['./public/contract-templates/**'],
    // Economic study Excel templates — accessed by /api/supplies/[id]/economic-study
    '/api/supplies/[id]/economic-study': [
      './templates/**',
      './public/templates/**',
    ],
    // Power study Excel template — accessed by /api/power-study-excel
    '/api/power-study-excel': [
      './public/templates/**',
    ],
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
