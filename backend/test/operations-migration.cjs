const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {freshDatabase,resetFixture,A,B}=require('./postgres-fixture.cjs');
const {ShoppingOperations1794096001000}=require('../src/database/migrations/1794096001000-shopping-operations');
let db;
before(async()=>{db=await freshDatabase();});
beforeEach(async()=>{await resetFixture(db,false);});
after(async()=>{if(db?.isInitialized)await db.destroy();});
async function withMigration(fn){const runner=db.createQueryRunner();try{return await fn(new ShoppingOperations1794096001000(),runner);}finally{await runner.release();}}
async function originalRows(){const result={};for(const table of ['profiles','families','categories','products','shopping_lists','list_items','shopping_sessions','session_items','hidden_products'])result[table]=await db.query(`SELECT * FROM ${table} ORDER BY id`);return JSON.parse(JSON.stringify(result));}
async function receipt(owner=A,key='a'.repeat(64)) {return db.query('INSERT INTO shopping_operations(id,"userId","keyHash",operation,"requestHash","httpStatus","responseBody","listBindings") VALUES($1,$2,$3,$4,$5,201,$6,$7) RETURNING id',[randomUUID(),owner,key,'list.create','b'.repeat(64),{name:'סופר'},'[]']);}
test('Phase B extends the populated Phase A installation without altering existing records',async()=>{
 const before=await originalRows();await withMigration((migration,runner)=>migration.up(runner));assert.deepEqual(await originalRows(),before);
 const indexes=await db.query("SELECT indexname,indexdef FROM pg_indexes WHERE tablename='shopping_operations'");
 assert.ok(indexes.some(i=>i.indexname==='UQ_shopping_operations_user_key' && i.indexdef.includes('UNIQUE')));
 assert.ok(indexes.some(i=>i.indexname==='IDX_shopping_operations_user_created'));
 await receipt();await assert.rejects(receipt(),e=>e.code==='23505');await receipt(B);
 assert.equal(db.options.synchronize,false);
});
test('write grants are explicit; rollback revokes them and keeps durable operation receipts',async()=>{
 await withMigration((migration,runner)=>migration.up(runner));
 const readId=randomUUID(),writeId=randomUUID();
 for(const [id,scopes] of [[readId,['shopping:read']],[writeId,['shopping:read','shopping:write']]])await db.query(`INSERT INTO integration_credentials(id,"userId","tokenHash",scopes,"expiresAt") VALUES($1,$2,$3,$4,now()+interval '1 day')`,[id,A,'c'.repeat(64),scopes]);
 await receipt();
 await withMigration((migration,runner)=>migration.down(runner));
 const grants=await db.query('SELECT id,scopes,"revokedAt" FROM integration_credentials ORDER BY id');
 assert.equal(grants.find(g=>g.id===readId).revokedAt,null);assert.ok(grants.find(g=>g.id===writeId).revokedAt);
 assert.deepEqual(grants.find(g=>g.id===writeId).scopes,['shopping:read']);
 assert.equal((await db.query('SELECT * FROM shopping_operations')).length,1);
 await withMigration((migration,runner)=>migration.up(runner));assert.equal((await db.query('SELECT * FROM shopping_operations')).length,1);
 await assert.rejects(receipt(),e=>e.code==='23505','Replay uniqueness survives rollback and reapplication');
});
test('scope/hash/owner constraints reject invalid ledger records and grants',async()=>{
 await withMigration((migration,runner)=>migration.up(runner));
 await assert.rejects(db.query(`INSERT INTO integration_credentials(id,"userId","tokenHash",scopes,"expiresAt") VALUES($1,$2,$3,$4,now()+interval '1 day')`,[randomUUID(),A,'c'.repeat(64),['shopping:write']]),e=>e.code==='23514');
 await assert.rejects(receipt('missing-owner'),e=>e.code==='23503');
 await assert.rejects(receipt(A,'not-a-hash'),e=>e.code==='23514');
 await receipt();await db.query('DELETE FROM profiles WHERE id=$1',[A]);assert.equal((await db.query('SELECT * FROM shopping_operations')).length,0);
});
test('unrecognized existing ledger is rejected without overwriting it',async()=>{
 await db.query('CREATE TABLE shopping_operations (legacy_value text)');await db.query("INSERT INTO shopping_operations VALUES('keep me')");
 await assert.rejects(withMigration((migration,runner)=>migration.up(runner)),/Unrecognized operation ledger/);
 assert.deepEqual(await db.query('SELECT * FROM shopping_operations'),[{legacy_value:'keep me'}]);
});

test('recognized ledger with damaged uniqueness is rejected before reapplication',async()=>{
 await withMigration((migration,runner)=>migration.up(runner));await withMigration((migration,runner)=>migration.down(runner));
 await db.query('DROP INDEX "UQ_shopping_operations_user_key"');
 await assert.rejects(withMigration((migration,runner)=>migration.up(runner)),/Operation ledger schema is incompatible/);
});
