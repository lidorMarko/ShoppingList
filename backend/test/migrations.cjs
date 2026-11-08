// Real PostgreSQL tests; never reads DATABASE_URL or checkout environment files.
require('reflect-metadata');
const {test,before,beforeEach,after} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {randomUUID,randomBytes} = require('node:crypto');
const {DataSource} = require('typeorm');
const {entities} = require('../src/database/entities');
const {EdenSecurity1794096000000} = require('../src/database/migrations/1794096000000-eden-security');
const {IntegrationCredentialsService} = require('../src/modules/auth/integration-credentials.service');
const {AccessPolicy} = require('../src/modules/auth/access-policy.service');
const {ProductsService} = require('../src/modules/products/products.service');
const {Profile} = require('../src/database/entities/profile.entity');
const {Product} = require('../src/database/entities/product.entity');
const {SessionItem} = require('../src/database/entities/session-item.entity');
const {HiddenProduct} = require('../src/database/entities/hidden-product.entity');
const {IntegrationCredential} = require('../src/database/entities/integration-credential.entity');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const A=id(1),B=id(2),C=id(3),L=id(10),X=id(11),P=id(20),G=id(21),H=id(22),S=id(30),SX=id(31);
const tables=['families','profiles','categories','products','shopping_lists','list_items','shopping_sessions','session_items','hidden_products'];
const config={get:key=>({EDEN_INTEGRATION_ENABLED:'true',ADMIN_EMAIL:'admin@example.test'})[key]};
let db,ready=false;
const consent=extra=>({application:'eden',consent:true,scopes:['shopping:read'],...extra});
const credentials=()=>new IntegrationCredentialsService(db,config);
const apply=()=>db.runMigrations({transaction:'all'});
async function preserveSnapshot() {
 const data={};
 for(const table of tables) data[table]=await db.query(`SELECT * FROM ${table} ORDER BY id`);
 const columns=await db.query(`SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[]) ORDER BY table_name,ordinal_position`,[tables]);
 const indexes=await db.query(`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=ANY($1::text[]) AND indexname != 'UQ_eden_hidden_user_product' ORDER BY indexname`,[tables]);
 return JSON.parse(JSON.stringify({data,columns,indexes}));
}
before(async()=>{
 const value=process.env.SHOPPINGLIST_TEST_DATABASE_URL;
 if(!value)throw new Error('Supply an empty disposable local shoppinglist_eden_test_* database');
 const url=new URL(value);
 if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname) || !/^\/shoppinglist_eden_test_[a-z0-9_]+$/.test(url.pathname) || url.search || url.hash)throw new Error('Only explicitly named disposable local test databases are allowed');
 db=new DataSource({type:'postgres',url:value,ssl:false,logging:false,synchronize:false,migrationsRun:false,entities,migrations:[EdenSecurity1794096000000]});
 await db.initialize();
 const existing=await db.query("SELECT table_schema,table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')");
 assert.equal(existing.length,0,'Refusing to reuse a database containing existing tables');
 ready=true;
 console.log('Fresh disposable PostgreSQL '+(await db.query('SHOW server_version'))[0].server_version+'; synchronize=false');
});
beforeEach(async()=>{
 if(!ready)throw new Error('Disposable database guard did not pass');
 await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS auth CASCADE; CREATE SCHEMA auth');
 await db.query(readFileSync(join(__dirname,'fixtures/legacy-schema.sql'),'utf8'));
 await db.query('CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, encrypted_password text, deleted_at timestamptz, banned_until timestamptz)');
 for(const [n,name] of [[100,'Household 1'],[101,'Household 2']])await db.query('INSERT INTO families(id,name,"inviteCode") VALUES($1,$2,$3)',[id(n),name,'invite-'+n]);
 for(const [user,email,family] of [[A,'owner@example.test',id(100)],[B,'member@example.test',id(100)],[C,'other@example.test',id(101)]]){
  await db.query('INSERT INTO profiles(id,email,"familyId") VALUES($1,$2,$3)',[user,email,family]);
  await db.query('INSERT INTO auth.users(id,email,encrypted_password) VALUES($1,$2,$3)',[user,email,'synthetic-not-a-password']);
 }
 await db.query('INSERT INTO categories(id,name,color) VALUES($1,$2,$3)',[id(60),'מוצרי חלב','#abc123']);
 for(const [product,name,owner] of [[P,'חלב',A],[G,'לחם',null],[H,'מוצר פרטי',C]])await db.query('INSERT INTO products(id,name,"userId","categoryId",unit) VALUES($1,$2,$3,$4,$5)',[product,name,owner,id(60),'pcs']);
 for(const [list,owner,name] of [[L,A,'רשימת הבית'],[X,C,'משפחה אחרת']])await db.query('INSERT INTO shopping_lists(id,name,"userId") VALUES($1,$2,$3)',[list,name,owner]);
 await db.query('INSERT INTO list_items(id,"shoppingListId","productId",quantity,notes) VALUES($1,$2,$3,2,$4)',[id(40),L,G,'הערה בעברית']);
 for(const [session,list] of [[S,L],[SX,X]])await db.query('INSERT INTO shopping_sessions(id,"shoppingListId",status,"receiptUrl","receiptAnalysis") VALUES($1,$2,$3,$4,$5)',[session,list,'completed',`https://storage.example.test/storage/v1/object/public/receipts/${session}-${id(90)}.pdf`,{storeName:'סופר',receiptTotal:9}]);
 for(const [item,session,price] of [[id(50),S,9],[id(51),SX,99]])await db.query('INSERT INTO session_items(id,"sessionId","productId","isPurchased",price) VALUES($1,$2,$3,true,$4)',[item,session,G,price]);
 await db.query('INSERT INTO hidden_products("userId","productId") VALUES($1,$2)',[B,G]);
});
after(async()=>{if(db?.isInitialized)await db.destroy();});

test('populated representative legacy schema and all existing rows/columns/indexes survive migration',async()=>{
 const before=await preserveSnapshot();
 await apply();
 assert.deepEqual(await preserveSnapshot(),before);
 assert.equal((await db.query("SELECT indexname FROM pg_indexes WHERE indexname IN ('UQ_eden_hidden_user_product','IDX_eden_credentials_user')")).length,2);
 const constraints=await db.query("SELECT contype,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='integration_credentials'::regclass");
 assert.ok(constraints.some(c=>c.contype==='f' && c.definition.includes('ON DELETE CASCADE')));
 assert.equal(constraints.filter(c=>c.contype==='c').length,3);
 assert.equal((await apply()).length,0,'Already-applied migration is a no-op');
 assert.equal(db.options.synchronize,false);
});

test('installation without hidden_products creates it additively with UUID defaults',async()=>{
 await db.query('DROP TABLE hidden_products');await apply();
 const rows=await db.query('INSERT INTO hidden_products("userId","productId") VALUES($1,$2) RETURNING id',[A,P]);assert.match(rows[0].id,/^[0-9a-f-]{36}$/);
 assert.equal((await db.query('SELECT * FROM shopping_lists')).length,2);
});

test('real constraints reject invalid verifiers scopes expiry missing owners nulls and duplicate hides',async()=>{
 await apply();
 const insert=async(owner,hash,scopes,expiry)=>db.query('INSERT INTO integration_credentials(id,"userId","tokenHash",scopes,"expiresAt") VALUES($1,$2,$3,$4,$5)',[randomUUID(),owner,hash,scopes,expiry]);
 const future=new Date(Date.now()+86400000);
 for(const [owner,hash,scopes,expiry,code] of [[A,'bad',['shopping:read'],future,'23514'],[A,'a'.repeat(64),['shopping:write'],future,'23514'],[A,'a'.repeat(64),[],future,'23514'],[A,'a'.repeat(64),['shopping:read'],new Date(0),'23514'],[id(999),'a'.repeat(64),['shopping:read'],future,'23503'],[null,'a'.repeat(64),['shopping:read'],future,'23502']])await assert.rejects(insert(owner,hash,scopes,expiry),e=>e.code===code);
 await assert.rejects(db.query('INSERT INTO hidden_products("userId","productId") VALUES($1,$2)',[B,G]),e=>e.code==='23505');
 await insert(A,'b'.repeat(64),['shopping:read'],future);
 await db.query('DELETE FROM profiles WHERE id=$1',[A]);assert.equal((await db.query('SELECT * FROM integration_credentials')).length,0,'Owner deletion cascades credentials');
});

test('rollback retains legacy data and hide preferences; reapplication succeeds',async()=>{
 await apply();await credentials().create(A,consent());const before=await preserveSnapshot();
 await db.undoLastMigration({transaction:'all'});
 assert.deepEqual(await preserveSnapshot(),before);
 assert.equal((await db.query("SELECT to_regclass('integration_credentials') AS name"))[0].name,null);
 await apply();assert.deepEqual(await preserveSnapshot(),before);assert.equal((await db.query('SELECT * FROM integration_credentials')).length,0);
});

test('duplicate legacy hide rows fail transactionally without deleting or deduplicating data',async()=>{
 await db.query('INSERT INTO hidden_products("userId","productId") VALUES($1,$2)',[B,G]);const before=await preserveSnapshot();
 await assert.rejects(apply(),e=>e.code==='23505');assert.deepEqual(await preserveSnapshot(),before);
 assert.equal((await db.query("SELECT to_regclass('integration_credentials') AS name"))[0].name,null);
});

test('preexisting index collision and missing prerequisite fail without altering legacy records',async()=>{
 await db.query('CREATE INDEX "UQ_eden_hidden_user_product" ON hidden_products("productId")');const before=await preserveSnapshot();
 await assert.rejects(apply(),e=>e.code==='42P07');assert.deepEqual(await preserveSnapshot(),before);
 await db.query('DROP INDEX "UQ_eden_hidden_user_product"');
 await db.query('DROP TABLE categories CASCADE');
 await assert.rejects(apply(),/Existing ShoppingList schema required/);
 assert.equal((await db.query('SELECT * FROM shopping_lists')).length,2);
});

test('real credential repositories preserve identity redact verifiers rotate atomically and revoke',async()=>{
 await apply();const service=credentials();const first=await service.create(A,consent());
 assert.equal((await service.verify(first.token)).id,A);
 const listed=await service.list(A);assert.equal(listed[0].tokenHash,undefined);assert.equal(listed[0].token,undefined);
 await assert.rejects(service.create(C,consent({rotateCredentialId:first.id})),e=>e.getStatus()===404);
 assert.equal((await service.verify(first.token)).id,A,'Failed rotation leaves the old credential active');
 const second=await service.create(A,consent({rotateCredentialId:first.id}));
 await assert.rejects(service.verify(first.token),e=>e.getStatus()===401);
 assert.equal((await service.verify(second.token)).id,A);
 await service.revoke(second.id,A);await assert.rejects(service.verify(second.token),e=>e.getStatus()===401);
});

test('Auth lifecycle query needs only id deleted_at and banned_until SELECT privileges',async()=>{
 await apply();const issued=await credentials().create(A,consent());
 const role='eden_auth_probe_'+randomBytes(5).toString('hex');const runner=db.createQueryRunner();await runner.connect();
 try {
  await db.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
  await db.query(`GRANT USAGE ON SCHEMA auth TO ${role}`);
  await db.query(`GRANT SELECT(id,deleted_at,banned_until) ON auth.users TO ${role}`);
  await runner.query(`SET ROLE ${role}`);
  const restricted=new IntegrationCredentialsService({getRepository:entity=>db.getRepository(entity),query:(sql,args)=>runner.query(sql,args)},config);
  assert.equal((await restricted.verify(issued.token)).id,A);
  await assert.rejects(runner.query('SELECT encrypted_password FROM auth.users'),e=>e.code==='42501');
  await assert.rejects(runner.query('SELECT email FROM auth.users'),e=>e.code==='42501');
  await assert.rejects(runner.query('UPDATE auth.users SET banned_until=now()'),e=>e.code==='42501');
  await db.query("UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=$1",[A]);
  await assert.rejects(restricted.verify(issued.token),e=>e.getStatus()===401);
  await db.query('UPDATE auth.users SET banned_until=NULL,deleted_at=now() WHERE id=$1',[A]);
  await assert.rejects(restricted.verify(issued.token),e=>e.getStatus()===401);
  await db.query('UPDATE auth.users SET deleted_at=NULL WHERE id=$1',[A]);
  await db.query(`REVOKE SELECT(id,deleted_at,banned_until) ON auth.users FROM ${role}`);
  await assert.rejects(restricted.verify(issued.token),e=>e.code==='42501','Missing lifecycle grants fail closed');
 } finally {
  await runner.query('RESET ROLE');await runner.release();
  await db.query(`DROP OWNED BY ${role}`);await db.query(`DROP ROLE ${role}`);
 }
});

test('real household policies deny unrelated and mismatched parents and reflect membership changes',async()=>{
 await apply();const policy=new AccessPolicy(db,config,{});
 assert.equal((await policy.list(L,B)).id,L);
 assert.equal((await policy.productImage(G,B)).id,G,'Hidden historical media is accessible through current household list reference');
 await assert.rejects(policy.list(L,C),e=>e.getStatus()===404);
 await assert.rejects(policy.product(H,A),e=>e.getStatus()===404);
 await assert.rejects(policy.product(G,A),e=>e.getStatus()===404,'Family hide applies to catalog reads');
 await assert.rejects(policy.authorize('ListItemsController','remove',{method:'DELETE',params:{listId:X,itemId:id(40)}},{id:C,kind:'web',scopes:[]}),e=>e.getStatus()===404);
 await db.query('UPDATE profiles SET "familyId"=$1 WHERE id=$2',[id(101),B]);
 await assert.rejects(policy.list(L,B),e=>e.getStatus()===404);
});

test('real purchase-history aggregation includes authorized family history only',async()=>{
 await apply();await db.query('DELETE FROM hidden_products');
 const service=new ProductsService(db.getRepository(Product),db.getRepository(SessionItem),db.getRepository(Profile),db.getRepository(HiddenProduct),config);
 const products=await service.findAll(B);assert.equal(products.find(p=>p.id===G).avgPrice,9);assert.ok(!products.some(p=>p.id===H));
 const other=await service.findAll(C);assert.equal(other.find(p=>p.id===G).avgPrice,99);
});
