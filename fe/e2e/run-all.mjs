// Runs setup, API smoke and the three browser suites in order; exits non-zero if any step fails.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const steps = ['setup-uat.mjs', 'api-smoke.mjs', 'customer.mjs', 'staff.mjs', 'platform-role.mjs'];
const failed = [];
for (const step of steps) {
  console.log(`\n===== ${step} =====`);
  const result = spawnSync(process.execPath, [path.join(dir, step)], { stdio: 'inherit' });
  if (result.status !== 0) { failed.push(step); if (step === 'setup-uat.mjs' || step === 'customer.mjs') break; }
}
console.log(failed.length ? `\nThất bại: ${failed.join(', ')}` : '\nTất cả e2e đạt.');
process.exit(failed.length ? 1 : 0);
