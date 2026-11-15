require('reflect-metadata');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {DataSource}=require('typeorm');
const {entities}=require('../src/database/entities');
const {EdenSecurity1794096000000}=require('../src/database/migrations/1794096000000-eden-security');
const {ShoppingOperations1794096001000}=require('../src/database/migrations/1794096001000-shopping-operations');
const {EdenDataApiLockdown1794096002000}=require('../src/database/migrations/1794096002000-eden-data-api-lockdown');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const A=id(1),B=id(2),C=id(3),L=id(10),X=id(11),P=id(20),G=id(21),H=id(22),S=id(30),SX=id(31);
async function freshDatabase() {
 const value=process.env.SHOPPINGLIST_TEST_DATABASE_URL;
 if(!value)throw new Error('An explicitly supplied fresh disposable database is required');
 const url=new URL(value);
 if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname) || !/^\/shoppinglist_eden_test_[a-z0-9_]+$/.test(url.pathname) || url.search || url.hash)throw new Error('Only disposable local test databases are allowed');
 const db=new DataSource({type:'postgres',url:value,ssl:false,logging:false,synchronize:false,migrationsRun:false,entities,migrations:[EdenSecurity1794096000000,ShoppingOperations1794096001000,EdenDataApiLockdown1794096002000]});
 await db.initialize();
 const existing=await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')");
 if(existing.length){await db.destroy();throw new Error('Refusing a populated database');}
 return db;
}
async function resetFixture(db, phaseB=true) {


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
 if(phaseB)await db.runMigrations({transaction:'all'});
 else {const runner=db.createQueryRunner();try{await new EdenSecurity1794096000000().up(runner);}finally{await runner.release();}}
}
module.exports={freshDatabase,resetFixture,id,A,B,C,L,X,P,G,H,S};
