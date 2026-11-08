import { MigrationInterface, QueryRunner } from 'typeorm';

export class ShoppingOperations1794096001000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    if (!await q.hasTable('integration_credentials')) throw new Error('Phase A migration is required');
    if (await q.hasTable('shopping_operations')) {
      const rows = await q.query("SELECT obj_description('shopping_operations'::regclass) AS marker");
      if (rows[0]?.marker !== 'eden-operation-ledger:v1') throw new Error('Unrecognized operation ledger; inspect schema before migrating');
      const table = await q.getTable('shopping_operations');
      const required = ['id','userId','keyHash','operation','requestHash','httpStatus','responseBody','listBindings','createdAt'];
      const uniqueKey = table.indices.some(index => index.isUnique && index.columnNames.slice().sort().join(',') === 'keyHash,userId');
      if (!required.every(name => table.columns.some(column => column.name === name)) || !uniqueKey || table.primaryColumns.map(column => column.name).join(',') !== 'id') throw new Error('Operation ledger schema is incompatible; inspect before migrating');
    } else {
      await q.query(`CREATE TABLE shopping_operations (
        id uuid PRIMARY KEY, "userId" varchar NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        "keyHash" char(64) NOT NULL CHECK ("keyHash" ~ '^[0-9a-f]{64}$'),
        operation varchar NOT NULL CHECK (operation IN ('list.create','list.update','list.delete','list.copy','item.create','item.update','item.toggle','item.delete','item.batch','item.purchase')),
        "requestHash" char(64) NOT NULL CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
        "httpStatus" integer NOT NULL CHECK ("httpStatus" IN (200,201,204)), "responseBody" jsonb,
        "listBindings" jsonb NOT NULL CHECK (jsonb_typeof("listBindings")='array'),
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )`);
      await q.query('CREATE UNIQUE INDEX "UQ_shopping_operations_user_key" ON shopping_operations("userId","keyHash")');
      await q.query('CREATE INDEX "IDX_shopping_operations_user_created" ON shopping_operations("userId","createdAt")');
      await q.query("COMMENT ON TABLE shopping_operations IS 'eden-operation-ledger:v1'");
    }
    await q.query('ALTER TABLE integration_credentials DROP CONSTRAINT integration_credentials_scopes_check');
    await q.query(`ALTER TABLE integration_credentials ADD CONSTRAINT integration_credentials_scopes_check
      CHECK (scopes = ARRAY['shopping:read']::text[] OR scopes = ARRAY['shopping:read','shopping:write']::text[])`);
  }
  async down(q: QueryRunner): Promise<void> {
    // Revoke/downgrade write grants before reverting to the Phase A scope contract.
    await q.query(`UPDATE integration_credentials SET scopes=ARRAY['shopping:read']::text[], "revokedAt"=COALESCE("revokedAt",now()) WHERE 'shopping:write'=ANY(scopes)`);
    await q.query('ALTER TABLE integration_credentials DROP CONSTRAINT integration_credentials_scopes_check');
    await q.query(`ALTER TABLE integration_credentials ADD CONSTRAINT integration_credentials_scopes_check CHECK (scopes = ARRAY['shopping:read']::text[])`);
    // Keep ledger data/indexes: dropping receipts would allow committed writes to repeat after reapplication.
  }
}
