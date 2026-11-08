# Shopping List

Phase A security changes and required migration/private-storage setup: [Eden integration security](docs/EDEN_INTEGRATION_SECURITY.md). Integration remains disabled by default.

A family shopping app with authentication, shared lists, shopping sessions, and AI-powered receipt analysis.

## Features

- **Family system** — create or join a family; members share lists, sessions, and products
- **Shopping lists** — full CRUD, copy items between lists, toggle items purchased
- **Shopping sessions** — start a live session from any list, track what's in the cart
- **Receipt analysis** — upload a photo or PDF receipt; GPT-4o extracts items and prices, auto-marks purchases
- **Product catalog** — global catalog (admin-seeded) plus per-family products with image support and average price tracking
- **Invite-code gating** — only users with the invite code can sign up

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | NestJS · TypeORM · PostgreSQL (Supabase) |
| Frontend | React · Vite · TanStack Query · react-router-dom v6 |
| Auth | Supabase Auth (email + password) |
| Storage | Supabase Storage (product images, receipts) |
| AI | OpenAI GPT-4o (receipt OCR) |

## Project Structure

```
ShoppingList/
  backend/      NestJS API (port 3001)
  frontend/     React app (port 5173)
  docker/       docker-compose for local Postgres (optional)
  scripts/      Seed script for bulk product import with images
```

## Setup

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project (free tier works)
- An OpenAI API key (for receipt analysis)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure the backend

Create `backend/.env` (see `backend/.env.example`):

```env
DATABASE_URL=postgresql://...           # Supabase → Settings → Database → Connection string (port 5432)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_PUBLISHABLE_KEY=...           # Required for routine Auth getUser (anon key also supported)
EDEN_INTEGRATION_ENABLED=false
DATABASE_SSL=true                     # Verified TLS; false only for disposable local PostgreSQL
SUPABASE_SERVICE_ROLE_KEY=...           # Supabase → Settings → API → service_role key
PORT=3001
NODE_ENV=development
APP_INVITE_CODE=YOURCODE                # Secret code required to sign up
ADMIN_EMAIL=you@example.com            # Confirmed Auth email required for catalog administration
OPENAI_API_KEY=sk-...
```

### 3. Configure the frontend

Create `frontend/.env.local`:

```env
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=...              # Supabase → Settings → API → anon/public key
```

### 4. Run

Before starting the updated backend, follow the explicit migration and private-storage prerequisites in the security runbook. This security migration extends an existing installation; it does not bootstrap a new application database. Release the updated frontend/backend together. Integration remains disabled until deployment checks are approved.

```bash
# Terminal 1 — backend
cd backend && npm run dev
# Runs on http://localhost:3001
# Tables are managed by explicit migrations; synchronize is disabled

# Terminal 2 — frontend
cd frontend && npm run dev
# Runs on http://localhost:5173
# /api requests are proxied to localhost:3001
```

Or run both at once from the repo root:

```bash
npm run dev
```

### 5. First sign-up

1. Go to `http://localhost:5173` → **Sign Up**
2. Enter your email, password, and the `APP_INVITE_CODE` value
3. To skip email confirmation in dev: Supabase Dashboard → Authentication → Providers → Email → disable **Enable email confirmations**

## Seeding Products with Images

Drop product images into `scripts/seed-images/` then run:

```bash
SEED_EMAIL=you@example.com SEED_PASSWORD=yourpassword node scripts/seed-products.mjs
```

The backend must be running and the account must match `ADMIN_EMAIL`.

**Filename conventions:**

```
olive-oil.webp          → product "Olive Oil"           (name from filename)
שמן זית.webp            → product "שמן זית"             (Hebrew — kept as-is)
dairy--whole-milk.jpg   → product "Whole Milk"           (category "Dairy" via -- separator)
```

Products created by this script are global — visible to all families.

## API

All endpoints require a Supabase Bearer token except `POST /api/auth/validate-invite`.

Base URL: `http://localhost:3001/api`

| Method | Path | Description |
|--------|------|-------------|
| POST | /auth/validate-invite | Validate invite code |
| GET | /auth/me | Get or create profile |
| POST | /families | Create a family |
| POST | /families/join | Join via invite code |
| DELETE | /families/leave | Leave current family |
| GET | /categories | List categories |
| GET | /products | List products (user + family + global) |
| POST | /products | Create product |
| GET | /lists | List shopping lists |
| POST | /lists | Create list |
| GET | /lists/:id/items | Get list items |
| POST | /lists/:id/items | Add item |
| POST | /lists/:id/copy-items | Copy items to another list |
| GET | /sessions | List sessions |
| POST | /sessions | Start session from list |
| POST | /sessions/:id/receipt | Upload receipt |
| POST | /sessions/:id/analyze-receipt | Run GPT-4o analysis |

Final Phase A local validation and deployment gates: [validation report](docs/PHASE_A_VALIDATION.md).
