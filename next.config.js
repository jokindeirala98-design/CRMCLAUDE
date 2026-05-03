/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https://wqzicwrmmwhnafaihhqh.supabase.co",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://wqzicwrmmwhnafaihhqh.supabase.co https://api.gocardless.com https://www.signwell.com https://generativelanguage.googleapis.com https://fonts.googleapis.com https://fonts.gstatic.com",
      "frame-src 'self' blob:",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join('; '),
  },
]

const nextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
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
