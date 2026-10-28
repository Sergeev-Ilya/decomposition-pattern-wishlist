#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { chmod, lstat, open, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('../.env', import.meta.url));
const fields = ['AUTH_DB_PASSWORD', 'WISHLIST_DB_PASSWORD', 'JWT_SECRET', 'INTERNAL_TOKEN'];

function validate(text) {
  const values = new Map();
  const duplicates = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || !fields.includes(match[1])) continue;
    const key = match[1];
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (values.has(key)) duplicates.add(key);
    values.set(key, value);
  }
  const invalid = new Set(fields.filter(key => {
    const value = values.get(key);
    // URL-safe values can be interpolated into DATABASE_URL without escaping and
    // remain literal in Compose .env syntax and HTTP headers. Generator uses hex.
    return !value || !/^[A-Za-z0-9_-]{32,}$/.test(value) || /REPLACE|CHANGE|EXAMPLE|PLACEHOLDER/i.test(value) || duplicates.has(key);
  }));
  for (let i = 0; i < fields.length; i++) for (let j = i + 1; j < fields.length; j++) {
    if (values.get(fields[i]) && values.get(fields[i]) === values.get(fields[j])) {
      invalid.add(fields[i]);
      invalid.add(fields[j]);
    }
  }
  if (invalid.size) throw new Error(`Missing or invalid fields: ${[...invalid].sort().join(', ')}`);
}

async function validateExisting() {
  const stat = await lstat(path);
  if (!stat.isFile()) throw new Error('backend/.env must be a regular file');
  validate(await readFile(path, 'utf8'));
  await chmod(path, 0o600);
  console.log('Existing backend/.env validated; values preserved; permissions 0600.');
}

async function main() {
  let file;
  try { file = await open(path, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw new Error('Could not create backend/.env');
    return validateExisting();
  }
  try {
    const lines = fields.map(key => `${key}=${randomBytes(32).toString('hex')}`);
    const contents = '# Local generated credentials. Keep this file and database volumes together.\n' + lines.join('\n') + '\n';
    validate(contents);
    await file.writeFile(contents, 'utf8');
    await file.chmod(0o600);
    await file.sync();
  } finally { await file.close(); }
  console.log('Created backend/.env with independent random credentials and permissions 0600.');
}

main().catch(error => {
  // Never include source lines, filesystem error details or credential values.
  const message = typeof error.message === 'string' && /^(Missing or invalid fields: |backend\/\.env must be a regular file|Could not create backend\/\.env)/.test(error.message)
    ? error.message : 'Could not initialize or validate backend/.env';
  console.error(message);
  process.exitCode = 1;
});
