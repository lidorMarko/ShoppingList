// Real PostgreSQL: emulates Supabase's Data API roles and default grants on new public tables,
// then proves the lockdown migration denies them while the owner (application) role still works.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {freshDatabase,resetFixture,A}=require('./postgres-fixture.cjs');
const {EdenDataApiLockdown1794096002000}=require('../src/database/migrations/1794096002000-eden-data-api-lockdown');
const {ShoppingOperations1794096001000}=require('../src/database/migrations/1794096001000-shopping-operations');
let db;
const TABLES=['integration_credentials','shopping_operations','hidden_products'];
const forge=()=>db.query(`INSERT INTO integration_credentials(id,"userId","tokenHash",scopes,"expiresAt") VALUES($1,$2,$3,ARRAY['shopping:read','shopping:write'],now()+interval '1 day')`,[randomUUID(),A,'f'.repeat(64)]);
async function as(role,fn){await db.query(`SET ROLE ${role}`);try{return await fn();}finally{await db.query('RESET ROLE');}}
before(async()=>{
 db=await freshDatabase();
 for(const role of ['anon','authenticated'])await db.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`);
});
after(async()=>{if(db?.isInitialized)await db.destroy();});
async function migrate(...migrations){const runner=db.createQueryRunner();try{for(const m of migrations)await m.up(runner);}finally{await runner.release();}}
// Fixture applies Phase A; then Phase B, then the effective Supabase default: Data API roles hold
// privileges on every public table (Supabase grants new public tables to anon/authenticated).
async function supabaseLikeFixture(){
 await resetFixture(db,false);
 await migrate(new ShoppingOperations1794096001000());
 await db.query('GRANT USAGE ON SCHEMA public TO anon, authenticated');
 await db.query('GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated');
}
test('without the lockdown, the public Data API role could forge an Eden credential (regression evidence)',async()=>{
 await supabaseLikeFixture();
 await as('anon',()=>forge());
 assert.equal((await db.query('SELECT count(*)::int AS n FROM integration_credentials'))[0].n,1);
});
test('after all migrations, anon/authenticated cannot read or write integration tables; the owner still can',async()=>{
 await supabaseLikeFixture();
 await migrate(new EdenDataApiLockdown1794096002000());
 const rls=await db.query(`SELECT relname,relrowsecurity FROM pg_class WHERE relname = ANY($1::text[]) ORDER BY relname`,[TABLES]);
 assert.deepEqual(rls.map(r=>[r.relname,r.relrowsecurity]),TABLES.slice().sort().map(t=>[t,true]));
 for(const role of ['anon','authenticated'])for(const table of TABLES){
  await assert.rejects(as(role,()=>db.query(`SELECT * FROM ${table}`)),e=>e.code==='42501',`${role} must not read ${table}`);
 }
 await assert.rejects(as('anon',()=>forge()),e=>e.code==='42501');
 await assert.rejects(as('authenticated',()=>db.query('UPDATE integration_credentials SET "revokedAt"=NULL')),e=>e.code==='42501');
 await forge();
 assert.equal((await db.query('SELECT count(*)::int AS n FROM integration_credentials'))[0].n,1,'application (owner) role is unaffected');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM hidden_products'))[0].n,1);
});
test('TypeORM bookkeeping table is locked down when the runner created it',async()=>{
 await supabaseLikeFixture();
 await db.query('CREATE TABLE IF NOT EXISTS migrations (id serial PRIMARY KEY, "timestamp" bigint NOT NULL, name varchar NOT NULL)');
 await db.query('GRANT ALL ON migrations TO anon, authenticated');
 await migrate(new EdenDataApiLockdown1794096002000());
 await assert.rejects(as('anon',()=>db.query(`DELETE FROM migrations`)),e=>e.code==='42501');
 await db.query('DROP TABLE migrations');
});
test('lockdown is idempotent and refuses to run before the integration migrations',async()=>{
 await resetFixture(db,false);
 await db.query('DROP TABLE IF EXISTS shopping_operations');
 await assert.rejects(migrate(new EdenDataApiLockdown1794096002000()),/Phase A and B migrations are required/);
 await supabaseLikeFixture();
 await migrate(new EdenDataApiLockdown1794096002000(),new EdenDataApiLockdown1794096002000());
 await assert.rejects(as('anon',()=>db.query('SELECT * FROM integration_credentials')),e=>e.code==='42501');
});
