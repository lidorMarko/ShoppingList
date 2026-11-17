// Migration-CLI connection security: verified TLS by default, no URL parameter can weaken it,
// DATABASE_SSL=false only for loopback, and errors never echo credentials. Checks the effective
// node-postgres configuration (URL parameters override the `ssl` option there), not just ours.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,writeFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const ConnectionParameters=require('pg/lib/connection-parameters');
const {migrationConnectionOptions,redactConnectionSecrets}=require('../src/database/connection-security');

const SECRET='Sup3r-Secret-Pw';
const REMOTE=`postgresql://postgres.projectref:${SECRET}@aws-0-region.pooler.supabase.com:5432/postgres`;
const LOCAL=`postgres://postgres:${SECRET}@127.0.0.1:5432/shoppinglist`;
const effective=({url,ssl})=>new ConnectionParameters({connectionString:url,ssl}).ssl;
const refuses=(env,pattern)=>assert.throws(()=>migrationConnectionOptions(env),e=>{
 assert.match(e.message,pattern);
 for(const s of [SECRET,'projectref','aws-0-region',REMOTE,LOCAL])assert.ok(!e.message.includes(s),`error leaks ${s}`);
 return true;
});

test('remote connections always verify the certificate and host name',()=>{
 for(const DATABASE_SSL of [undefined,'','true']){
  const options=migrationConnectionOptions({DATABASE_URL:REMOTE,DATABASE_SSL});
  assert.deepEqual(options.ssl,{rejectUnauthorized:true});
  assert.notEqual(effective(options).rejectUnauthorized,false);
 }
 const full=migrationConnectionOptions({DATABASE_URL:`${REMOTE}?sslmode=verify-full`});
 assert.ok(effective(full)&&effective(full).rejectUnauthorized!==false,'verify-full keeps verification');
});

test('a CA file given as sslrootcert is used and verification stays on',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sl-ca-'));
 try{
  const ca=join(dir,'ca.crt');writeFileSync(ca,'-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n');
  const options=migrationConnectionOptions({DATABASE_URL:`${REMOTE}?sslrootcert=${encodeURIComponent(ca)}`});
  const ssl=effective(options);
  assert.match(String(ssl.ca),/BEGIN CERTIFICATE/);
  assert.notEqual(ssl.rejectUnauthorized,false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('URL parameters that would weaken or bypass TLS are refused without echoing credentials',()=>{
 // Without the guard, node-postgres would honour these and silently drop verification or TLS.
 assert.equal(new ConnectionParameters({connectionString:`${REMOTE}?sslmode=no-verify`,ssl:{rejectUnauthorized:true}}).ssl.rejectUnauthorized,false);
 assert.equal(new ConnectionParameters({connectionString:`${REMOTE}?sslmode=disable`,ssl:{rejectUnauthorized:true}}).ssl,false);
 for(const mode of ['disable','allow','prefer','require','verify-ca','no-verify'])refuses({DATABASE_URL:`${REMOTE}?sslmode=${mode}`},/sslmode must be omitted or verify-full/);
 for(const q of ['ssl=false','ssl=0','ssl=true','uselibpqcompat=true&sslmode=require','options=-c%20search_path%3Dshadow','sslcert=/tmp/x','host=/tmp'])refuses({DATABASE_URL:`${REMOTE}?${q}`},/is not allowed for migrations/);
});

test('DATABASE_SSL=false is accepted only for loopback databases',()=>{
 for(const host of ['127.0.0.1','localhost','[::1]'])assert.equal(migrationConnectionOptions({DATABASE_URL:`postgres://u:${SECRET}@${host}:5432/db`,DATABASE_SSL:'false'}).ssl,false);
 refuses({DATABASE_URL:REMOTE,DATABASE_SSL:'false'},/only for a loopback/);
 refuses({DATABASE_URL:`postgres://u:${SECRET}@10.0.0.5:5432/db`,DATABASE_SSL:'false'},/only for a loopback/);
 refuses({DATABASE_URL:`${LOCAL}?sslmode=verify-full`,DATABASE_SSL:'false'},/conflicts with TLS parameters/);
 refuses({DATABASE_URL:REMOTE,DATABASE_SSL:'no'},/must be "true"/);
 // With TLS on, an IP literal would skip host-name verification in node-postgres.
 for(const host of ['127.0.0.1','10.0.0.5','[::1]','[2001:db8::1]'])refuses({DATABASE_URL:`postgres://u:${SECRET}@${host}:5432/db`},/host name, not an IP address/);
 refuses({},/must be supplied explicitly/);
 refuses({DATABASE_URL:'not a url'},/not a valid URL/);
 refuses({DATABASE_URL:`mysql://u:${SECRET}@127.0.0.1/db`},/postgres/);
});

test('printed errors are redacted',()=>{
 const env={DATABASE_URL:REMOTE};
 const out=redactConnectionSecrets(`failed for ${REMOTE} using ${SECRET}`,env);
 assert.ok(!out.includes(SECRET)&&!out.includes(REMOTE));
 assert.match(out,/\[DATABASE_URL\].*\[redacted\]/);
});

test('both migration data sources refuse unsafe settings at load time',()=>{
 const saved={...process.env};
 for(const mod of ['../src/database/data-source','../src/database/data-source-lockdown']){
  try{
   process.env.DATABASE_URL=`${REMOTE}?sslmode=no-verify`;delete process.env.DATABASE_SSL;
   delete require.cache[require.resolve(mod)];
   assert.throws(()=>require(mod),/sslmode must be omitted or verify-full/);
   process.env.DATABASE_URL=REMOTE;
   delete require.cache[require.resolve(mod)];
   const ds=Object.values(require(mod))[0];
   assert.deepEqual(ds.options.ssl,{rejectUnauthorized:true});
  }finally{process.env=saved;delete require.cache[require.resolve(mod)];}
 }
});
