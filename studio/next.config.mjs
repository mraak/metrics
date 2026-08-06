/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    // better-sqlite3 is the local-dev-only driver (see src/lib/db.ts) —
    // listed as external so Next doesn't try to bundle the native binary;
    // it's dynamically imported only when that code path actually runs, so
    // this has no effect on the Postgres-only production build, which
    // doesn't even have the package installed (optionalDependency).
    serverComponentsExternalPackages: ['pg', 'better-sqlite3'],
  },
}

export default nextConfig
