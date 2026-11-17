// Real PostgreSQL: reproduces the production Supabase exposure of the nine existing application
// tables (RLS off, anon/authenticated holding SELECT/INSERT/UPDATE/DELETE), then proves the
// lockdown denies the Data API roles while a NON-superuser, non-BYPASSRLS table owner (like the
// backend's role) keeps full access. A superuser would bypass RLS and hide lock-outs, so every
// application-side check here runs under SET ROLE of an ordinary owner role.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {freshDatabase,id,A,C,L}=require('./postgres-fixture.cjs');
const {ExistingTablesDataApiLockdown1794095990000,EXISTING_APP_TABLES}=require('../src/database/migrations/1794095990000-existing-tables-data-api-lockdown');
let db;
const OWNER='eden_test_app_owner',INTRUDER='eden_test_intruder',LEAKY='eden_test_leaky';
const DATA_API=['anon','authenticated'];
const role=name=>`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${name}') THEN CREATE ROLE ${name} NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$`;
async function as(name,fn){await db.query(`SET ROLE ${name}`);try{return await fn();}finally{await db.query('RESET ROLE');}}
async function lockdown(){const runner=db.createQueryRunner();try{await new ExistingTablesDataApiLockdown1794095990000().up(runner);}finally{await runner.release();}}
const counts=async()=>Object.fromEntries(await Promise.all(EXISTING_APP_TABLES.map(async t=>[t,(await db.query(`SELECT count(*)::int AS n FROM ${t}`))[0].n])));
const rls=async()=>Object.fromEntries((await db.query(`SELECT relname,relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($1::text[])`,[EXISTING_APP_TABLES])).map(r=>[r.relname,r.relrowsecurity]));
// One statement per privilege; each would succeed (or hit a constraint) if the privilege existed.
const attacks=t=>[`SELECT * FROM ${t} LIMIT 1`,`INSERT INTO ${t} DEFAULT VALUES`,`UPDATE ${t} SET id = id`,`DELETE FROM ${t}`,`TRUNCATE ${t} CASCADE`];

before(async()=>{
 db=await freshDatabase();
 for(const name of [...DATA_API,OWNER,INTRUDER,LEAKY])await db.query(role(name));
});
after(async()=>{if(db?.isInitialized)await db.destroy();});

// Pre-integration production shape: the nine tables, owned by an ordinary role, populated, with
// Supabase's effective grants to the Data API roles and RLS off.
async function exposedInstallation(){
 await db.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO ${OWNER}; GRANT USAGE ON SCHEMA public TO anon, authenticated, ${INTRUDER}`);
 // Supabase's default privileges: tables created later (TypeORM bookkeeping, Eden tables) are granted too.
 for(const creator of ['CURRENT_USER',OWNER])await db.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${creator} IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated`);
 await db.query(readFileSync(join(__dirname,'fixtures/legacy-schema.sql'),'utf8'));
 await db.query('INSERT INTO families(id,name,"inviteCode") VALUES($1,$2,$3)',[id(100),'Household 1','invite-100']);
 for(const [user,email] of [[A,'owner@example.test'],[C,'other@example.test']])await db.query('INSERT INTO profiles(id,email,"familyId") VALUES($1,$2,$3)',[user,email,id(100)]);
 await db.query('INSERT INTO categories(id,name) VALUES($1,$2)',[id(60),'כללי']);
 await db.query('INSERT INTO products(id,name,"userId","categoryId") VALUES($1,$2,$3,$4)',[id(20),'חלב',A,id(60)]);
 await db.query('INSERT INTO shopping_lists(id,name,"userId") VALUES($1,$2,$3)',[L,'סופר',A]);
 await db.query('INSERT INTO list_items(id,"shoppingListId","productId",quantity) VALUES($1,$2,$3,1)',[id(40),L,id(20)]);
 await db.query('INSERT INTO shopping_sessions(id,"shoppingListId") VALUES($1,$2)',[id(30),L]);
 await db.query('INSERT INTO session_items(id,"sessionId","productId") VALUES($1,$2,$3)',[id(50),id(30),id(20)]);
 await db.query('INSERT INTO hidden_products("userId","productId") VALUES($1,$2)',[C,id(20)]);
 for(const t of EXISTING_APP_TABLES)await db.query(`ALTER TABLE ${t} OWNER TO ${OWNER}`);
 await db.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated');
 // A non-owner role with ordinary grants: RLS would hide every row from it.
 await db.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${INTRUDER}`);
}

test('without the lockdown, the public Data API roles can read and rewrite all nine tables (regression evidence)',async()=>{
 await exposedInstallation();
 for(const r of DATA_API)for(const t of EXISTING_APP_TABLES)assert.ok((await as(r,()=>db.query(`SELECT * FROM ${t}`))).length>0,`${r} reads ${t}`);
 assert.equal((await as('anon',()=>db.query('SELECT email FROM profiles WHERE id=$1',[C])))[0].email,'other@example.test');
 await as('anon',()=>db.query(`UPDATE families SET name='hijacked'`));
 await as('authenticated',()=>db.query('DELETE FROM list_items'));
 assert.equal((await db.query('SELECT name FROM families'))[0].name,'hijacked');
});

test('after the lockdown, anon and authenticated are denied every operation on all nine tables',async()=>{
 await exposedInstallation();
 const before=await counts();
 await as(OWNER,lockdown);
 assert.deepEqual(await rls(),Object.fromEntries(EXISTING_APP_TABLES.map(t=>[t,true])));
 const grants=await db.query(`SELECT grantee,table_name FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee IN ('anon','authenticated','PUBLIC')`);
 assert.deepEqual(grants,[]);
 for(const r of DATA_API)for(const t of EXISTING_APP_TABLES)for(const sql of attacks(t)){
  await assert.rejects(as(r,()=>db.query(sql)),e=>e.code==='42501',`${r} must be denied: ${sql}`);
 }
 assert.deepEqual(await counts(),before,'no data changed');
});

test('the non-superuser table owner (the backend role) keeps full read/write access under RLS',async()=>{
 await exposedInstallation();
 const before=await counts();
 await as(OWNER,lockdown);
 await as(OWNER,async()=>{
  const seen=await counts();
  assert.deepEqual(seen,before,'RLS without policies must not hide rows from the owner');
  await db.query('INSERT INTO shopping_lists(id,name,"userId") VALUES($1,$2,$3)',[id(12),'חדשה',A]);
  await db.query('INSERT INTO list_items("shoppingListId","productId",quantity) VALUES($1,$2,2)',[id(12),id(20)]);
  await db.query('UPDATE list_items SET "isPurchased"=true WHERE "shoppingListId"=$1',[id(12)]);
  await db.query(`UPDATE profiles SET "displayName"='בעלים' WHERE id=$1`,[A]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM list_items WHERE "isPurchased"'))[0].n,1);
  await db.query('DELETE FROM shopping_lists WHERE id=$1',[id(12)]);
  await db.query('DELETE FROM hidden_products');
 });
});

test('the Eden integration migrations still apply as the owner after the lockdown, in either order',async()=>{
 const {EdenSecurity1794096000000}=require('../src/database/migrations/1794096000000-eden-security');
 const {ShoppingOperations1794096001000}=require('../src/database/migrations/1794096001000-shopping-operations');
 const {EdenDataApiLockdown1794096002000}=require('../src/database/migrations/1794096002000-eden-data-api-lockdown');
 await exposedInstallation();
 await as(OWNER,async()=>{
  await lockdown();
  const runner=db.createQueryRunner();
  try{for(const m of [new EdenSecurity1794096000000(),new ShoppingOperations1794096001000(),new EdenDataApiLockdown1794096002000()])await m.up(runner);}finally{await runner.release();}
  await lockdown();
  assert.equal((await db.query('SELECT count(*)::int AS n FROM hidden_products'))[0].n,1);
 });
 await assert.rejects(as('anon',()=>db.query('SELECT * FROM integration_credentials')),e=>e.code==='42501');
});

test('refuses to run as a role that RLS would lock out, changing nothing',async()=>{
 await exposedInstallation();
 await assert.rejects(as(INTRUDER,lockdown),/backend table owner/);
 await db.query('ALTER TABLE families FORCE ROW LEVEL SECURITY');
 await assert.rejects(as(OWNER,lockdown),/RLS would block it on: families/);
 assert.ok(Object.values(await rls()).every(v=>v===false),'no table was altered');
 assert.ok((await as('anon',()=>db.query('SELECT * FROM profiles'))).length>0,'grants untouched (refusal precedes changes)');
});

test('PUBLIC grants are revoked; access through another role fails the migration and rolls back',async()=>{
 await exposedInstallation();
 await db.query('GRANT SELECT ON profiles TO PUBLIC');
 await as(OWNER,lockdown);
 await assert.rejects(as('anon',()=>db.query('SELECT * FROM profiles')),e=>e.code==='42501');

 await exposedInstallation();
 await db.query(`GRANT SELECT ON families TO ${LEAKY}; GRANT ${LEAKY} TO anon`);
 try{
  const runner=db.createQueryRunner();
  await runner.query(`SET ROLE ${OWNER}`);
  await runner.startTransaction();
  await assert.rejects(new ExistingTablesDataApiLockdown1794095990000().up(runner),/Data API roles still have table access: anon:families/);
  await runner.rollbackTransaction();
  await runner.query('RESET ROLE');
  await runner.release();
  assert.ok(Object.values(await rls()).every(v=>v===false),'the failed migration rolled back');
 }finally{await db.query(`REVOKE ${LEAKY} FROM anon`);}
});

test('stand-alone runner records and locks TypeORM bookkeeping; it is idempotent and down keeps the lockdown',async()=>{
 await exposedInstallation();
 process.env.DATABASE_URL=process.env.SHOPPINGLIST_TEST_DATABASE_URL;process.env.DATABASE_SSL='false';
 const {LockdownDataSource}=require('../src/database/data-source-lockdown');
 const {runDataApiLockdown}=require('../src/database/run-data-api-lockdown');
 await LockdownDataSource.initialize();
 try{
  const first=await runDataApiLockdown(LockdownDataSource);
  assert.deepEqual(first.recorded,['ExistingTablesDataApiLockdown1794095990000']);
  assert.deepEqual((await db.query('SELECT name FROM migrations')).map(r=>r.name),['ExistingTablesDataApiLockdown1794095990000']);
  await assert.rejects(as('anon',()=>db.query('SELECT * FROM migrations')),e=>e.code==='42501');
  await assert.rejects(as('anon',()=>db.query(`SELECT nextval('public.migrations_id_seq')`)),e=>e.code==='42501');
  assert.deepEqual((await runDataApiLockdown(LockdownDataSource)).recorded,['ExistingTablesDataApiLockdown1794095990000'],'already recorded');
  await lockdown(); // as the runner's role, which created `migrations`
  await new ExistingTablesDataApiLockdown1794095990000().down();
  assert.ok(Object.values(await rls()).every(Boolean));
 }finally{await LockdownDataSource.destroy();}
});
