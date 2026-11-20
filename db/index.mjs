import { getDatabase } from '@netlify/database';
import { drizzle } from 'drizzle-orm/netlify-db';
import * as schema from './schema.ts';
// The platform supplies the database connection and driver in every environment.
export const db = drizzle({ client: getDatabase(), schema });
