// Real Supabase Postgres (the supabase/postgres image: real anon/authenticated/service_role/
// authenticator/supabase_admin roles and Supabase's default privileges), connected as the
// non-superuser BYPASSRLS `postgres` role exactly like production. Proves the existing-table
// lockdown, its failure paths (bookkeeping table never left exposed), lock timeout, search_path
// robustness, and the separate future-object default-privilege hardening.
// Opt-in: SHOPPINGLIST_SUPABASE_TEST_DATABASE_URL must point at a DISPOSABLE loopback
// supabase/postgres container whose public schema is empty; anything else is refused.
require('reflect-metadata');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {DataSource,MigrationExecutor}=require('typeorm');
const L=require('../src/database/migrations/1794095990000-existing-tables-data-api-lockdown');
const {EdenSecurity1794096000000}=require('../src/database/migrations/1794096000000-eden-security');
const {ShoppingOperations1794096001000}=require('../src/database/migrations/1794096001000-shopping-operations');
const {EdenDataApiLockdown1794096002000}=require('../src/database/migrations/1794096002000-eden-data-api-lockdown');
const {runDataApiLockdown}=require('../src/database/run-data-api-lockdown');

const URL_=process.env.SHOPPINGLIST_SUPABASE_TEST_DATABASE_URL;
const PROTECTED=[...L.EXISTING_APP_TABLES,'migrations'];
const ROLES=['anon','authenticated'];
const HARDENING=readFileSync(join(__dirname,'../sql/public-default-privileges-hardening.sql'),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;

const source=(migrations=[L.ExistingTablesDataApiLockdown1794095990000],extra)=>new DataSource({type:'postgres',url:URL_,ssl:false,entities:[],migrations,migrationsTransactionMode:'all',synchronize:false,logging:false,...(extra?{extra}:{})});
async function withSource(fn,migrations,extra){const ds=source(migrations,extra);await ds.initialize();try{return await fn(ds);}finally{await ds.destroy();}}
const lockdown=(opts)=>withSource(ds=>runDataApiLockdown(ds,opts));
const one=async(sql,params)=>(await db.query(sql,params))[0];
const exists=async name=>(await one('SELECT to_regclass($1) IS NOT NULL AS e',[name])).e;
const rls=async()=>Object.fromEntries((await db.query(`SELECT relname,relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($1)`,[L.EXISTING_APP_TABLES])).map(r=>[r.relname,r.relrowsecurity]));
const leaks=async(tables=PROTECTED)=>{const q=db.createQueryRunner();try{return await L.findDataApiLeaks(q,await L.presentTables(q,tables));}finally{await q.release();}};

// Runs one statement as `role` in a rolled-back transaction: 'denied' (42501) or 'allowed'
// (the privilege check passed; the statement may still hit a constraint afterwards).
async function attempt(role,sql){
 const q=db.createQueryRunner();await q.connect();
 try{await q.query('BEGIN');await q.query(`SET LOCAL ROLE ${role}`);await q.query(sql);return 'allowed';}
 catch(e){if(e.code==='42P01'||e.code==='42601')throw e;return e.code==='42501'?'denied':'allowed';}
 finally{await q.query('ROLLBACK').catch(()=>{});await q.release();}
}
const ops=t=>[`SELECT * FROM public.${t} LIMIT 1`,`INSERT INTO public.${t} DEFAULT VALUES`,`UPDATE public.${t} SET id=id WHERE true`,`DELETE FROM public.${t} WHERE true`,`TRUNCATE public.${t} CASCADE`,`LOCK TABLE public.${t} IN ACCESS EXCLUSIVE MODE`];
async function probe(tables=L.EXISTING_APP_TABLES){
 const out={denied:0,allowed:[]};
 for(const r of ROLES)for(const t of tables)for(const sql of ops(t)){if(await attempt(r,sql)==='denied')out.denied++;else out.allowed.push(`${r}: ${sql}`);}
 return out;
}

// ACLs, RLS and default privileges of everything outside public (Auth, Storage, Realtime, ...).
const outsidePublic=async()=>(await one(`SELECT md5(string_agg(x,'|' ORDER BY x)) AS fp FROM (
  SELECT 'rel:'||n.nspname||'.'||c.relname||':'||coalesce(c.relacl::text,'-')||':'||c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname NOT IN ('public','pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp%'
  UNION ALL SELECT 'fn:'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||coalesce(p.proacl::text,'-') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname NOT IN ('public','pg_catalog','information_schema')
  UNION ALL SELECT 'ns:'||nspname||':'||coalesce(nspacl::text,'-') FROM pg_namespace
  UNION ALL SELECT 'dacl:'||defaclnamespace||':'||defaclrole::regrole::text||':'||defaclobjtype::text||':'||defaclacl::text FROM pg_default_acl WHERE defaclnamespace<>'public'::regnamespace
 ) s(x)`)).fp;

async function reset(){
 await db.query('DROP SCHEMA IF EXISTS shadow CASCADE');
 for(const t of [...PROTECTED,'integration_credentials','shopping_operations','typeorm_metadata','future_t','future_pre'])await db.query(`DROP TABLE IF EXISTS public.${t} CASCADE`);
 await db.query('DROP VIEW IF EXISTS public.future_v; DROP SEQUENCE IF EXISTS public.future_seq; DROP FUNCTION IF EXISTS public.future_fn(); DROP FUNCTION IF EXISTS public.future_reader()');
 await db.query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sl_test_leaky') THEN DROP ROLE sl_test_leaky; END IF; END $$`);
 // Supabase image defaults (worst case; production's postgres defaults are a subset).
 for(const kind of ['TABLES','SEQUENCES','FUNCTIONS'])await db.query(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON ${kind} TO anon, authenticated, service_role`);
}
// Production shape: the nine tables created by postgres (so Supabase's defaults expose them),
// populated, with explicit Data API grants and RLS off.
async function exposedInstallation(){
 await reset();
 await db.query(readFileSync(join(__dirname,'fixtures/legacy-schema.sql'),'utf8'));
 await db.query('INSERT INTO public.families(id,name,"inviteCode") VALUES($1,$2,$3)',[id(100),'Household 1','invite-100']);
 await db.query('INSERT INTO public.profiles(id,email,"familyId") VALUES($1,$2,$3)',[id(1),'owner@example.test',id(100)]);
 await db.query('INSERT INTO public.categories(id,name) VALUES($1,$2)',[id(60),'כללי']);
 await db.query('INSERT INTO public.products(id,name,"userId","categoryId") VALUES($1,$2,$3,$4)',[id(20),'חלב',id(1),id(60)]);
 await db.query('INSERT INTO public.shopping_lists(id,name,"userId") VALUES($1,$2,$3)',[id(10),'סופר',id(1)]);
 await db.query('INSERT INTO public.list_items(id,"shoppingListId","productId",quantity) VALUES($1,$2,$3,1)',[id(40),id(10),id(20)]);
 await db.query('INSERT INTO public.shopping_sessions(id,"shoppingListId") VALUES($1,$2)',[id(30),id(10)]);
 await db.query('INSERT INTO public.session_items(id,"sessionId","productId") VALUES($1,$2,$3)',[id(50),id(30),id(20)]);
 await db.query('INSERT INTO public.hidden_products("userId","productId") VALUES($1,$2)',[id(1),id(20)]);
 await db.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated');
}
const counts=async()=>Object.fromEntries(await Promise.all(L.EXISTING_APP_TABLES.map(async t=>[t,(await one(`SELECT count(*)::int AS n FROM public.${t}`)).n])));
async function leakyMembership(){await db.query(`CREATE ROLE sl_test_leaky NOLOGIN; GRANT SELECT ON public.families TO sl_test_leaky; GRANT sl_test_leaky TO anon`);}
// What `typeorm migration:run` does before its transaction: create the bookkeeping table.
const cliCreatesBookkeeping=()=>withSource(async ds=>{await new MigrationExecutor(ds).executePendingMigrations();},[]);

before(async()=>{
 if(!URL_)throw new Error('SHOPPINGLIST_SUPABASE_TEST_DATABASE_URL (a disposable supabase/postgres container) is required');
 const u=new URL(URL_);
 if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.search||u.hash)throw new Error('Only a disposable loopback Supabase test database is allowed');
 db=source([]);await db.initialize();
 const who=await one(`SELECT current_user AS u, r.rolsuper AS s, r.rolbypassrls AS b, (SELECT count(*)::int FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','authenticator','supabase_admin')) AS roles,
   (SELECT count(*)::int FROM pg_class WHERE relnamespace='public'::regnamespace) AS objects FROM pg_roles r WHERE r.rolname=current_user`);
 if(who.u!=='postgres'||who.s||!who.b||who.roles!==5){await db.destroy();throw new Error('Expected the supabase/postgres image, connected as its non-superuser postgres role');}
 if(who.objects){await db.destroy();throw new Error('Refusing: public is not empty (use a fresh disposable container)');}
});
after(async()=>{if(db?.isInitialized){await reset();await db.destroy();}});

test('baseline: Supabase defaults expose all nine tables to anon and authenticated (regression evidence)',async()=>{
 await exposedInstallation();
 const p=await probe();
 assert.equal(p.denied,0,'every operation passes the privilege check before the lockdown');
 assert.equal(p.allowed.length,2*9*6);
});

test('safe runner locks the nine tables, bookkeeping and its sequence; postgres and service_role keep access; nothing else changes',async()=>{
 await exposedInstallation();
 const before=await counts(),fp=await outsidePublic();
 const lines=[];const report=await lockdown({log:l=>lines.push(l)});
 assert.deepEqual(report.recorded,['ExistingTablesDataApiLockdown1794095990000'],'only the lockdown ran; no Eden migration');
 assert.ok(!await exists('public.integration_credentials')&&!await exists('public.shopping_operations'));
 assert.deepEqual(await rls(),Object.fromEntries(L.EXISTING_APP_TABLES.map(t=>[t,true])));
 assert.deepEqual(await leaks(),[]);
 const p=await probe();assert.deepEqual(p.allowed,[]);assert.equal(p.denied,2*9*6);
 for(const r of ROLES){
  for(const sql of ops('migrations'))assert.equal(await attempt(r,sql),'denied',`${r}: ${sql}`);
  for(const sql of [`SELECT nextval('public.migrations_id_seq')`,`SELECT setval('public.migrations_id_seq',1)`,`SELECT last_value FROM public.migrations_id_seq`])assert.equal(await attempt(r,sql),'denied',`${r}: ${sql}`);
 }
 // postgres (non-superuser, BYPASSRLS, owner): every row visible, writes work.
 assert.deepEqual(await counts(),before);
 for(const sql of [`INSERT INTO public.shopping_lists(id,name,"userId") VALUES('${id(12)}','x','${id(1)}')`,`UPDATE public.list_items SET quantity=2 WHERE true`,`DELETE FROM public.hidden_products WHERE true`])assert.equal(await attempt('postgres',sql),'allowed');
 // service_role is intentionally untouched: secret key, BYPASSRLS, used for Storage only.
 assert.equal(await attempt('service_role','SELECT * FROM public.profiles'),'allowed');
 assert.equal((await one(`SELECT has_table_privilege('service_role','public.profiles','SELECT,INSERT,UPDATE,DELETE') AS p`)).p,true);
 // Auth, Storage and every other schema: ACLs, RLS and default privileges unchanged.
 assert.equal(await outsidePublic(),fp);
 assert.equal((await one(`SELECT has_table_privilege('supabase_auth_admin','auth.users','SELECT,INSERT,UPDATE,DELETE') AS p`)).p,true);
 assert.ok(lines.some(l=>/Verified: RLS enabled/.test(l)));
 assert.ok(!lines.join('\n').includes('audit'),'log never prints the password');
});

test('repeat runs are no-ops; the migration body itself is idempotent',async()=>{
 await exposedInstallation();
 await lockdown();
 const fp=await outsidePublic();
 const again=await lockdown();
 assert.deepEqual(again.recorded,['ExistingTablesDataApiLockdown1794095990000']);
 const q=db.createQueryRunner();await q.connect();
 try{await q.startTransaction();await new L.ExistingTablesDataApiLockdown1794095990000().up(q);await q.commitTransaction();}finally{await q.release();}
 assert.equal((await one('SELECT count(*)::int AS n FROM public.migrations')).n,1);
 assert.deepEqual(await leaks(),[]);assert.equal(await outsidePublic(),fp);
});

test('--check is read-only: no bookkeeping table, no RLS, no grant changes',async()=>{
 await exposedInstallation();
 const acl=async()=>(await db.query(`SELECT relname, relacl::text, relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace ORDER BY 1`));
 const before=await acl();
 const lines=[];const report=await lockdown({check:true,log:l=>lines.push(l)});
 assert.deepEqual(await acl(),before);
 assert.equal(await exists('public.migrations'),false);
 assert.deepEqual(report.pending,['ExistingTablesDataApiLockdown1794095990000']);
 assert.ok(report.leaks.length>0&&lines.some(l=>/Check only: no changes/.test(l)));
});

test('failure injection: a failed lockdown leaves no bookkeeping table and changes nothing',async()=>{
 await exposedInstallation();
 await leakyMembership();
 await assert.rejects(lockdown(),/Data API roles still have table access: anon:families/);
 assert.equal(await exists('public.migrations'),false,'TypeORM bookkeeping creation was rolled back with the lockdown');
 assert.ok(Object.values(await rls()).every(v=>v===false),'no table was altered');

 await exposedInstallation();
 await db.query('DROP TABLE public.products CASCADE');
 await assert.rejects(lockdown(),/Required application table products is missing/);
 assert.equal(await exists('public.migrations'),false);
});

test('failure injection: a pre-existing exposed bookkeeping table is protected even though the lockdown fails; history is kept',async()=>{
 await exposedInstallation();
 await cliCreatesBookkeeping();
 await db.query(`INSERT INTO public.migrations("timestamp",name) VALUES(1700000000000,'LegacyHistory1700000000000')`);
 assert.equal(await attempt('anon',`INSERT INTO public.migrations("timestamp",name) VALUES(1,'x')`),'allowed','reproduces the exposure');
 await leakyMembership();
 await assert.rejects(lockdown(),/Data API roles still have table access/);
 assert.deepEqual(await leaks(['migrations']),[],'bookkeeping table and its sequence are locked');
 for(const r of ROLES)assert.equal(await attempt(r,`INSERT INTO public.migrations("timestamp",name) VALUES(1794096002000,'EdenDataApiLockdown1794096002000')`),'denied','a migration row cannot be forged');
 assert.deepEqual((await db.query('SELECT name FROM public.migrations')).map(r=>r.name),['LegacyHistory1700000000000']);
 assert.ok(Object.values(await rls()).every(v=>v===false),'the failed lockdown itself rolled back');
 await db.query('REVOKE sl_test_leaky FROM anon');
 await lockdown();
 assert.deepEqual((await db.query('SELECT name FROM public.migrations ORDER BY id')).map(r=>r.name),['LegacyHistory1700000000000','ExistingTablesDataApiLockdown1794095990000']);
});

test('lock timeout: a conflicting lock makes the lockdown fail within the bound and roll back',async()=>{
 await exposedInstallation();
 const holder=db.createQueryRunner();await holder.connect();
 try{
  await holder.query('BEGIN');await holder.query('LOCK TABLE public.families IN ACCESS SHARE MODE');
  const t0=Date.now();
  await assert.rejects(lockdown(),e=>e.code==='55P03'&&/lock timeout/.test(e.message));
  const waited=Date.now()-t0;
  assert.ok(waited>=4500&&waited<20000,`waited ${waited}ms`);
  assert.equal(await exists('public.migrations'),false);
  assert.ok(Object.values(await rls()).every(v=>v===false));
 }finally{await holder.query('ROLLBACK').catch(()=>{});await holder.release();}
 await lockdown();
 assert.deepEqual(await leaks(),[]);
});

test('unexpected search_path: the runner and the migration refuse; same-named tables elsewhere are never touched',async()=>{
 await exposedInstallation();
 await db.query('CREATE SCHEMA shadow; CREATE TABLE shadow.profiles(id int); GRANT USAGE ON SCHEMA shadow TO anon; GRANT SELECT ON shadow.profiles TO anon');
 const extra={options:'-c search_path=shadow,public'};
 await assert.rejects(withSource(ds=>runDataApiLockdown(ds),undefined,extra),/current schema is "shadow"/);
 await withSource(async ds=>{const q=ds.createQueryRunner();await q.connect();try{await q.startTransaction();
  await assert.rejects(new L.ExistingTablesDataApiLockdown1794095990000().up(q),/current schema is "shadow"/);await q.rollbackTransaction();}finally{await q.release();}},undefined,extra);
 assert.ok(!await exists('public.migrations')&&!await exists('shadow.migrations'));
 assert.ok(Object.values(await rls()).every(v=>v===false));
 await lockdown();
 assert.equal((await one(`SELECT relrowsecurity AS r, has_table_privilege('anon','shadow.profiles','SELECT') AS s FROM pg_class WHERE oid='shadow.profiles'::regclass`)).r,false,'shadow.profiles untouched');
 assert.equal(await attempt('anon','SELECT * FROM shadow.profiles'),'allowed');
 assert.deepEqual(await leaks(),[]);
});

test('default-privilege hardening: new postgres-created tables, views and sequences are not exposed; functions keep the built-in PUBLIC EXECUTE',async()=>{
 await exposedInstallation();
 // Before hardening, Supabase's defaults expose any new table automatically.
 await db.query('CREATE TABLE public.future_pre(id int)');
 assert.equal(await attempt('anon','SELECT * FROM public.future_pre'),'allowed');
 await db.query('DROP TABLE public.future_pre');

 const fp=await outsidePublic();
 await db.query(HARDENING);await db.query(HARDENING);// idempotent
 assert.equal(await outsidePublic(),fp,'no other schema, global default or Supabase-managed ACL changed');
 const dacl=await db.query(`SELECT defaclobjtype AS t, defaclacl::text AS acl FROM pg_default_acl WHERE defaclnamespace='public'::regnamespace AND defaclrole='postgres'::regrole`);
 for(const row of dacl){assert.ok(!/\banon=|\bauthenticated=/.test(row.acl),row.acl);assert.match(row.acl,/service_role=/);}

 await db.query(`CREATE TABLE public.future_t(id serial PRIMARY KEY, note text);
  CREATE SEQUENCE public.future_seq;
  CREATE VIEW public.future_v AS SELECT id FROM public.future_t;
  CREATE FUNCTION public.future_fn() RETURNS int LANGUAGE sql AS 'SELECT 1';
  CREATE FUNCTION public.future_reader() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM public.profiles'`);
 const eff=await one(`SELECT
   has_table_privilege('anon','public.future_t','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR has_table_privilege('authenticated','public.future_t','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS tbl,
   has_table_privilege('anon','public.future_v','SELECT') OR has_table_privilege('authenticated','public.future_v','SELECT') AS view,
   has_sequence_privilege('anon','public.future_t_id_seq','USAGE,SELECT,UPDATE') OR has_sequence_privilege('authenticated','public.future_seq','USAGE,SELECT,UPDATE') OR has_sequence_privilege('anon','public.future_seq','USAGE,SELECT,UPDATE') AS seq,
   has_table_privilege('service_role','public.future_t','SELECT') AS svc,
   has_function_privilege('anon','public.future_fn()','EXECUTE') AS fn_anon`);
 assert.deepEqual(eff,{tbl:false,view:false,seq:false,svc:true,fn_anon:true});
 for(const r of ROLES){
  for(const sql of [...ops('future_t'),'SELECT * FROM public.future_v',`SELECT nextval('public.future_seq')`])assert.equal(await attempt(r,sql),'denied',`${r}: ${sql}`);
 }
 // Built-in PUBLIC EXECUTE cannot be removed per schema: each new function must revoke it.
 await db.query('REVOKE EXECUTE ON FUNCTION public.future_fn() FROM PUBLIC, anon, authenticated');
 assert.equal((await one(`SELECT has_function_privilege('anon','public.future_fn()','EXECUTE') AS p`)).p,false);
 // An invoker function anon can still execute cannot reach the locked tables.
 await lockdown();
 assert.equal(await attempt('anon','SELECT public.future_reader()'),'denied');
 // supabase_admin's defaults are out of postgres's reach (documented; not altered).
 await assert.rejects(db.query('ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM anon'),e=>e.code==='42501');
});

test('with hardening applied, even the plain TypeORM CLI creates the bookkeeping table without Data API grants',async()=>{
 await exposedInstallation();
 await db.query(HARDENING);
 await cliCreatesBookkeeping();
 for(const r of ROLES)assert.equal(await attempt(r,`INSERT INTO public.migrations("timestamp",name) VALUES(1,'x')`),'denied');
 assert.equal(await attempt('anon',`SELECT nextval('public.migrations_id_seq')`),'denied');
});

test('Eden release path: the full migration run after the lockdown applies only the Eden migrations and leaves nothing exposed',async()=>{
 await exposedInstallation();
 await lockdown();
 const executed=await withSource(ds=>ds.runMigrations({transaction:'all'}),[L.ExistingTablesDataApiLockdown1794095990000,EdenSecurity1794096000000,ShoppingOperations1794096001000,EdenDataApiLockdown1794096002000]);
 assert.deepEqual(executed.map(m=>m.name),['EdenSecurity1794096000000','ShoppingOperations1794096001000','EdenDataApiLockdown1794096002000']);
 assert.deepEqual(await leaks([...PROTECTED,'integration_credentials','shopping_operations']),[]);
 const p=await probe(['integration_credentials','shopping_operations']);assert.deepEqual(p.allowed,[]);
});
