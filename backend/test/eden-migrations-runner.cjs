// Real PostgreSQL: emulates Supabase's Data API roles, their grants on the existing tables and the
// default privileges that grant every new public table/sequence to anon/authenticated. Proves the
// Eden-only runner applies the integration migrations without the postponed existing-tables
// lockdown, never commits an exposed bookkeeping table, and leaves that lockdown runnable later.
require('reflect-metadata');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {randomUUID}=require('node:crypto');
const {DataSource}=require('typeorm');
const {freshDatabase}=require('./postgres-fixture.cjs');
const L=require('../src/database/migrations/1794095990000-existing-tables-data-api-lockdown');
const {EdenSecurity1794096000000}=require('../src/database/migrations/1794096000000-eden-security');
const {ShoppingOperations1794096001000}=require('../src/database/migrations/1794096001000-shopping-operations');
const {EdenDataApiLockdown1794096002000}=require('../src/database/migrations/1794096002000-eden-data-api-lockdown');
const {runEdenMigrations,EDEN_PROTECTED_TABLES}=require('../src/database/run-eden-migrations');
const {runDataApiLockdown}=require('../src/database/run-data-api-lockdown');

const URL_=process.env.SHOPPINGLIST_TEST_DATABASE_URL;
const EDEN=[EdenSecurity1794096000000,ShoppingOperations1794096001000,EdenDataApiLockdown1794096002000];
const UNTOUCHED=L.EXISTING_APP_TABLES.filter(t=>t!=='hidden_products');
let db;
const source=migrations=>new DataSource({type:'postgres',url:URL_,ssl:false,entities:[],migrations,migrationsTransactionMode:'all',synchronize:false,logging:false});
async function withSource(migrations,fn){const ds=source(migrations);await ds.initialize();try{return await fn(ds);}finally{await ds.destroy();}}
const eden=opts=>withSource(EDEN,ds=>runEdenMigrations(ds,opts));
const one=async(sql,params)=>(await db.query(sql,params))[0];
const exists=async name=>(await one('SELECT to_regclass($1) IS NOT NULL AS e',[name])).e;
async function leaks(tables){const q=db.createQueryRunner();try{return await L.findDataApiLeaks(q,await L.presentTables(q,tables));}finally{await q.release();}}
async function denied(role,sql){
 const q=db.createQueryRunner();await q.connect();
 try{await q.query('BEGIN');await q.query(`SET LOCAL ROLE ${role}`);await q.query(sql);return false;}
 catch(e){if(e.code!=='42501')throw e;return true;}
 finally{await q.query('ROLLBACK').catch(()=>undefined);await q.release();}
}

async function supabaseLike(){
 await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS auth CASCADE; CREATE SCHEMA auth');
 await db.query(readFileSync(join(__dirname,'fixtures/legacy-schema.sql'),'utf8'));
 await db.query('GRANT USAGE ON SCHEMA public TO anon, authenticated');
 await db.query('GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated');
 await db.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated');
 await db.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated');
}

before(async()=>{
 db=await freshDatabase();
 for(const role of ['anon','authenticated'])await db.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`);
});
after(async()=>{if(db?.isInitialized)await db.destroy();});

test('check mode is read-only',async()=>{
 await supabaseLike();
 const report=await eden({check:true});
 assert.deepEqual(report.pending,['EdenSecurity1794096000000','ShoppingOperations1794096001000','EdenDataApiLockdown1794096002000']);
 assert.equal(await exists('public.migrations'),false);
 assert.equal(await exists('public.integration_credentials'),false);
});

test('applies only the Eden migrations; bookkeeping, sequence and integration tables are locked; other existing tables are untouched',async()=>{
 await supabaseLike();
 const before_=await leaks(UNTOUCHED);
 const report=await eden();
 assert.deepEqual(report.leaks,[]);
 assert.deepEqual((await db.query('SELECT name FROM migrations ORDER BY id')).map(r=>r.name),['EdenSecurity1794096000000','ShoppingOperations1794096001000','EdenDataApiLockdown1794096002000']);
 assert.deepEqual(await leaks(EDEN_PROTECTED_TABLES),[]);
 for(const role of ['anon','authenticated']){
  assert.ok(await denied(role,'SELECT * FROM integration_credentials'));
  assert.ok(await denied(role,`INSERT INTO migrations("timestamp",name) VALUES (1,'forged')`));
  assert.ok(await denied(role,"SELECT nextval('migrations_id_seq')"));
 }
 assert.deepEqual(await leaks(UNTOUCHED),before_,'pre-existing tables other than hidden_products keep their current RLS/grants');
 const [{id:userId}]=await db.query(`INSERT INTO profiles(id,email) VALUES($1,'owner@example.test') RETURNING id`,[randomUUID()]);
 await db.query(`INSERT INTO integration_credentials(id,"userId","tokenHash",scopes,"expiresAt") VALUES($1,$2,$3,ARRAY['shopping:read','shopping:write'],now()+interval '1 day')`,[randomUUID(),userId,'a'.repeat(64)]);
 assert.equal((await eden()).pending.length,0,'re-running is a no-op');
});

test('a failing migration rolls back everything, including the bookkeeping table',async()=>{
 await supabaseLike();
 await db.query(`CREATE TABLE integration_credentials (id uuid PRIMARY KEY)`);
 await assert.rejects(eden(),/already exists/);
 assert.equal(await exists('public.migrations'),false);
 assert.equal(await exists('public.shopping_operations'),false);
});

test('duplicate hidden products are refused before any change',async()=>{
 await supabaseLike();
 for(let i=0;i<2;i++)await db.query(`INSERT INTO hidden_products("userId","productId") VALUES('u','p')`);
 await assert.rejects(eden(),/duplicate hidden_products/);
 assert.equal(await exists('public.migrations'),false);
});

test('an existing exposed bookkeeping table is locked first, and the postponed lockdown still runs afterwards',async()=>{
 await supabaseLike();
 await db.query('CREATE TABLE migrations (id serial PRIMARY KEY, "timestamp" bigint NOT NULL, name varchar NOT NULL)');
 await eden();
 assert.deepEqual(await leaks(EDEN_PROTECTED_TABLES),[]);
 const report=await withSource([L.ExistingTablesDataApiLockdown1794095990000],ds=>runDataApiLockdown(ds));
 assert.deepEqual(report.leaks,[]);
 assert.ok((await db.query('SELECT name FROM migrations')).some(r=>r.name==='ExistingTablesDataApiLockdown1794095990000'));
});
