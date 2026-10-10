import { readFile } from 'node:fs/promises';
import { publishCatalog } from '../lib/snapshot.mjs';

try {
  const args = process.argv.slice(2);
  if (!args.length) throw new Error('Usage: node scripts/write-codex-catalog.mjs INPUT.json [--allow-pr-removal OWNER/REPO#NUMBER]...');
  const inputPath = args.shift();
  const allowPRRemovals = [];
  while (args.length) {
    if (args.shift() !== '--allow-pr-removal' || !args.length) throw new Error('Usage: node scripts/write-codex-catalog.mjs INPUT.json [--allow-pr-removal OWNER/REPO#NUMBER]...');
    allowPRRemovals.push(args.shift());
  }
  const input = JSON.parse(await readFile(inputPath, 'utf8'));
  const result = await publishCatalog({ home: process.env.FOCUS_SHELF_HOME, input, allowPRRemovals });
  console.log(result.status);
} catch (error) {
  console.error(error.code === 'ENOENT' ? 'Required local input or configuration is missing' : error.message);
  process.exitCode = 1;
}
