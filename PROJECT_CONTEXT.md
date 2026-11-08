# Shopping List App — Project Context

## Current Status
Phase A security is implemented locally, not deployed or connected. Read [the security and migration runbook](docs/EDEN_INTEGRATION_SECURITY.md) before enabling the integration.

Full-featured family shopping app with authentication, family grouping, receipt OCR (GPT-4o), product image support, and per-user/family data isolation.

---

## Architecture Decisions

### Monorepo Structure
```
ShoppingList/
  backend/          NestJS + TypeORM + PostgreSQL (Supabase)
  frontend/         React + Vite + TanStack Query
  scripts/          Seed script for bulk-importing products with images
  PROJECT_CONTEXT.md
```

### Backend
- **Framework**: NestJS (modular, decorator-based, TypeScript-first)
- **ORM**: TypeORM with `synchronize: false` in all environments; explicit migrations are required.
- **Database**: Supabase-hosted PostgreSQL — connected via `DATABASE_URL` with SSL
- **Auth**: Supabase Auth — token verified per-request via `supabase.auth.getUser(token)` (no shared JWT secret needed)
- **Storage**: Supabase Storage — private receipt/product-image storage; buckets are preconfigured by an operator, never auto-created
- **AI**: OpenAI GPT-4o for receipt analysis (image + PDF support via `pdf-parse`)
- **Validation**: class-validator + class-transformer with global ValidationPipe
- **API prefix**: `/api`

### Database Schema
```
categories       id, name (unique), color, timestamps
products         id, name, unit?, categoryId? → FK categories, imageUrl?, userId? (null = global), timestamps
hidden_products  id, userId, productId (tracks per-family product hide)
shopping_lists   id, name, userId, timestamps
list_items       id, shoppingListId → FK, productId → FK, quantity?, unit?, notes?, isPurchased, timestamps
shopping_sessions  id, shoppingListId → FK, status, receiptUrl?, receiptAnalysis (JSONB), startedAt, completedAt?
session_items    id, sessionId → FK, productId → FK, quantity?, unit?, notes?, isPurchased, price?, timestamps
profiles         id (= Supabase auth user id), email, displayName?, familyId?, familyRole, timestamps
families         id, name, inviteCode (6-char, unique), timestamps
```

### Frontend
- **Routing**: react-router-dom v6 (protected routes — redirects to `/login` if unauthenticated)
- **Auth**: `@supabase/supabase-js` client — session stored automatically, passed as Bearer token on every API call
- **Data fetching**: TanStack Query v5 (cache cleared on sign-in/sign-out to prevent cross-user data leaks)
- **HTTP client**: axios with request interceptor that injects `Authorization: Bearer <token>`
- **Styling**: plain CSS variables + utility classes (no external UI library)

---

## Features

### Authentication & Access Control
- Sign up requires an **invite code** (set via `APP_INVITE_CODE` in `backend/.env`) — prevents public registration
- On sign-up the invite code is validated server-side before the Supabase account is created
- If a logged-in user has no profile yet (e.g. signed up before profile was created), they are redirected to `/invite` to enter the code
- Sign in / sign out via Supabase Auth email + password

### Family System
- Users can create a family (generates a 6-character invite code) or join one via invite code
- Family members share shopping lists, sessions, and products
- Family admin is the creator; others are members
- Leaving a family: if the last member, the family is deleted
- Accessible via the user menu → **Family**

### Data Isolation
- **Lists**: visible only to the creating user + their family members
- **Sessions**: same as lists (filtered by list ownership)
- **Products**:
  - `userId = null` → **global** (visible to everyone, e.g. default catalog + admin-seeded items)
  - `userId = <user>` → visible only to that user + their family
  - "Deleting" a global product hides it for your family (creates a `hidden_products` record) rather than deleting it from the DB

### Products
- Admin user (`ADMIN_EMAIL` in `backend/.env`) sees a **"Global product"** checkbox when creating a product — ticking it makes the product visible to all families
- Catalog seeding is an explicit operator task; application startup never seeds products
- Products track **average purchase price** computed from past session items

### Receipt Analysis
- Upload a photo or PDF receipt on the shopping session page
- GPT-4o extracts: store name, matched items with prices, unmatched items, total
- Matched items are automatically marked as purchased with their price
- Session card shows store name and total; Products page shows average price per product

---

## API Endpoints

All endpoints except `POST /api/auth/validate-invite` require authentication and the shared resource policy. Optional Eden credentials grant read-only shopping access, never account/session/media administration.

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/validate-invite | Validate invite code (no auth required) |
| GET | /api/auth/me?inviteCode= | Get/create profile (creates on first call with valid invite code) |

### Families
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/families | Create a new family |
| POST | /api/families/join | Join family via invite code |
| DELETE | /api/families/leave | Leave current family |

### Categories
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/categories | List all categories |
| POST | /api/categories | Create category |
| PUT | /api/categories/:id | Update category |
| DELETE | /api/categories/:id | Delete category |

### Products
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/products | List products for current user/family (+ global) |
| GET | /api/products/me/is-admin | Returns `{ isAdmin: boolean }` |
| POST | /api/products | Create product (`isGlobal: true` for admin to make global) |
| PUT | /api/products/:id | Update product |
| DELETE | /api/products/:id | Delete own product OR hide global/shared product for family |

### Lists
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/lists | List shopping lists for current user/family |
| POST | /api/lists | Create list |
| PUT | /api/lists/:id | Rename list |
| DELETE | /api/lists/:id | Delete list |
| POST | /api/lists/:id/copy-items | Copy all items from this list to another |
| GET | /api/lists/:listId/items | Get items for a list |
| POST | /api/lists/:listId/items | Add item to list |
| PUT | /api/lists/:listId/items/:itemId | Update item |
| PATCH | /api/lists/:listId/items/:itemId/toggle | Toggle purchased |
| DELETE | /api/lists/:listId/items/:itemId | Remove item from list |

### Sessions
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/sessions | List sessions for current user/family |
| POST | /api/sessions | Start a session from a list |
| PATCH | /api/sessions/:id/complete | Mark session complete |
| DELETE | /api/sessions/:id | Delete session |
| POST | /api/sessions/:id/receipt | Upload receipt (image or PDF) |
| POST | /api/sessions/:id/analyze-receipt | Run GPT-4o receipt analysis |
| POST | /api/sessions/:id/items | Add item to session |
| PATCH | /api/sessions/:id/items/:itemId | Update session item |
| PATCH | /api/sessions/:id/items/:itemId/toggle | Toggle item purchased |
| DELETE | /api/sessions/:id/items/:itemId | Remove item from session |

---

## Setup & Running

### Prerequisites
- Node.js 20+
- A Supabase project (free tier): https://supabase.com
- An OpenAI API key (for receipt analysis)

### 1. Install dependencies
```bash
# From repo root
npm install
```

### 2. Configure backend environment
Create `backend/.env`:
```env
DATABASE_URL=postgresql://...          # Supabase → Settings → Database → Connection string (port 5432)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_PUBLISHABLE_KEY=...           # Required for routine Auth getUser (anon key also supported)
EDEN_INTEGRATION_ENABLED=false
DATABASE_SSL=true                     # Verified TLS; false only for disposable local PostgreSQL
SUPABASE_SERVICE_ROLE_KEY=...          # Supabase → Settings → API → service_role key
PORT=3001
NODE_ENV=development
APP_INVITE_CODE=YOURCODE               # Secret code users must enter to sign up
ADMIN_EMAIL=you@example.com           # Confirmed Auth email required for catalog administration
OPENAI_API_KEY=sk-...
```

### 3. Configure frontend environment
Create `frontend/.env.local`:
```env
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=...             # Supabase → Settings → API → anon/public key
```

### 4. Run backend
```bash
cd backend
npm run dev
# Runs on http://localhost:3001
# Explicit migrations are required; synchronize is disabled
# Catalog seeding is an explicit operator task
```

### 5. Run frontend
```bash
cd frontend
npm run dev
# Runs on http://localhost:5173
# Proxies /api → localhost:3001 automatically
```

### 6. First sign-up
1. Go to `http://localhost:5173` → click **Sign Up**
2. Enter your email, password, and the **invite code** from `APP_INVITE_CODE`
3. If email confirmation is required, check your inbox and click the link, then sign in
4. To skip email confirmation in development: Supabase Dashboard → Authentication → Providers → Email → disable "Enable email confirmations"

---

## Keep-Alive Ping (Render Free Tier)

Render free-tier servers spin down after ~15 minutes of inactivity. A macOS launchd job pings the server every 13 minutes to prevent this.

- **Script**: `~/bin/ping-shoppinglist.sh` — curls the server and logs the HTTP status
- **Scheduler**: `~/Library/LaunchAgents/com.shoppinglist.ping.plist` — runs on login, every 780 seconds
- **Logs**: `~/Library/Logs/shoppinglist-ping.log`

```bash
# Stop pinging
launchctl unload ~/Library/LaunchAgents/com.shoppinglist.ping.plist

# Start pinging
launchctl load ~/Library/LaunchAgents/com.shoppinglist.ping.plist

# Check status (second column = last exit code, 0 = OK)
launchctl list | grep shoppinglist

# View logs
cat ~/Library/Logs/shoppinglist-ping.log
```

---

## Seeding Products with Images

Drop product images into `scripts/seed-images/` then run:

```bash
SEED_EMAIL=you@example.com SEED_PASSWORD=yourpassword node scripts/seed-products.mjs
```

**Requirements:**
- Backend must be running (`npm run dev` in `/backend`)
- The email must belong to the `ADMIN_EMAIL` account (so products are created as global)

**Filename conventions:**
```
# Product name from filename (English)
olive-oil.webp          → product "Olive Oil"

# Product name from filename (Hebrew — kept as-is)
שמן זית.webp            → product "שמן זית"

# With category prefix (separated by --)
dairy--whole-milk.jpg   → product "Whole Milk" in category "Dairy"
```

Products created by this script are **global** (`userId = null`) — visible to all families.

---

## Completed Work
- [x] Monorepo with separate backend/frontend packages
- [x] Supabase PostgreSQL integration
- [x] Full CRUD: categories, products, shopping lists, list items
- [x] Shopping sessions (start from a list, track purchases)
- [x] Receipt upload (image + PDF) with GPT-4o analysis
- [x] Auto-mark purchased items + price from receipt
- [x] Store name + total displayed on session cards
- [x] Product average price from purchase history
- [x] Product image upload (Supabase Storage)
- [x] Authentication via Supabase Auth (email + password)
- [x] Invite-code gating — only invited users can sign up
- [x] Per-user/family data isolation (lists, sessions, products)
- [x] Family system (create, join via invite code, leave)
- [x] Global product catalog (admin-only, visible to all)
- [x] Hide global products per-family instead of deleting
- [ ] Default catalog initialization requires an explicit operator task
- [x] Seed script for bulk product import with images

## Outstanding Work
- [ ] Real-time sync between family members (WebSocket or Supabase Realtime)
- [ ] Push notifications for list changes
- [x] Validate explicit security migrations against fresh disposable PostgreSQL 17.6; synchronize is disabled
- [ ] Apply migrations only after deployment prerequisites and explicit approval
- [x] Phase A validation: 30 security tests, 10 real PostgreSQL tests and 2 browser media tests passed
- [x] Deploy backend to Render, frontend to Vercel
- [x] Keep-alive ping via macOS launchd (every 13 min) to prevent Render free-tier spin-down
