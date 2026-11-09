require('reflect-metadata');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { createHash, randomBytes } = require('node:crypto');
const { Module, ValidationPipe } = require('@nestjs/common');
const { APP_GUARD, APP_INTERCEPTOR, NestFactory } = require('@nestjs/core');
const { ConfigService } = require('@nestjs/config');
const { DataSource } = require('typeorm');
const { ReliableShoppingService } = require('../src/modules/operations/reliable-shopping.service');
const { OperationsController } = require('../src/modules/operations/operations.controller');
const { AccessPolicy } = require('../src/modules/auth/access-policy.service');
const { SupabaseAuthGuard } = require('../src/modules/auth/supabase-auth.guard');
const { PrivacyInterceptor } = require('../src/modules/auth/privacy.interceptor');
const { IntegrationCredentialsService } = require('../src/modules/auth/integration-credentials.service');
const { Profile } = require('../src/database/entities/profile.entity');
const { ShoppingList } = require('../src/database/entities/shopping-list.entity');
const { Product } = require('../src/database/entities/product.entity');
const { HiddenProduct } = require('../src/database/entities/hidden-product.entity');
const { ListItem } = require('../src/database/entities/list-item.entity');
const { ShoppingSession } = require('../src/database/entities/shopping-session.entity');
const { SessionItem } = require('../src/database/entities/session-item.entity');
const { IntegrationCredential } = require('../src/database/entities/integration-credential.entity');
const { UploadsService } = require('../src/modules/uploads/uploads.service');
const { SessionsService } = require('../src/modules/sessions/sessions.service');
const { ListItemsService } = require('../src/modules/list-items/list-items.service');
const { ProductsService } = require('../src/modules/products/products.service');
const { EdenSecurity1794096000000 } = require('../src/database/migrations/1794096000000-eden-security');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const A=id(1), B=id(2), C=id(3), L=id(10), X=id(11), P=id(20), G=id(21), H=id(22), S=id(30), I=id(40), SI=id(41);
let rows, app, authServer, base, authUrl, calls, enabled=true, accountEnabled=true;
function match(row, where) {
  if (Array.isArray(where)) return where.some(w=>match(row,w));
  return Object.entries(where || {}).every(([k,v]) => {
    if (v && v._type === 'in') return v._value.includes(row[k]);
    if (v && v._type === 'isNull') return row[k] === null;
    return row[k] === v;
  });
}
function repo(entity) {
  const data=()=>rows.get(entity) || [];
  return {
    findOne: async options=>data().find(row=>match(row,options.where)) || null,
    findOneBy: async where=>data().find(row=>match(row,where)) || null,
    existsBy: async where=>data().some(row=>match(row,where)),
    find: async options=>data().filter(row=>match(row,options?.where)),
    findBy: async where=>data().filter(row=>match(row,where)),
    insert: async value=>{ data().push({...value,createdAt:new Date(),revokedAt:null}); },
    update: async (where,value)=>{const matched=data().filter(row=>match(row,where));matched.forEach(row=>Object.assign(row,value));return {affected:matched.length};},
  };
}
const db={getRepository:repo,transaction:async fn=>fn(db),query:async(sql,params)=>accountEnabled ? [{id:params[0]}] : []};
const uploads={imageLocation: ref=> {
  if (typeof ref !== 'string' || !ref.startsWith('image:')) throw new (require('@nestjs/common').BadRequestException)('Invalid image reference');
  return {bucket:'product-images-private',key:ref.slice(6)};
},downloadImage:async()=>({buffer:Buffer.from('image'),contentType:'image/png'}),uploadProductImage:async()=> 'uploaded'};
const config={get:key=>({SUPABASE_URL:authUrl,SUPABASE_PUBLISHABLE_KEY:'test-publishable-key',SUPABASE_SERVICE_ROLE_KEY:'not-for-routine-auth-test-sentinel',ADMIN_EMAIL:'admin@example.test',EDEN_INTEGRATION_ENABLED:enabled?'true':'false'})[key]};
function fixture() {
  calls=[];
  rows=new Map([
    [Profile,[{id:A,email:'owner@example.test',familyId:'family-1'},{id:B,email:'member@example.test',familyId:'family-1'},{id:C,email:'other@example.test',familyId:'family-2'}]],
    [ShoppingList,[{id:L,userId:A},{id:X,userId:C}]],
    [Product,[{id:P,userId:A},{id:G,userId:null},{id:H,userId:C}]],
    [HiddenProduct,[]], [ListItem,[{id:I,shoppingListId:L,productId:P}]],
    [ShoppingSession,[{id:S,shoppingListId:L}]], [SessionItem,[{id:SI,sessionId:S,productId:P}]],
    [IntegrationCredential,[]],
  ]);
  enabled=true; accountEnabled=true;
}
function token(overrides={}) {
  const credentialId=id(100+rows.get(IntegrationCredential).length);
  const value=`eden_${credentialId}_${randomBytes(32).toString('base64url')}`;
  rows.get(IntegrationCredential).push({id:credentialId,userId:A,tokenHash:createHash('sha256').update(value).digest('hex'),scopes:['shopping:read'],expiresAt:new Date(Date.now()+60000),revokedAt:null,...overrides});
  return value;
}
async function request(path, bearer, method='GET', body) {
 const response=await fetch(base+path,{method,headers:{...(bearer?{authorization:`Bearer ${bearer}`} : {}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const text=await response.text();return {status:response.status,body:text?(response.headers.get('content-type')?.includes('application/json')?JSON.parse(text):text):null};
}
const controllers=[],providers=[];
for (const [dir,name] of [['lists','Lists'],['list-items','ListItems'],['products','Products'],['categories','Categories'],['sessions','Sessions'],['uploads','Uploads'],['families','Families'],['auth','Auth']]) {
 const file=dir==='auth'?'auth':dir;
 const controller=require(`../src/modules/${dir}/${file}.controller`)[`${name}Controller`];controllers.push(controller);
 const Service=require(`../src/modules/${dir}/${file}.service`)[`${name}Service`];
 const mock=new Proxy({}, {get:(_,handler)=>handler==='isAdmin' ? email=>email==='admin@example.test' : ['then','onModuleInit','onApplicationBootstrap','onModuleDestroy','onApplicationShutdown','beforeApplicationShutdown'].includes(handler) ? undefined : async(...args)=>{calls.push({name,handler,args});if(handler==='isAdmin') return args[0]==='admin@example.test'; if(handler==='downloadReceipt')return {buffer:Buffer.from('receipt'),contentType:'image/png',filename:'receipt.png'};if(handler==='findOne' && name==='Products')return {id:args[0],imageUrl:'image:test'};return {ok:true};}});
 providers.push({provide:Service,useValue:mock});
}
controllers.push(require('../src/modules/auth/integration-credentials.controller').IntegrationCredentialsController,require('../src/modules/auth/integration-self.controller').IntegrationSelfController,OperationsController);
providers.push({provide:ReliableShoppingService,useValue:{respond:async(response,user,operation)=>{response.status(operation.endsWith('delete')?204:operation.endsWith('create')||operation.endsWith('copy')||operation.endsWith('batch')?201:200);return {ok:true};},lookup:async()=>({ok:true})}});
before(async()=>{
 authServer=createServer((req,res)=>{
   const who={owner:A,member:B,other:C,admin:A,unverifiedAdmin:A}[req.headers.authorization?.slice(7)];
   res.setHeader('content-type','application/json');
   if(!who || req.headers.apikey !== 'test-publishable-key'){res.statusCode=401;res.end(JSON.stringify({message:'Invalid token'}));return;}
   res.end(JSON.stringify({id:who,email:['Bearer admin','Bearer unverifiedAdmin'].includes(req.headers.authorization)?'admin@example.test':`${who}@example.test`,aud:'authenticated',email_confirmed_at:req.headers.authorization==='Bearer unverifiedAdmin'?null:'2026-01-01T00:00:00Z'}));
 });
 await new Promise(resolve=>authServer.listen(0,'127.0.0.1',resolve));
 authUrl=`http://127.0.0.1:${authServer.address().port}`;
 class TestModule {}
 Module({controllers,providers:[...providers,{provide:DataSource,useValue:db},{provide:ConfigService,useValue:config},{provide:UploadsService,useValue:uploads},AccessPolicy,IntegrationCredentialsService,{provide:APP_GUARD,useClass:SupabaseAuthGuard},{provide:APP_INTERCEPTOR,useClass:PrivacyInterceptor}]})(TestModule);
 app=await NestFactory.create(TestModule,{logger:false});
 app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
 app.setGlobalPrefix('api');await app.listen(0,'127.0.0.1');base=await app.getUrl();
});
after(async()=>{await app?.close();await new Promise(resolve=>authServer?.close(resolve));});

test('every existing protected controller rejects unauthenticated access before service calls',async()=>{
 fixture();
 for(const path of ['/api/lists',`/api/lists/${L}/items`,'/api/products','/api/categories','/api/sessions','/api/uploads/product-image','/api/families','/api/auth/me','/api/integrations/eden/credentials']) {
  const method=['/api/families','/api/uploads/product-image'].includes(path)?'POST':'GET';
  assert.equal((await request(path,null,method)).status,401,path);
 }
 assert.equal(calls.length,0);
});
test('invalid web and malformed integration credentials fail closed',async()=>{
 fixture();for(const t of ['invalid','eden_invalid','eden_00000000-0000-4000-8000-000000000100_wrong'])assert.equal((await request('/api/lists',t)).status,401);
 assert.equal(calls.length,0);
});
test('valid read credential can access same account and family lists but cannot mutate',async()=>{
 fixture();const t=token();
 assert.equal((await request(`/api/lists/${L}`,t)).status,200);
 assert.equal((await request(`/api/lists/${X}`,t)).status,404);
 assert.equal((await request('/api/lists',t,'POST',{name:'new'})).status,403);
 for(const path of ['/api/sessions','/api/auth/me','/api/integrations/eden/credentials','/api/products/me/is-admin'])assert.equal((await request(path,t)).status,403);
});
test('expired revoked insufficient-scope and tampered credentials are rejected',async()=>{
 for(const [overrides,status] of [[{expiresAt:new Date(0)},401],[{revokedAt:new Date()},401],[{scopes:[]},403]]){
  fixture();assert.equal((await request('/api/lists',token(overrides))).status,status);
 }
 fixture();const t=token();assert.equal((await request('/api/lists',t.slice(0,-2)+'xx')).status,401);
});
test('opt-in disabled blocks credential provisioning and use',async()=>{
 fixture();const t=token();enabled=false;
 assert.equal((await request('/api/lists',t)).status,404);
 assert.equal((await request('/api/integrations/eden/credentials','owner','POST',{application:'eden',consent:true,scopes:['shopping:read']})).status,404);
});
test('current household grants shared access and membership change removes it immediately',async()=>{
 fixture();assert.equal((await request(`/api/lists/${L}`,'member')).status,200);
 assert.equal((await request(`/api/lists/${L}`,'other')).status,404);
 const t=token({userId:B});assert.equal((await request(`/api/lists/${L}`,t)).status,200);
 rows.get(Profile).find(p=>p.id===B).familyId='family-2';
 assert.equal((await request(`/api/lists/${L}`,t)).status,404);
 rows.get(Profile).splice(0,1);assert.equal((await request('/api/lists',token())).status,401);
});
test('list nesting and copy authorization block wrong parents and inaccessible targets',async()=>{
 fixture();
 assert.equal((await request(`/api/lists/${X}/items/${I}`,'owner','DELETE')).status,404);
 assert.equal((await request(`/api/lists/${L}/items/${id(99)}`,'owner','DELETE')).status,404);
 assert.equal((await request(`/api/lists/${L}/copy-items`,'owner','POST',{targetListId:X})).status,404);
 assert.equal((await request(`/api/lists/${L}/copy-items`,'owner','POST',{})).status,400);
 assert.equal((await request(`/api/lists/${L}/items/${I}`,'member','PUT',{quantity:2})).status,200);
});
test('private and hidden products cannot be discovered or added, shared products remain editable',async()=>{
 fixture();
 assert.equal((await request(`/api/products/${H}`,'owner')).status,404);
 assert.equal((await request(`/api/products/${H}`,'owner','DELETE')).status,404);
 assert.equal((await request(`/api/lists/${L}/items`,'owner','POST',{productId:H})).status,404);
 rows.get(HiddenProduct).push({userId:B,productId:G});
 assert.equal((await request(`/api/products/${G}`,'owner')).status,404);
 assert.equal((await request(`/api/lists/${L}/items`,'owner','POST',{productId:G})).status,404);
 assert.equal((await request(`/api/products/${P}`,'member','PUT',{name:'shared'})).status,200);
});
test('global products and categories require configured admin for edits',async()=>{
 fixture();
 assert.equal((await request(`/api/products/${G}`,'owner','PUT',{name:'global'})).status,403);
 assert.equal((await request('/api/products','owner','POST',{name:'global',isGlobal:true})).status,403);
 for(const [method,path,body] of [['POST','/api/categories',{name:'test'}],['PUT',`/api/categories/${G}`,{name:'test'}],['DELETE',`/api/categories/${G}`,null]])assert.equal((await request(path,'owner',method,body)).status,403);
 assert.equal((await request('/api/categories','owner')).status,200);
 assert.equal((await request('/api/categories','admin','POST',{name:'test'})).status,201);
});
test('session reads receipt analysis uploads downloads and item writes require current list access',async()=>{
 fixture();
 for(const [path,method,body] of [[`/api/sessions/${S}`,'GET'],[`/api/sessions/${S}/receipt/file`,'GET'],[`/api/sessions/${S}/analyze-receipt`,'POST'],[`/api/sessions/${S}/receipt`,'POST'],[`/api/sessions/${S}/items/${SI}`,'PATCH',{quantity:2}]])assert.equal((await request(path,'other',method,body)).status,404);
 assert.equal((await request(`/api/sessions/${S}`,'member')).status,200);
 assert.equal((await request(`/api/sessions/${S}/items/${id(99)}`,'owner','DELETE')).status,404);
 assert.equal((await request('/api/sessions','owner','POST',{shoppingListId:X})).status,404);
});
test('credential provisioning requires explicit consent, bounds scopes and lifetime, derives identity from session',async()=>{
 fixture();
 const path='/api/integrations/eden/credentials';
 for(const body of [{},{application:'eden',consent:false,scopes:['shopping:read']},{application:'eden',consent:true,scopes:['shopping:write']},{application:'eden',consent:true,scopes:['shopping:read'],expiresInDays:91},{application:'eden',consent:true,scopes:['shopping:read'],userId:C}])assert.equal((await request(path,'owner','POST',body)).status,400);
 const created=await request(path,'owner','POST',{application:'eden',consent:true,scopes:['shopping:read']});assert.equal(created.status,201);
 const row=rows.get(IntegrationCredential)[0];assert.equal(row.userId,A);assert.notEqual(row.tokenHash,created.body.token);assert.equal(row.tokenHash,createHash('sha256').update(created.body.token).digest('hex'));
 assert.equal((await request('/api/lists',created.body.token)).status,200);
 assert.equal((await request(`${path}/${row.id}`,'other','DELETE')).status,404);
 assert.equal((await request(`${path}/${row.id}`,'owner','DELETE')).status,200);
 assert.equal((await request('/api/lists',created.body.token)).status,401);
});
test('rotation revokes previous token and returns new token only once',async()=>{
 fixture();const old=token();const oldId=rows.get(IntegrationCredential)[0].id;
 const created=await request('/api/integrations/eden/credentials','owner','POST',{application:'eden',consent:true,scopes:['shopping:read'],rotateCredentialId:oldId});assert.equal(created.status,201);
 assert.equal((await request('/api/lists',old)).status,401);assert.equal((await request('/api/lists',created.body.token)).status,200);
 // Real repository select projections exclude verifier hashes and plaintext tokens.
 const service=new IntegrationCredentialsService({getRepository:()=>({find:async opts=>{assert.ok(!opts.select.includes('tokenHash'));return [];}})},config);
 assert.deepEqual(await service.list(A),[]);
});
test('a credential can inspect only its own non-secret metadata; web sessions cannot use self routes',async()=>{
 fixture();const t=token();const otherUser=token({userId:B,scopes:['shopping:read','shopping:write']});
 const self=await request('/api/integrations/eden/self',t);assert.equal(self.status,200);
 const row=rows.get(IntegrationCredential)[0];
 assert.deepEqual(Object.keys(self.body).sort(),['credentialId','expiresAt','itemRemovalProtocol','listDeletionProtocol','mutationProtocol','scopes','userId']);
 assert.equal(self.body.mutationProtocol,'phase-d-v1');assert.equal(self.body.itemRemovalProtocol,'phase-e-item-v1');assert.equal(self.body.listDeletionProtocol,'phase-e-list-v1');assert.equal(self.body.credentialId,row.id);assert.equal(self.body.userId,A);assert.deepEqual(self.body.scopes,['shopping:read']);
 assert.equal(new Date(self.body.expiresAt).getTime(),row.expiresAt.getTime());
 assert.ok(!JSON.stringify(self.body).includes(row.tokenHash)&&!JSON.stringify(self.body).includes(t.slice(`eden_${row.id}_`.length)));
 const write=await request('/api/integrations/eden/self',otherUser);assert.equal(write.status,200);assert.equal(write.body.userId,B);assert.deepEqual(write.body.scopes,['shopping:read','shopping:write']);
 for(const method of ['GET','DELETE'])assert.equal((await request('/api/integrations/eden/self','owner',method)).status,403);
 assert.equal((await request('/api/integrations/eden/self',null)).status,401);
 // Self routes take no identifier: a body/path cannot target another credential.
 assert.equal((await request(`/api/integrations/eden/self/${rows.get(IntegrationCredential)[1].id}`,t,'DELETE')).status,404);
 assert.equal(rows.get(IntegrationCredential)[1].revokedAt,null);
});
test('self revocation revokes only the presenting credential and is rejected after expiry/revocation/disable',async()=>{
 fixture();const t=token();const sibling=token();
 assert.equal((await request('/api/integrations/eden/self',t,'DELETE')).status,200);
 assert.ok(rows.get(IntegrationCredential)[0].revokedAt instanceof Date);assert.equal(rows.get(IntegrationCredential)[1].revokedAt,null);
 for(const method of ['GET','DELETE'])assert.equal((await request('/api/integrations/eden/self',t,method)).status,401);
 assert.equal((await request('/api/lists',t)).status,401);assert.equal((await request('/api/lists',sibling)).status,200);
 fixture();assert.equal((await request('/api/integrations/eden/self',token({expiresAt:new Date(0)}))).status,401);
 fixture();const disabled=token();enabled=false;assert.equal((await request('/api/integrations/eden/self',disabled)).status,404);
 fixture();const account=token();accountEnabled=false;assert.equal((await request('/api/integrations/eden/self',account,'DELETE')).status,401);assert.equal(rows.get(IntegrationCredential)[0].revokedAt,null);
});
test('unreviewed route handlers and malformed resource identifiers fail closed',async()=>{
 fixture();const policy=new AccessPolicy(db,config,uploads);
 await assert.rejects(policy.authorize('UnknownController','findAll',{}, {id:A,kind:'web'}),e=>e.getStatus()===403);
 assert.equal((await request('/api/lists/not-a-uuid','owner')).status,400);
});
test('image preview ownership and product authorization deny cross-household images',async()=>{
 fixture();
 assert.equal((await request(`/api/products/${H}/image`,'owner')).status,404);
 assert.equal((await request(`/api/uploads/product-image?reference=${encodeURIComponent('image:'+C+'/'+id(80)+'.png')}`,'owner')).status,404);
 assert.equal((await request(`/api/products/${P}`,'owner','PUT',{imageUrl:'https://malicious.test/x.png'})).status,400);
 assert.equal((await request(`/api/products/${P}/image`,token())).status,403);
});
test('privacy interceptor redacts now-inaccessible nested products and raw receipt references',async()=>{
 fixture();const policy=new AccessPolicy(db,config,uploads);const interceptor=new PrivacyInterceptor(policy);
 const {of,lastValueFrom}=require('rxjs');const headers={};
 const data={id:S,receiptUrl:'private:secret-object-name',items:[{product:{id:H,name:'private'}},{product:{id:P,name:'shared'}}]};
 const result=await lastValueFrom(interceptor.intercept({switchToHttp:()=>({getRequest:()=>({user:{id:A}}),getResponse:()=>({setHeader:(k,v)=>headers[k]=v})})},{handle:()=>of(data)}));
 assert.equal(result.receiptUrl,`/api/sessions/${S}/receipt/file`);assert.equal(result.items[0].product,null);assert.equal(result.items[1].product.name,'shared');assert.equal(headers['Cache-Control'],'no-store');assert.equal(data.items[0].product.name,'private');
});
test('item service lookup includes supplied list id',async()=>{
 const service=new ListItemsService({findOne:async opts=>{assert.deepEqual(opts.where,{id:I,shoppingListId:X});return null;}});
 await assert.rejects(service.remove(X,I),e=>e.getStatus()===404);
});
test('price aggregation is restricted to current household owners',async()=>{
 fixture();let sql,params;
 const products={find:async()=>[{id:G}]};
 const history={manager:{query:async(q,p)=>{sql=q;params=p;return [];}}};
 const service=new ProductsService(products,history,{findOne:async()=>rows.get(Profile)[0],find:async()=>rows.get(Profile).slice(0,2)},{find:async()=>[]},config);
 await service.findAll(A);assert.match(sql,/l\."userId" = ANY\(\$1::text\[\]\)/);assert.deepEqual(params,[[A,B]]);
});
test('receipt storage rejects public buckets and arbitrary URL references without network fetch',async()=>{
 const service=Object.create(SessionsService.prototype);service.config={get:()=> 'https://project.example.test'};service.findOne=async()=>({id:S,receiptUrl:`https://project.example.test/storage/v1/object/public/receipts/${S}-${id(90)}.png`});
 service.supabase={storage:{getBucket:async()=>({data:{public:true}})}};
 await assert.rejects(service.downloadReceipt(S),e=>e.getStatus()===500);
 service.findOne=async()=>({id:S,receiptUrl:'https://attacker.test/private'});
 await assert.rejects(service.downloadReceipt(S),e=>e.getStatus()===400);
});
test('migration requires existing schema, creates only additive security tables, rollback retains preferences',async()=>{
 const migration=new EdenSecurity1794096000000();const queries=[];
 await assert.rejects(migration.up({hasTable:async()=>false,query:async q=>queries.push(q)}),/Existing ShoppingList schema required/);assert.deepEqual(queries,[]);
 await migration.up({hasTable:async name=>name!=='hidden_products',query:async q=>queries.push(q)});
 assert.equal(queries.filter(q=>q.includes('CREATE TABLE')).length,2);assert.ok(queries.some(q=>q.includes('REFERENCES profiles(id) ON DELETE CASCADE')));
 const rollback=[];await migration.down({query:async q=>rollback.push(q)});assert.ok(!rollback.some(q=>q.includes('DROP TABLE hidden_products')));
 const existing=[];await migration.up({hasTable:async()=>true,query:async q=>existing.push(q)});assert.ok(!existing.some(q=>q.includes('CREATE TABLE hidden_products')));
});

test('all declared protected HTTP handlers are covered by authentication, including future route additions',async()=>{
 fixture();const {PATH_METADATA,METHOD_METADATA}=require('@nestjs/common/constants');const {RequestMethod}=require('@nestjs/common');
 for(const controller of controllers){
  const prefix=Reflect.getMetadata(PATH_METADATA,controller);
  for(const name of Object.getOwnPropertyNames(controller.prototype)){
   if(name==='constructor')continue;
   const fn=controller.prototype[name];const path=Reflect.getMetadata(PATH_METADATA,fn);
   if(path===undefined || name==='validateInvite')continue;
   const method=RequestMethod[Reflect.getMetadata(METHOD_METADATA,fn)];
   const route=(`/api/${prefix}/${path}`).replace(/\/+/g,'/').replace(/:(?:listId|itemId|id)/g,L).replace(/\/$/,'');
   assert.equal((await request(route,null,method)).status,401,`${method} ${route}`);
  }
 }
 assert.equal(calls.length,0);
});
test('Auth deletion or ban invalidates an integration credential even if its profile remains',async()=>{
 fixture();const t=token();accountEnabled=false;
 assert.equal((await request('/api/lists',t)).status,401);
});
test('private image parser rejects external origins and traversal without contacting storage',()=>{
 const service=Object.create(UploadsService.prototype);service.config={get:()=> 'https://project.example.test'};
 for(const reference of ['https://attacker.test/storage/v1/object/public/product-images/a.png','https://project.example.test/storage/v1/object/public/product-images/../../secrets','https://project.example.test/storage/v1/object/public/product-images/a.svg'])assert.throws(()=>service.imageLocation(reference));
 const key=`${A}/${id(90)}.png`;
 assert.deepEqual(service.imageLocation(`https://project.example.test/storage/v1/object/public/product-images-private/${key}`),{bucket:'product-images-private',key});
});

test('admin email claims from body or unconfirmed Auth email never authorize catalog writes',async()=>{
 fixture();
 for(const bearer of ['owner','unverifiedAdmin'])assert.equal((await request('/api/categories',bearer,'POST',{name:'test',email:'admin@example.test',userId:A,isAdmin:true})).status,403);
 assert.equal((await request('/api/products/me/is-admin','unverifiedAdmin')).body.isAdmin,false);
 assert.equal((await request('/api/products/me/is-admin','admin')).body.isAdmin,true);
});
test('authorized household users can retrieve image and receipt bytes; outsider gets no bytes',async()=>{
 fixture();
 for(const bearer of ['owner','member']){
  const image=await request(`/api/products/${P}/image`,bearer);assert.equal(image.status,200);assert.equal(image.body,'image');
  const receipt=await request(`/api/sessions/${S}/receipt/file`,bearer);assert.equal(receipt.status,200);assert.equal(receipt.body,'receipt');
 }
 for(const path of [`/api/products/${P}/image`,`/api/sessions/${S}/receipt/file`])assert.equal((await request(path,'other')).status,404);
 const reference=encodeURIComponent(`image:${A}/${id(80)}.png`);
 assert.equal((await request(`/api/uploads/product-image?reference=${reference}`,'member')).status,200);
 assert.equal((await request(`/api/uploads/product-image?reference=${reference}`,'other')).status,404);
});
test('historical hidden product images require a currently authorized list or session reference',async()=>{
 fixture();rows.get(HiddenProduct).push({userId:B,productId:G});
 assert.equal((await request(`/api/products/${G}/image`,'owner')).status,404);
 rows.get(ListItem).push({id:id(88),shoppingListId:L,productId:G});
 assert.equal((await request(`/api/products/${G}/image`,'member')).status,200);
 assert.equal((await request(`/api/products/${G}/image`,'other')).status,200,'Global product is not hidden in the other household');
 assert.equal((await request(`/api/products/${G}`,'owner')).status,404,'Catalog remains hidden');
});
test('nullable category updates remain compatible without accepting forged ownership',async()=>{
 fixture();assert.equal((await request(`/api/products/${P}`,'owner','PUT',{categoryId:null})).status,200);
 assert.equal((await request(`/api/products/${P}`,'owner','PUT',{userId:C})).status,400);
 assert.equal((await request('/api/lists','owner','POST',{name:'test',userId:C,familyId:'other'})).status,400);
});
test('actual image storage service fails closed on public bucket before reading object bytes',async()=>{
 const service=Object.create(UploadsService.prototype);service.config={get:()=> 'https://project.example.test'};let downloads=0;
 service.supabase={storage:{getBucket:async()=>({data:{public:true}}),from:()=>({download:async()=>{downloads++;}})}};
 await assert.rejects(service.downloadImage(`https://project.example.test/storage/v1/object/public/product-images/${id(80)}.png`),e=>e.getStatus()===500);assert.equal(downloads,0);
});
test('actual media services deliver authorized private image and legacy/private receipt bytes without public URLs',async()=>{
 const payload=Buffer.from('test-media-bytes');const calls=[];
 const storage={getBucket:async bucket=>{calls.push(['bucket',bucket]);return {data:{public:false}};},from:bucket=>({download:async key=>{calls.push(['download',bucket,key]);return {data:new Blob([payload])};}})};
 const image=Object.create(UploadsService.prototype);image.config={get:()=> 'https://project.example.test'};image.supabase={storage};
 const result=await image.downloadImage(`https://project.example.test/storage/v1/object/public/product-images-private/${A}/${id(80)}.png`);assert.deepEqual(result.buffer,payload);assert.equal(result.contentType,'image/png');
 const receipts=Object.create(SessionsService.prototype);receipts.config=image.config;receipts.supabase={storage};
 for(const reference of [`private:${S}-${id(90)}.pdf`,`https://project.example.test/storage/v1/object/public/receipts/${S}-${id(90)}.pdf`]){
  receipts.findOne=async()=>({id:S,receiptUrl:reference});const file=await receipts.downloadReceipt(S);assert.deepEqual(file.buffer,payload);assert.equal(file.contentType,'application/pdf');
 }
 assert.ok(calls.some(c=>c[0]==='download' && c[1]==='receipts'));
});
test('storage references with userinfo or invalid percent encoding are rejected consistently',async()=>{
 const image=Object.create(UploadsService.prototype);image.config={get:()=> 'https://project.example.test'};
 for(const reference of [`https://user:password@project.example.test/storage/v1/object/public/product-images/${id(80)}.png`,`https://project.example.test/storage/v1/object/public/product-images/%ZZ.png`])assert.throws(()=>image.imageLocation(reference),e=>e.getStatus()===400);
 const receipt=Object.create(SessionsService.prototype);receipt.config=image.config;
 for(const reference of [`https://user:password@project.example.test/storage/v1/object/public/receipts/${S}-${id(90)}.pdf`,`https://project.example.test/storage/v1/object/public/receipts/%ZZ.pdf`]){
  receipt.findOne=async()=>({id:S,receiptUrl:reference});await assert.rejects(receipt.downloadReceipt(S),e=>e.getStatus()===400);
 }
});

test('multipart image and receipt uploads bind to verified account and authorized parent',async()=>{
 fixture();let uploader=null;const previous=uploads.uploadProductImage;
 uploads.uploadProductImage=async(file,userId)=>{uploader=userId;assert.equal(file.mimetype,'image/png');return 'synthetic-image-reference';};
 try {
  const form=new FormData();form.append('file',new Blob(['synthetic-png'],{type:'image/png'}),'test.png');form.append('userId',C);
  const image=await fetch(base+'/api/uploads/product-image',{method:'POST',headers:{authorization:'Bearer owner'},body:form});assert.equal(image.status,201);assert.equal(uploader,A);
  const receiptForm=new FormData();receiptForm.append('file',new Blob(['synthetic-pdf'],{type:'application/pdf'}),'test.pdf');
  const receipt=await fetch(base+`/api/sessions/${S}/receipt`,{method:'POST',headers:{authorization:'Bearer member'},body:receiptForm});assert.equal(receipt.status,201);
  assert.ok(calls.some(c=>c.name==='Sessions' && c.handler==='uploadReceipt' && c.args[0]===S));
  calls=[];
  const denied=await fetch(base+`/api/sessions/${S}/receipt`,{method:'POST',headers:{authorization:'Bearer other'},body:receiptForm});assert.equal(denied.status,404);assert.equal(calls.length,0);
 } finally {uploads.uploadProductImage=previous;}
});
