// Maintenance: revoke a prepaid key by the masked form shown on /dashboard.
// The dashboard never exposes full key values, so a key is identified here by its
// visible prefix and suffix. Usage, from inside the deployment:
//
//   node revoke-key.mjs si_ef7b 05d4          list the match, change nothing
//   node revoke-key.mjs si_ef7b 05d4 --yes    delete it
//
// Exits non-zero unless exactly one key matches, so a typo cannot wipe several.
import { createClient } from 'redis';

const [prefix, suffix, flag] = process.argv.slice(2);
if (!prefix || !suffix) {
  console.error('usage: node revoke-key.mjs <prefix> <suffix> [--yes]');
  process.exit(2);
}

const client = createClient({ url: process.env.REDIS_URL });
await client.connect();

const ids = await client.sMembers('keys:all');
const matches = ids.filter((k) => k.startsWith(prefix) && k.endsWith(suffix));

if (matches.length !== 1) {
  console.error(`refusing to act: ${matches.length} keys match ${prefix}...${suffix}`);
  await client.quit();
  process.exit(1);
}

const [key] = matches;
const info = await client.hGetAll(`key:${key}`);
console.log('match  :', key);
console.log('status :', info.status ?? '(legacy, treated as active)');
console.log('credits:', info.remaining);
console.log('payer  :', info.payer || '(none)');

if (flag !== '--yes') {
  console.log('\ndry run. re-run with --yes to revoke.');
  await client.quit();
  process.exit(0);
}

await client.multi().del(`key:${key}`).sRem('keys:all', key).exec();
console.log('\nrevoked. credits are no longer spendable.');
await client.quit();
