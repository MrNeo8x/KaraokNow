// Fails when src/lib/api-types.gen.ts is out of date with docs/02-architecture/openapi.json (FE-011).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const committed = path.join(root, 'src/lib/api-types.gen.ts');
const fresh = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kn-types-')), 'api-types.gen.ts');
execFileSync(path.join(root, 'node_modules/.bin/openapi-typescript'), [path.join(root, '../docs/02-architecture/openapi.json'), '-o', fresh], { stdio: 'ignore' });
if (!fs.existsSync(committed) || fs.readFileSync(committed, 'utf8') !== fs.readFileSync(fresh, 'utf8')) {
  console.error('src/lib/api-types.gen.ts lệch với docs/02-architecture/openapi.json. Chạy `npm run types:generate` rồi sửa lỗi TypeScript (nếu có) trước khi commit.');
  process.exit(1);
}
console.log('api-types.gen.ts khớp openapi.json.');
