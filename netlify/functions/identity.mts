import { db } from '../../db/index.mjs';
import { createIdentityHandlers } from '../server/identity-handlers.mjs';
export default createIdentityHandlers(db);
