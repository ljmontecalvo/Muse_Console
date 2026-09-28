import { verifyToken } from './signedToken.js';
export async function consoleIdentity(request, env) {
  const token = (request.headers.get('Authorization') || '').match(/^Bearer (.+)$/i)?.[1];
  const session = await verifyToken(token, 'console-session', env.CONSOLE_SESSION_SECRET);
  return typeof session?.userRecordName === 'string' ? session.userRecordName : null;
}
