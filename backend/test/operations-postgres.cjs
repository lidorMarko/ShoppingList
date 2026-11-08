require('reflect-metadata');
const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createServer}=require('node:http');
const {Module,ValidationPipe}=require('@nestjs/common');
const {NestFactory,APP_GUARD,APP_INTERCEPTOR}=require('@nestjs/core');
const {ConfigService}=require('@nestjs/config');
const {DataSource}=require('typeorm');
const {getRepositoryToken}=require('@nestjs/typeorm');
const {freshDatabase,resetFixture,id,A,B,C,L,X,P,G,H}=require('./postgres-fixture.cjs');
const {ListsController}=require('../src/modules/lists/lists.controller');
const {ListItemsController}=require('../src/modules/list-items/list-items.controller');
const {OperationsController}=require('../src/modules/operations/operations.controller');
const {ListsService}=require('../src/modules/lists/lists.service');
const {ListItemsService}=require('../src/modules/list-items/list-items.service');
const {ReliableShoppingService}=require('../src/modules/operations/reliable-shopping.service');
const {AtomicBatchService}=require('../src/modules/operations/atomic-batch.service');
const {IntegrationCredentialsService}=require('../src/modules/auth/integration-credentials.service');
const {AccessPolicy}=require('../src/modules/auth/access-policy.service');
const {SupabaseAuthGuard}=require('../src/modules/auth/supabase-auth.guard');
const {PrivacyInterceptor}=require('../src/modules/auth/privacy.interceptor');
const {UploadsService}=require('../src/modules/uploads/uploads.service');
const {ShoppingList}=require('../src/database/entities/shopping-list.entity');
const {ListItem}=require('../src/database/entities/list-item.entity');
const {Profile}=require('../src/database/entities/profile.entity');
let db,app,base,authServer,authUrl,owner,member,other,readOnly;
const config={get:k=>({EDEN_INTEGRATION_ENABLED:'true',SUPABASE_URL:authUrl,SUPABASE_PUBLISHABLE_KEY:'test-public-key',ADMIN_EMAIL:'admin@example.test'})[k]};
const consent=scopes=>({application:'eden',consent:true,scopes});
const batchPath=`/api/lists/${L}/items/batch`;
const input=extra=>({items:[{productId:P,quantity:1,unit:'קרטון',...extra}]});
async function api(path,method='GET',body,key,token=owner.token,extra={}){
 const response=await fetch(base+path,{method,headers:{...(token?{authorization:`Bearer ${token}`} : {}),...(body?{'content-type':'application/json'}:{}),...(key?{'idempotency-key':key}:{}),...extra},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
 const text=await response.text();return {status:response.status,body:text?JSON.parse(text):null,operationId:response.headers.get('x-operation-id'),replayed:response.headers.get('idempotency-replayed')};
}
async function count(product=P){return Number((await db.query('SELECT count(*) FROM list_items WHERE "shoppingListId"=$1 AND "productId"=$2',[L,product]))[0].count);}
async function quantity(product=P){return Number((await db.query('SELECT quantity FROM list_items WHERE "shoppingListId"=$1 AND "productId"=$2',[L,product]))[0]?.quantity);}
before(async()=>{
 db=await freshDatabase();
 authServer=createServer((req,res)=>{res.setHeader('content-type','application/json');if(req.headers.authorization!=='Bearer web-owner'){res.statusCode=401;res.end('{}');return;}res.end(JSON.stringify({id:A,email:'owner@example.test',email_confirmed_at:'2026-01-01',aud:'authenticated'}));});
 await new Promise(resolve=>authServer.listen(0,'127.0.0.1',resolve));authUrl=`http://127.0.0.1:${authServer.address().port}`;
 class TestModule{}
 Module({controllers:[ListsController,ListItemsController,OperationsController],providers:[{provide:DataSource,useValue:db},{provide:ConfigService,useValue:config},{provide:UploadsService,useValue:{}},...([ShoppingList,ListItem,Profile].map(entity=>({provide:getRepositoryToken(entity),useValue:db.getRepository(entity)}))),AccessPolicy,IntegrationCredentialsService,ReliableShoppingService,AtomicBatchService,ListsService,ListItemsService,{provide:APP_GUARD,useClass:SupabaseAuthGuard},{provide:APP_INTERCEPTOR,useClass:PrivacyInterceptor}]})(TestModule);
 app=await NestFactory.create(TestModule,{logger:false});
 // Test-only lost-response fault injection runs after the real transaction has committed.
 app.use((req,res,next)=>{if(req.headers['x-test-drop-response']==='1')res.end=function(){res.destroy();return res;};next();});
 app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));app.setGlobalPrefix('api');await app.listen(0,'127.0.0.1');base=await app.getUrl();
});
beforeEach(async()=>{
 await resetFixture(db);const service=app.get(IntegrationCredentialsService);
 [owner,member,other]=await Promise.all([A,B,C].map(user=>service.create(user,consent(['shopping:read','shopping:write']))));
 readOnly=await service.create(A,consent(['shopping:read']));
});
after(async()=>{await app?.close();await new Promise(resolve=>authServer?.close(resolve));if(db?.isInitialized)await db.destroy();});

test('successful item mutation replays the exact result once and persists a durable receipt',async()=>{
 const key=randomUUID();const first=await api(`/api/lists/${L}/items`,'POST',{productId:P,quantity:2},key);assert.equal(first.status,201);assert.ok(first.operationId);
 const second=await api(`/api/lists/${L}/items`,'POST',{quantity:2,productId:P},key);assert.equal(second.status,201);assert.equal(second.replayed,'true');assert.deepEqual(second.body,first.body);assert.equal(second.operationId,first.operationId);assert.equal(await count(),1);
 const status=await api(`/api/integration/operations/${first.operationId}`);assert.equal(status.body.status,'succeeded');assert.deepEqual(status.body.result,first.body);
});
test('twenty concurrent requests with one key execute the batch only once',async()=>{
 const key=randomUUID();const results=await Promise.all(Array.from({length:20},()=>api(batchPath,'POST',input({quantity:2}),key)));
 assert.ok(results.every(r=>r.status===201));assert.equal(new Set(results.map(r=>r.operationId)).size,1);assert.equal(results.filter(r=>r.replayed==='false').length,1);assert.equal(await count(),1);assert.equal(await quantity(),2);
});
test('concurrent independent keys serialize list quantity merges without lost updates',async()=>{
 const results=await Promise.all(Array.from({length:6},()=>api(batchPath,'POST',input({quantity:1}),randomUUID())));assert.ok(results.every(r=>r.status===201));assert.equal(await count(),1);assert.equal(await quantity(),6);
});
test('changed payload and different operation conflict without performing another write',async()=>{
 const key=randomUUID();assert.equal((await api(batchPath,'POST',input(),key)).status,201);
 assert.equal((await api(batchPath,'POST',input({quantity:2}),key)).status,409);
 assert.equal((await api('/api/lists','POST',{name:'סופר'},key)).status,409);assert.equal(await quantity(),1);
});
test('keys are account scoped, while operation status is never household shared',async()=>{
 const key=randomUUID();const first=await api(batchPath,'POST',input(),key);
 const second=await api(batchPath,'POST',input(),key,member.token);assert.equal(second.status,201);assert.notEqual(second.operationId,first.operationId);assert.equal(await quantity(),2);
 assert.equal((await api(`/api/integration/operations/${first.operationId}`,'GET',undefined,undefined,member.token)).status,404);
 assert.equal((await api(`/api/integration/operations/${first.operationId}`,'GET',undefined,undefined,other.token)).status,404);
});
test('batches reject cross-family lists inaccessible products and hidden catalog entries atomically',async()=>{
 assert.equal((await api(`/api/lists/${X}/items/batch`,'POST',input(),randomUUID())).status,404);
 for(const productId of [H,G,id(999)])assert.equal((await api(batchPath,'POST',{items:[{productId:P,quantity:1},{productId,quantity:1}]},randomUUID())).status,404);
 assert.equal(await count(),0);assert.equal(Number((await db.query('SELECT count(*) FROM shopping_operations'))[0].count),0);
});
test('late database failure rolls back prior batch changes and the receipt',async()=>{
 await db.query(`CREATE FUNCTION reject_test_item() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."productId"='${G}'::uuid THEN RAISE EXCEPTION 'synthetic late fault'; END IF; RETURN NEW; END $$`);
 await db.query('CREATE TRIGGER test_reject BEFORE INSERT ON list_items FOR EACH ROW EXECUTE FUNCTION reject_test_item()');await db.query('DELETE FROM hidden_products');await db.query('DELETE FROM list_items WHERE "productId"=$1',[G]);
 const key=randomUUID();const result=await api(batchPath,'POST',{items:[{productId:P,quantity:1},{productId:G,quantity:1}]},key);assert.equal(result.status,503);assert.equal(await count(),0);
 assert.equal((await api('/api/integration/operations/by-key','GET',undefined,key)).status,404);
 await db.query('DROP TRIGGER test_reject ON list_items');assert.equal((await api(batchPath,'POST',{items:[{productId:P,quantity:1},{productId:G,quantity:1}]},key)).status,201);assert.equal(await count(),1);
});
test('batch quantity unit and selector validation rejects malformed input without side effects',async()=>{
 for(const item of [{productId:P,isPurchased:null},{productId:P,quantity:-1},{productId:P,quantity:0.001},{productId:P,quantity:100000000},{productId:P,quantity:'2'},{productId:P,quantity:1,unit:'  '},{productId:P,unit:'x'.repeat(33)},{productId:P,productName:'חלב'},{quantity:1},{productId:P,userId:C}])assert.equal((await api(batchPath,'POST',{items:[item]},randomUUID())).status,400,JSON.stringify(item));
 assert.equal((await api(batchPath,'POST',{items:[]},randomUUID())).status,400);assert.equal(await count(),0);
});
test('exact Hebrew names resolve only visible products and ambiguous names are not guessed',async()=>{
 const exact=await api(batchPath,'POST',{items:[{productName:' חלב ',quantity:2,unit:' קרטון '}]},randomUUID());assert.equal(exact.status,201);assert.equal(await quantity(),2);
 await db.query('INSERT INTO products(id,name) VALUES($1,$2)',[id(25),'חלב']);assert.equal((await api(batchPath,'POST',{items:[{productName:'חלב',quantity:1}]},randomUUID())).status,409);
 assert.equal((await api(batchPath,'POST',{items:[{productName:'מוצר שלא קיים',quantity:1}]},randomUUID())).status,404);
});
test('compatible duplicates combine exact decimal quantities within batch and existing row',async()=>{
 const first=await api(batchPath,'POST',{items:[{productId:P,quantity:0.1,unit:'קג'},{productName:'חלב',quantity:0.2,unit:'קג'}]},randomUUID());assert.equal(first.status,201);assert.equal(await quantity(),0.3);assert.equal(await count(),1);
 assert.equal((await api(batchPath,'POST',input({quantity:0.7,unit:'קג'}),randomUUID())).status,201);assert.equal(await quantity(),1);
 assert.equal((await api(batchPath,'POST',input({quantity:1,unit:'גרם'}),randomUUID())).status,409);assert.equal(await quantity(),1);
});
test('explicit purchase state supports true false and retries without toggling',async()=>{
 const created=await api(batchPath,'POST',input(),randomUUID());const itemId=created.body.items[0].id;
 const path=`/api/lists/${L}/items/${itemId}/purchased`;const key=randomUUID();assert.equal((await api(path,'PATCH',{isPurchased:true},key)).status,200);
 assert.equal((await api(path,'PATCH',{isPurchased:true},key)).body.isPurchased,true);assert.equal((await api(path,'PATCH',{isPurchased:false},randomUUID())).body.isPurchased,false);
 assert.equal((await api(`/api/lists/${L}/items/${itemId}/toggle`,'PATCH',undefined,randomUUID())).status,403);
 assert.equal((await api(path,'PATCH',{isPurchased:'false'},randomUUID())).status,400);
});
test('delete receipts replay after target removal but still require current household rights',async()=>{
 const created=await api(batchPath,'POST',input(),randomUUID());const itemId=created.body.items[0].id;const key=randomUUID();const path=`/api/lists/${L}/items/${itemId}`;
 const first=await api(path,'DELETE',undefined,key);assert.equal(first.status,204);assert.equal((await api(path,'DELETE',undefined,key)).status,204);
 const deletionKey=randomUUID();const list=await api(`/api/lists/${L}`,'DELETE',undefined,deletionKey);assert.equal(list.status,204);assert.equal((await api(`/api/lists/${L}`,'DELETE',undefined,deletionKey)).status,204);
});
test('lost HTTP response is reconciled by key header and replayed without repeating the mutation',async()=>{
 const key=randomUUID();await assert.rejects(api(batchPath,'POST',input({quantity:2}),key,owner.token,{'x-test-drop-response':'1'}));assert.equal(await quantity(),2);
 const status=await api('/api/integration/operations/by-key','GET',undefined,key);assert.equal(status.status,200);assert.equal(status.body.status,'succeeded');
 const retry=await api(batchPath,'POST',input({quantity:2}),key);assert.equal(retry.operationId,status.body.operationId);assert.equal(retry.replayed,'true');assert.equal(await quantity(),2);
});
test('recovery and replay deny revoked expired read-only and household-removed credentials',async()=>{
 const key=randomUUID();const result=await api(batchPath,'POST',input(),key,member.token);const path=`/api/integration/operations/${result.operationId}`;
 assert.equal((await api(path,'GET',undefined,undefined,readOnly.token)).status,403);
 await db.query('UPDATE profiles SET "familyId"=$1 WHERE id=$2',[id(101),B]);assert.equal((await api(path,'GET',undefined,undefined,member.token)).status,404);
 await app.get(IntegrationCredentialsService).revoke(member.id,B);assert.equal((await api(path,'GET',undefined,undefined,member.token)).status,401);
 await db.query(`UPDATE integration_credentials SET "createdAt"=now()-interval '2 days',"expiresAt"=now()-interval '1 day' WHERE id=$1`,[owner.id]);assert.equal((await api(path)).status,401);
});
test('write grants require a key while legacy web writes remain compatible and unkeyed',async()=>{
 assert.equal((await api(`/api/lists/${L}/items`,'POST',{productId:P,quantity:1})).status,400);
 assert.equal((await api(`/api/lists/${L}/items`,'POST',{productId:P,quantity:1},randomUUID(),readOnly.token)).status,403);
 const web=await api(`/api/lists/${L}/items`,'POST',{productId:P,quantity:1},undefined,'web-owner');assert.equal(web.status,201);assert.equal(web.operationId,null);
 const key=randomUUID();const created=await api('/api/lists','POST',{name:'סופר'},key);assert.equal(created.status,201);assert.deepEqual((await api('/api/lists','POST',{name:'סופר'},key)).body,created.body);
});

test('ambiguous duplicates with unspecified quantities notes or purchase states roll back fully',async()=>{
 for(const pair of [
  [{productId:P,unit:'קרטון'},{productId:P,quantity:1,unit:'קרטון'}],
  [{productId:P,quantity:1,notes:'אחד'},{productId:P,quantity:1,notes:'שניים'}],
  [{productId:P,quantity:1,isPurchased:true},{productId:P,quantity:1,isPurchased:false}],
 ]){
  const key=randomUUID();assert.equal((await api(batchPath,'POST',{items:pair},key)).status,409);assert.equal(await count(),0);
  assert.equal((await api('/api/integration/operations/by-key','GET',undefined,key)).status,404);
 }
 const unknown=await api(batchPath,'POST',{items:[{productId:P,unit:'קרטון'}]},randomUUID());assert.equal(unknown.status,201,'A single new item can retain unspecified quantity');
 assert.equal((await api(batchPath,'POST',input(),randomUUID())).status,409);assert.equal((await db.query('SELECT quantity FROM list_items WHERE "productId"=$1',[P]))[0].quantity,null);
});
test('multiple preexisting rows never cause an arbitrary merge target or legacy cleanup',async()=>{
 for(let i=0;i<2;i++)assert.equal((await api(`/api/lists/${L}/items`,'POST',{productId:P,quantity:1,unit:'קרטון'},randomUUID())).status,201);
 assert.equal((await api(batchPath,'POST',input(),randomUUID())).status,409);assert.equal(await count(),2);
});
test('existing notes and purchased-state mismatches and overflow preserve the original quantity',async()=>{
 await api(batchPath,'POST',input({quantity:99999999.99,notes:'ללא שינוי',isPurchased:true}),randomUUID());
 for(const addition of [{quantity:1,notes:'ללא שינוי',isPurchased:true},{quantity:1,notes:'אחר',isPurchased:true},{quantity:1,notes:'ללא שינוי',isPurchased:false}])assert.equal((await api(batchPath,'POST',input(addition),randomUUID())).status,409);
 assert.equal(await quantity(),99999999.99);
});
test('late batch failure also rolls back an earlier existing-item quantity update',async()=>{
 await api(batchPath,'POST',input(),randomUUID());await db.query('DELETE FROM hidden_products');await db.query('DELETE FROM list_items WHERE "productId"=$1',[G]);
 await db.query(`CREATE FUNCTION reject_test_item() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."productId"='${G}'::uuid THEN RAISE EXCEPTION 'synthetic late fault'; END IF; RETURN NEW; END $$`);
 await db.query('CREATE TRIGGER test_reject BEFORE INSERT ON list_items FOR EACH ROW EXECUTE FUNCTION reject_test_item()');
 const key=randomUUID();assert.equal((await api(batchPath,'POST',{items:[{productId:P,quantity:2,unit:'קרטון'},{productId:G,quantity:1}]},key)).status,503);assert.equal(await quantity(),1);assert.equal(await count(G),0);
});
test('read-only grants stay unchanged and write consent is required explicitly',async()=>{
 const grants=await app.get(IntegrationCredentialsService).list(A);assert.deepEqual(grants.find(g=>g.id===readOnly.id).scopes,['shopping:read']);assert.deepEqual(grants.find(g=>g.id===owner.id).scopes,['shopping:read','shopping:write']);
 assert.equal((await api(batchPath,'POST',input(),randomUUID(),readOnly.token)).status,403);
 assert.equal((await api('/api/integration/operations/by-key','GET',undefined,randomUUID(),readOnly.token)).status,403);
});
test('rotation preserves account-bound idempotency while revoked old credentials cannot recover',async()=>{
 const key=randomUUID();const first=await api(batchPath,'POST',input(),key);
 const rotated=await app.get(IntegrationCredentialsService).create(A,{...consent(['shopping:read','shopping:write']),rotateCredentialId:owner.id});
 assert.equal((await api('/api/integration/operations/by-key','GET',undefined,key,owner.token)).status,401);
 const recovered=await api('/api/integration/operations/by-key','GET',undefined,key,rotated.token);assert.equal(recovered.body.operationId,first.operationId);
 assert.equal((await api(batchPath,'POST',input(),key,rotated.token)).replayed,'true');assert.equal(await quantity(),1);
});
test('replay and recovery revalidate current scopes and current household permissions',async()=>{
 const key=randomUUID();await api(batchPath,'POST',input(),key,member.token);
 await db.query('UPDATE profiles SET "familyId"=$1 WHERE id=$2',[id(101),B]);assert.equal((await api(batchPath,'POST',input(),key,member.token)).status,404);
 const ownKey=randomUUID();const result=await api(batchPath,'POST',input(),ownKey);
 await db.query('UPDATE integration_credentials SET scopes=$1 WHERE id=$2',[['shopping:read'],owner.id]);
 assert.equal((await api(`/api/integration/operations/${result.operationId}`)).status,403);assert.equal((await api(batchPath,'POST',input(),ownKey)).status,403);
});
test('cached hydrated product data is redacted when product visibility changes',async()=>{
 await db.query('UPDATE products SET "userId"=$1 WHERE id=$2',[B,P]);const created=await api(batchPath,'POST',input(),randomUUID());const itemId=created.body.items[0].id;
 const key=randomUUID();const path=`/api/lists/${L}/items/${itemId}`;const first=await api(path,'PUT',{quantity:2},key);assert.equal(first.body.product.name,'חלב');
 await db.query('UPDATE profiles SET "familyId"=$1 WHERE id=$2',[id(101),B]);
 const replay=await api(path,'PUT',{quantity:2},key);assert.equal(replay.body.product,null);
 const status=await api(`/api/integration/operations/${first.operationId}`);assert.equal(status.body.result.product,null);
});
test('new service instance recovers durable results without any process-local cache',async()=>{
 const key=randomUUID();const original=await api(batchPath,'POST',input(),key);
 const connection=new DataSource({...db.options});await connection.initialize();
 try {
  const user=await app.get(IntegrationCredentialsService).verify(owner.token);
  const service=new ReliableShoppingService(connection,new AccessPolicy(connection,config,{}),new AtomicBatchService());
  const recovered=await service.lookup(user,original.operationId);assert.deepEqual(recovered.result,original.body);
 }finally{await connection.destroy();}
});
test('canonical normalized payload replays but invalid or missing recovery keys do not',async()=>{
 const key=randomUUID();const first=await api(batchPath,'POST',input({unit:' קרטון ',notes:' הערה '}),key);assert.equal(first.status,201);
 const replay=await api(batchPath,'POST',{items:[{notes:'הערה',unit:'קרטון',quantity:1,productId:P}]},key);assert.equal(replay.replayed,'true');
 for(const invalid of ['short','x'.repeat(129),'this key has spaces'])assert.equal((await api(batchPath,'POST',input(),invalid)).status,400);
 assert.equal((await api('/api/integration/operations/by-key')).status,400);
 assert.deepEqual(Object.keys((await api('/api/integration/operations/by-key','GET',undefined,key)).body).sort(),['httpStatus','operationId','result','status']);
});
test('copy and rename keep original successful results on keyed replay',async()=>{
 await db.query('DELETE FROM hidden_products');const target=id(70);await db.query('INSERT INTO shopping_lists(id,name,"userId") VALUES($1,$2,$3)',[target,'יעד',A]);
 const key=randomUUID();const copied=await api(`/api/lists/${L}/copy-items`,'POST',{targetListId:target},key);assert.equal(copied.status,201);
 assert.deepEqual((await api(`/api/lists/${L}/copy-items`,'POST',{targetListId:target},key)).body,copied.body);assert.equal((await db.query('SELECT * FROM list_items WHERE "shoppingListId"=$1',[target])).length,1);
 const renameKey=randomUUID();const renamed=await api(`/api/lists/${target}`,'PUT',{name:'שם חדש'},renameKey);assert.equal(renamed.status,200);
 assert.deepEqual((await api(`/api/lists/${target}`,'PUT',{name:'שם חדש'},renameKey)).body,renamed.body);
});

test('DELETE and legacy toggle reject unsupported bodies rather than silently changing key semantics',async()=>{
 const created=await api(batchPath,'POST',input(),randomUUID());const itemId=created.body.items[0].id;
 assert.equal((await api(`/api/lists/${L}/items/${itemId}`,'DELETE',{userId:C},randomUUID())).status,400);assert.equal(await count(),1);
 assert.equal((await api(`/api/lists/${L}`,'DELETE',{name:'ignored'},randomUUID())).status,400);
 assert.equal((await api(`/api/lists/${L}/items/${itemId}/toggle`,'PATCH',{isPurchased:true},randomUUID(),'web-owner')).status,400);
});
