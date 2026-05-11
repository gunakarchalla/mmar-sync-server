import * as jwt from 'jsonwebtoken';
import axios from 'axios';
import type { AccessLevel } from './types';

const JWT_SECRET = process.env['JWT_SECRET'] ?? 'secret';
const API_URL = process.env['API_URL'] ?? 'http://localhost:8000';

export function verifyToken(token: string): jwt.JwtPayload | string {
  return jwt.verify(token, JWT_SECRET);
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
