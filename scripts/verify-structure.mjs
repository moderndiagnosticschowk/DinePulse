import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const required = [
  'apps/web/app/login/page.tsx',
  'apps/web/app/onboarding/page.tsx',
  'apps/web/app/dashboard/page.tsx',
  'apps/web/lib/supabase.ts',
  'apps/api/src/server.ts',
  'apps/api/src/middleware/auth.ts',
  'supabase/migrations/0001_phase2_auth.sql',
];
const missing = required.filter(p => !existsSync(join(root, p)));
if (missing.length) { console.error('Missing:', missing.join(', ')); process.exit(1); }
console.log(`Structure check passed: ${required.length} required files found.`);
