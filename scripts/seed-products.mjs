/**
 * Seeds products from images in scripts/seed-images/
 *
 * Usage:
 *   SEED_EMAIL=you@email.com SEED_PASSWORD=yourpassword node scripts/seed-products.mjs
 *
 * - Filename becomes the product name:  "olive-oil.jpg" → "Olive Oil"
 * - Add a category prefix:  "dairy--whole-milk.jpg" → "Whole Milk" in category "Dairy"
 * - Hebrew filenames work as-is:  "חלב.webp" → product named "חלב"
 * - Products are created as GLOBAL (visible to all families) when logged in as admin
 */

import { readdir, readFile } from 'fs/promises';
import { extname, basename, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = join(__dirname, 'seed-images');
const API = 'http://localhost:3001/api';
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

// ── Auth ──────────────────────────────────────────────────────────────────────

async function getAuthToken() {
  const email = process.env.SEED_EMAIL;
  const password = process.env.SEED_PASSWORD;

  if (!email || !password) {
    console.error('Missing credentials.\nRun with:\n  SEED_EMAIL=you@email.com SEED_PASSWORD=yourpassword node scripts/seed-products.mjs');
    process.exit(1);
  }

  // Parse .env file
  function parseEnv(text) {
    return Object.fromEntries(
      text.split('\n')
        .filter(l => l.includes('=') && !l.startsWith('#') && l.trim())
        .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
    );
  }

  const backendEnv = parseEnv(await readFile(join(__dirname, '../backend/.env'), 'utf8'));
  const frontendEnv = parseEnv(await readFile(join(__dirname, '../frontend/.env.local'), 'utf8'));

  const supabaseUrl = backendEnv['SUPABASE_URL'];
  const anonKey = frontendEnv['VITE_SUPABASE_ANON_KEY'];

  if (!supabaseUrl || !anonKey) {
    console.error('Could not read SUPABASE_URL or VITE_SUPABASE_ANON_KEY from .env files.');
    process.exit(1);
  }

  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': anonKey },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('Login failed:', data.error_description || data.msg || JSON.stringify(data));
    process.exit(1);
  }

  console.log(`Logged in as ${email}\n`);
  return data.access_token;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toTitle(str) {
  if (/[֐-׿]/.test(str)) return str.trim(); // keep Hebrew as-is
  return str.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

function parseName(filename) {
  const base = basename(filename, extname(filename));
  const parts = base.split('--');
  if (parts.length === 2) return { categoryName: toTitle(parts[0]), productName: toTitle(parts[1]) };
  return { categoryName: null, productName: toTitle(base) };
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return JSON.parse(text);
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

async function getOrCreateCategory(name, token, cache) {
  if (cache.has(name)) return cache.get(name);
  const categories = await fetchJSON(`${API}/categories`, { headers: authHeaders(token) });
  const existing = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (existing) { cache.set(name, existing.id); return existing.id; }
  const created = await fetchJSON(`${API}/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ name }),
  });
  cache.set(name, created.id);
  return created.id;
}

async function uploadImage(filePath, filename, token) {
  const ext = extname(filename).toLowerCase();
  const buffer = await readFile(filePath);
  const blob = new Blob([buffer], { type: MIME[ext] || 'image/jpeg' });
  const form = new FormData();
  form.append('file', blob, filename);
  const { url } = await fetchJSON(`${API}/uploads/product-image`, {
    method: 'POST',
    headers: authHeaders(token),
    body: form,
  });
  return url;
}

async function createProduct(name, imageUrl, categoryId, token) {
  return fetchJSON(`${API}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ name, imageUrl, categoryId, isGlobal: true }),
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const token = await getAuthToken();

  const files = (await readdir(IMAGES_DIR)).filter(
    (f) => !f.startsWith('.') && IMAGE_EXTS.has(extname(f).toLowerCase()),
  );

  if (files.length === 0) {
    console.log('No images found in scripts/seed-images/ — drop some images there and re-run.');
    return;
  }

  console.log(`Found ${files.length} image(s). Starting...\n`);
  const categoryCache = new Map();

  for (const filename of files) {
    const { categoryName, productName } = parseName(filename);
    process.stdout.write(`  ${filename}\n    → Uploading image...`);
    try {
      const imageUrl = await uploadImage(join(IMAGES_DIR, filename), filename, token);
      process.stdout.write(' done\n    → Creating product...');
      const categoryId = categoryName
        ? await getOrCreateCategory(categoryName, token, categoryCache)
        : undefined;
      const product = await createProduct(productName, imageUrl, categoryId, token);
      console.log(` done\n    ✓ "${product.name}"${categoryName ? ` in "${categoryName}"` : ''} [global]\n`);
    } catch (err) {
      console.log(`\n    ✗ Failed: ${err.message}\n`);
    }
  }

  console.log('Done!');
}

main().catch(console.error);
