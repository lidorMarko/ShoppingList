# Shopping List App — Project Context

## Current Status
MVP Phase 1 complete. Backend API and React frontend fully scaffolded and wired together.
Database switched to Supabase-hosted PostgreSQL (no local Docker required).
Node.js not installed on the development machine — install steps listed below before running.

---

## Architecture Decisions

### Monorepo Structure
```
ShoppingList/
  backend/      NestJS + TypeORM + PostgreSQL
  frontend/     React + Vite + TanStack Query
  docker/       docker-compose kept for reference (not used — Supabase is the DB)
  PROJECT_CONTEXT.md
```

### Backend
- **Framework**: NestJS (modular, decorator-based, TypeScript-first)
- **ORM**: TypeORM with `synchronize: true` in dev (auto-creates tables). Production should use migrations.
- **Database**: Supabase-hosted PostgreSQL — connected via `DATABASE_URL` with SSL (`rejectUnauthorized: false`)
- **Validation**: class-validator + class-transformer with global ValidationPipe
- **CORS**: pre-configured for Vite dev server (port 5173)
- **API prefix**: `/api`

### Database Schema
```
categories  id, name (unique), color, timestamps
products    id, name, unit?, categoryId? → FK categories, timestamps
shopping_lists  id, name, timestamps
list_items  id, shoppingListId → FK, productId → FK, quantity?, unit?, notes?, isPurchased (bool), timestamps
```

### Frontend
- **Routing**: react-router-dom v6
- **Data fetching**: TanStack Query v5 (automatic cache invalidation)
- **HTTP client**: axios (with `/api` proxy through Vite dev server)
- **Styling**: plain CSS variables + utility classes (no external UI library)

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/categories | List all categories |
| POST | /api/categories | Create category |
| PUT | /api/categories/:id | Update category |
| DELETE | /api/categories/:id | Delete category |
| GET | /api/products | List products (optional ?search=) |
| POST | /api/products | Create product |
| PUT | /api/products/:id | Update product |
| DELETE | /api/products/:id | Delete product |
| GET | /api/lists | List all shopping lists (with items) |
| POST | /api/lists | Create shopping list |
| PUT | /api/lists/:id | Rename shopping list |
| DELETE | /api/lists/:id | Delete shopping list |
| POST | /api/lists/:id/copy-items | Copy all items from this list to another |
| GET | /api/lists/:listId/items | Get items for a list |
| POST | /api/lists/:listId/items | Add item to list |
| PUT | /api/lists/:listId/items/:itemId | Update item |
| PATCH | /api/lists/:listId/items/:itemId/toggle | Toggle purchased |
| DELETE | /api/lists/:listId/items/:itemId | Remove item from list |

---

## Completed Work
- [x] Monorepo with separate backend/frontend packages
- [x] Supabase PostgreSQL integration (DATABASE_URL + SSL)
- [x] NestJS app with 4 modules: categories, products, lists, list-items
- [x] TypeORM entities for all 4 tables with correct relationships
- [x] Full CRUD for categories, products, shopping lists, list items
- [x] Copy-items-between-lists endpoint (deduplicates by productId, resets isPurchased)
- [x] Toggle purchased endpoint (PATCH)
- [x] React frontend with react-router-dom v6
- [x] TanStack Query for server state
- [x] Pages: Lists overview, List detail, Products, Categories
- [x] Features: create/rename/delete lists, add/remove/toggle items, copy items modal
- [x] Items grouped by category on the list detail page
- [x] Category color badges on products and items

---

## Outstanding Work
- [ ] Authentication / multi-user support (currently no auth — all users share data)
- [ ] Real-time sync between household members (WebSocket or polling)
- [ ] Phase 2: Receipt upload & OCR integration (mark purchased based on receipt scan)
- [ ] Production migrations (replace TypeORM synchronize with explicit migration files)
- [ ] Unit / integration tests
- [ ] Deploy (e.g. Railway, Render, or self-hosted)

---

## Setup & Running

### Prerequisites
- Node.js 20+ (via nvm — see below)
- A Supabase project (free tier is fine): https://supabase.com

### 0. Install Node.js via nvm (macOS)
```bash
brew install nvm

# Add nvm to shell (one-time)
echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.zshrc
echo '[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && \. "/opt/homebrew/opt/nvm/nvm.sh"' >> ~/.zshrc
source ~/.zshrc

# Install and use LTS
nvm install --lts
nvm use --lts
```

### 1. Get your Supabase connection string
1. Open your Supabase project → **Settings** → **Database**
2. Under **Connection string**, copy the **URI** (direct connection, port 5432)
3. It looks like: `postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres`

### 2. Install dependencies
```bash
# From repo root
cd backend && npm install
cd ../frontend && npm install
```

### 3. Configure environment
```bash
cd backend
cp .env.example .env
# Paste your Supabase DATABASE_URL into .env
```

### 4. Run backend
```bash
cd backend
npm run dev
# Runs on http://localhost:3001
# Tables are auto-created on first start (synchronize: true)
```

### 5. Run frontend
```bash
cd frontend
npm run dev
# Runs on http://localhost:5173
# Proxies /api → localhost:3001 automatically
```
