import { fileURLToPath } from 'node:url';
import { validateShareableTree } from '../lib/shareability.mjs';
try {
  if (process.argv.slice(2).some(argument => argument !== '--list') || process.argv.length > 3) throw new Error('Usage: node scripts/validate-shareable.mjs [--list]');
  const result = await validateShareableTree(fileURLToPath(new URL('..', import.meta.url)));
  if (process.argv.includes('--list')) console.log(JSON.stringify(result.files, null, 2));
  else console.log(`Shareability PASS: ${result.files.length} allowlisted files. Exclude ${result.excluded.join(', ')} from publication.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
