import { readFile } from 'node:fs/promises';
import { publishSnapshot } from '../lib/snapshot.mjs';

try {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/write-codex-snapshot.mjs INPUT.json');
  const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const result = await publishSnapshot({ home: process.env.FOCUS_SHELF_HOME, input });
  console.log(result.status);
} catch (error) {
  console.error(error.code === 'ENOENT' ? 'Required local input or configuration is missing' : error.message);
  process.exitCode = 1;
}
