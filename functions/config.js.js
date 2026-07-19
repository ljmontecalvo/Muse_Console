// Cloudflare Pages Function — serves /config.js dynamically at request time
// instead of shipping the CloudKit API token as a static file in the repo.
//
// Set these in the Cloudflare Pages dashboard: Project -> Settings ->
// Environment variables -> Production (and Preview, if you want previews to
// also hit CloudKit rather than fall back to mock data):
//   CLOUDKIT_API_TOKEN   (required, mark it "Encrypt")
//   CLOUDKIT_ENVIRONMENT (optional, defaults to 'development')
//   TAG_REQUEST_EMAIL    (optional, defaults to tech@muse-apps.com)
//
// Local dev is unaffected — this file only runs on Cloudflare's servers.
// Keep using your local, gitignored config.js (see config.example.js) to
// develop and test against CloudKit from your machine.

export async function onRequestGet({ env }) {
  const config = {
    containerIdentifier: 'iCloud.com.MuseApplications.Muse',
    apiToken: env.CLOUDKIT_API_TOKEN || '',
    environment: env.CLOUDKIT_ENVIRONMENT || 'development',
  };
  const tagRequestEmail = env.TAG_REQUEST_EMAIL || 'tech@muse-apps.com';

  const body = `const CLOUDKIT_CONFIG = ${JSON.stringify(config)};\n` +
    `const TAG_REQUEST_EMAIL = ${JSON.stringify(tagRequestEmail)};\n`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
