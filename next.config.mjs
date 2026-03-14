/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',
      allowedOrigins: [
        'finanse.miasoftware.pl',
        '192.168.50.66:3000',
      ],
    },
  },
};

export default nextConfig;
