import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://teamcoder:teamcoder@localhost:5436/teamcoder';

// App query client (pooled). A SEPARATE dedicated client is used for LISTEN in
// P2 — never run LISTEN on a pooled connection.
export const queryClient = postgres(DATABASE_URL);
export const db = drizzle(queryClient, { schema });

export { schema };
