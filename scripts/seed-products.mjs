/**
 * Usage:
 *   1. Drop images into scripts/seed-images/
 *   2. Make sure the backend is running (npm run dev in /backend)
 *   3. node scripts/seed-products.mjs
 *
 * Filename → product name:  "olive-oil.jpg" → "Olive Oil"
 * Optional: add a category by using  "category--product-name.jpg"
 *   e.g.  "dairy--whole-milk.jpg" → product "Whole Milk" in category "Dairy"
 */

import { readdir, readFile } from 'fs/promises';
import { extname, basename, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = join(__dirname, 'seed-images');
const API = 'http://localhost:3001/api';
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function toTitle(str) {
  return str.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

function parseName(filename) {
  const base = basename(filename, extname(filename));
  const parts = base.split('--');
  if (parts.length === 2) {
    return { categoryName: toTitle(parts[0]), productName: toTitle(parts[1]) };
  }
  return { categoryName: null, productName: toTitle(base) };
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return JSON.parse(text);
}

async function getOrCreateCategory(name, cache) {
  if (cache.has(name)) return cache.get(name);
  const categories = await fetchJSON(`${API}/categories`);
  const existing = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    cache.set(name, existing.id);
    return existing.id;
  }
  const created = await fetchJSON(`${API}/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  cache.set(name, created.id);
  return created.id;
}

async function uploadImage(filePath, filename) {
  const ext = extname(filename).toLowerCase();
  const buffer = await readFile(filePath);
  const blob = new Blob([buffer], { type: MIME[ext] || 'image/jpeg' });
  const form = new FormData();
  form.append('file', blob, filename);
  const { url } = await fetchJSON(`${API}/uploads/product-image`, { method: 'POST', body: form });
  return url;
}

async function createProduct(name, imageUrl, categoryId) {
  return fetchJSON(`${API}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, imageUrl, categoryId }),
  });
}

async function main() {
  const files = (await readdir(IMAGES_DIR)).filter(
    (f) => IMAGE_EXTS.has(extname(f).toLowerCase()),
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
      const imageUrl = await uploadImage(join(IMAGES_DIR, filename), filename);
      process.stdout.write(' done\n    → Creating product...');
      const categoryId = categoryName
        ? await getOrCreateCategory(categoryName, categoryCache)
        : undefined;
      const product = await createProduct(productName, imageUrl, categoryId);
      console.log(` done\n    ✓ "${product.name}"${categoryName ? ` in "${categoryName}"` : ''}\n`);
    } catch (err) {
      console.log(`\n    ✗ Failed: ${err.message}\n`);
    }
  }

  console.log('Done!');
}

main().catch(console.error);
