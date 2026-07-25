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
