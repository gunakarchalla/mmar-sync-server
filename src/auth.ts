import * as jwt from 'jsonwebtoken';
import axios from 'axios';
import type { AccessLevel } from './types';

/**
 * The secret has no fallback on purpose. It used to default to the literal
 * 'secret', so a deployment that forgot to set the variable came up accepting
 * tokens anybody could sign, and did so silently. Refusing to start is the
 * failure that gets noticed.
 */
function require_jwt_secret(): string {
  const secret = process.env['JWT_SECRET'];
  if (!secret) {
    throw new Error(
      'JWT_SECRET is not set. It must be the same secret the API signs with. ' +
        'Generate one with: openssl rand -base64 48'
    );
  }
  return secret;
}

const JWT_SECRET = require_jwt_secret();
const API_URL = process.env['API_URL'] ?? 'http://localhost:8000';

/**
 * The accepted algorithm is pinned to the one the API signs with. Left open, a
 * caller chooses the algorithm their forged token is verified with.
 */
export function verifyToken(token: string): jwt.JwtPayload | string {
  return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
}

export async function fetchAccessLevel(
  token: string,
  sceneInstanceUuid: string
): Promise<AccessLevel | null> {
  const response = await axios.get<{ level: AccessLevel | null }>(
    `${API_URL}/instances/sceneInstances/${encodeURIComponent(sceneInstanceUuid)}/access/me`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return response.data.level;
}
