// Shared configuration for the browser/API end-to-end scripts. Defaults match `be/scripts/seed-uat.ts`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:3100').replace(/\/$/, '');
export const API = `${BASE}/v1`;
export const TENANT = process.env.E2E_TENANT_ID ?? '10000000-0000-4000-8000-000000000001';
export const OWNER = { email: process.env.E2E_OWNER_EMAIL ?? 'uat.owner@karaokenow.local', password: process.env.E2E_OWNER_PASSWORD ?? 'Uat-owner-password-2026!' };
export const PLATFORM = { email: process.env.E2E_PLATFORM_EMAIL ?? 'uat.platform@karaokenow.local', password: process.env.E2E_PLATFORM_PASSWORD ?? 'Uat-platform-password-2026!' };
export const ARTIFACTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '.artifacts');
export const SHOTS = path.join(ARTIFACTS, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

/** Launches installed Google Chrome by default; set E2E_BROWSER_CHANNEL (e.g. msedge) or E2E_BROWSER_PATH to override. */
export async function launch() {
  const { chromium } = await import('playwright-core');
  return process.env.E2E_BROWSER_PATH ? chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH }) : chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL ?? 'chrome' });
}

export function reporter() {
  const results = [];
  const log = (ok, name, extra = '') => { results.push({ ok, name }); console.log(ok ? '✔' : '✖', name, extra); };
  const finish = () => { const passed = results.filter(r => r.ok).length; console.log(`\n${passed}/${results.length} pass`); if (passed !== results.length) process.exitCode = 1; };
  return { log, finish };
}

export async function api(method, route, { token, tenant, body, headers = {} } = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (tenant) h['x-tenant-id'] = tenant;
  const response = await fetch(API + route, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: response.status, json };
}

export async function loginToken({ email, password }) {
  const response = await api('POST', '/auth/login', { body: { email, password } });
  if (!response.json?.accessToken) throw new Error(`Login failed for ${email}: ${response.status}`);
  return response.json.accessToken;
}

export const readArtifact = name => JSON.parse(fs.readFileSync(path.join(ARTIFACTS, name), 'utf8'));
export const writeArtifact = (name, value) => fs.writeFileSync(path.join(ARTIFACTS, name), JSON.stringify(value, null, 2));
