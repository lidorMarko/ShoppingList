import { MigrationInterface, QueryRunner } from 'typeorm';

export class EdenSecurity1794096000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // This migration extends an existing installation; it never bootstraps/recreates the app schema.
    for (const table of ['profiles', 'families', 'products', 'shopping_lists', 'list_items', 'shopping_sessions', 'session_items', 'categories']) {
      if (!await q.hasTable(table)) throw new Error('Existing ShoppingList schema required');
    }
    if (!await q.hasTable('hidden_products')) {
      await q.query(`CREATE TABLE hidden_products (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "userId" character varying NOT NULL,
        "productId" character varying NOT NULL, "createdAt" timestamp NOT NULL DEFAULT now()
      )`);
    }
    // Fail on duplicates rather than silently deleting existing data.
    await q.query(`CREATE UNIQUE INDEX "UQ_eden_hidden_user_product" ON hidden_products ("userId", "productId")`);
    await q.query(`CREATE TABLE integration_credentials (
      id uuid PRIMARY KEY, "userId" character varying NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      "tokenHash" character varying NOT NULL CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
      scopes text[] NOT NULL CHECK (scopes = ARRAY['shopping:read']::text[]),
      "expiresAt" timestamptz NOT NULL, "revokedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(), CHECK ("expiresAt" > "createdAt")
    )`);
    await q.query(`CREATE INDEX "IDX_eden_credentials_user" ON integration_credentials ("userId")`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE integration_credentials');
    await q.query('DROP INDEX "UQ_eden_hidden_user_product"');
    // Retain hidden_products, even if created here: rollback must never delete household preferences.
  }
}
