// Optional browser regression tests. Uses only the built UI and a loopback mock API.
const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const {createServer}=require('node:http');
const {readFileSync,existsSync}=require('node:fs');
const {resolve,extname}=require('node:path');
const {chromium}=require(process.env.SHOPPINGLIST_PLAYWRIGHT_MODULE || 'playwright');
const root=resolve(__dirname,'../dist');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const A=id(1),P=id(20),S=id(30);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
function pdfFixture() {
 const stream='BT /F1 12 Tf 20 80 Td (Synthetic receipt) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 120] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 let text='%PDF-1.4\n';const offsets=[0];
 objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(text));text+=`${index+1} 0 obj\n${object}\nendobj\n`;});
 const xref=Buffer.byteLength(text);text+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
 text+=offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('');
 text+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return Buffer.from(text);
}
const pdf=pdfFixture();
const token=[{alg:'HS256',typ:'JWT'},{sub:A,aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600},'synthetic-signature'].map(v=>typeof v==='string'?v:Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
let server,browser,page,context,base,requests,receiptType,products,grants,createdScopes;
function product(){return {id:P,userId:A,name:'חלב',imageUrl:`https://mock-project.example.test/storage/v1/object/public/product-images-private/${A}/${id(80)}.png`,createdAt:'2026-01-01',updatedAt:'2026-01-01'};}
function session(){return {id:S,shoppingListId:id(10),shoppingList:{id:id(10),name:'רשימת הבית'},status:'active',startedAt:'2026-01-01',items:[{id:id(50),sessionId:S,productId:P,product:product(),isPurchased:false}],receiptUrl:`/api/sessions/${S}/receipt/file`};}
before(async()=>{
 assert.ok(existsSync(resolve(root,'index.html')),'Build frontend with synthetic VITE_SUPABASE_URL first');
 server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname.startsWith('/api/')){
   requests.push({path:url.pathname,method:req.method,authorization:req.headers.authorization,contentType:req.headers['content-type']});
   res.setHeader('Cache-Control','no-store');
   if(req.headers.authorization!==`Bearer ${token}`){res.writeHead(401,{'content-type':'application/json'});res.end('{}');return;}
   if(url.pathname===`/api/products/${P}/image`){res.writeHead(200,{'content-type':'image/png'});res.end(png);return;}
   if(url.pathname===`/api/sessions/${S}/receipt/file`){res.writeHead(200,{'content-type':receiptType});res.end(receiptType==='image/png'?png:pdf);return;}
   let payload={};
   if(url.pathname==='/api/auth/me')payload={id:A,email:'owner@example.test',displayName:'Owner',familyRole:'member'};
   else if(url.pathname==='/api/products/me/is-admin')payload={isAdmin:false};
   else if(url.pathname==='/api/products' && req.method==='GET')payload=products;
   else if(url.pathname==='/api/categories')payload=[];
   else if(url.pathname==='/api/integrations/eden/credentials' && req.method==='GET')payload=grants;
   else if(url.pathname==='/api/integrations/eden/credentials' && req.method==='POST'){
    let text='';await new Promise(resolve=>{req.on('data',chunk=>text+=chunk);req.on('end',resolve);});const body=JSON.parse(text);createdScopes.push(body.scopes);
    const grant={id:id(100+grants.length),scopes:body.scopes,expiresAt:new Date(Date.now()+86400000).toISOString(),revokedAt:null};grants.push(grant);payload={...grant,token:'synthetic-browser-fixture-not-a-usable-credential'};
   }
   else if(url.pathname==='/api/uploads/product-image' && req.method==='POST')payload={url:product().imageUrl};
   else if(url.pathname===`/api/products/${P}` && req.method==='PUT'){await new Promise(resolve=>{req.resume();req.on('end',resolve);});payload=product();}
   else if(url.pathname===`/api/sessions/${S}/receipt` && req.method==='POST'){await new Promise(resolve=>{req.resume();req.on('end',resolve);});receiptType='application/pdf';payload=session();}
   else if(url.pathname===`/api/sessions/${S}`)payload=session();
   else {res.statusCode=404;payload={message:'Unmocked API route'};}
   res.setHeader('content-type','application/json');res.end(JSON.stringify(payload));return;
  }
  let path=resolve(root,'.'+decodeURIComponent(url.pathname));
  if(!path.startsWith(root+'/')){res.statusCode=403;res.end();return;}
  if(!existsSync(path) || !extname(path))path=resolve(root,'index.html');
  try{res.setHeader('content-type',({'.js':'application/javascript','.css':'text/css','.html':'text/html'})[extname(path)]||'application/octet-stream');res.end(readFileSync(path));}catch{res.statusCode=404;res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true});
});
beforeEach(async()=>{
 requests=[];receiptType='image/png';products=[product()];createdScopes=[];grants=[{id:id(90),scopes:['shopping:read'],expiresAt:new Date(Date.now()+86400000).toISOString(),revokedAt:null}];
 context=await browser.newContext();
 await context.route('**/*',route=>{
  const url=route.request().url();if(url.startsWith(base+'/') || url.startsWith('blob:') || url.startsWith('data:'))return route.continue();
  return route.abort('blockedbyclient');
 });
 await context.addInitScript(({token,A})=>{
  localStorage.setItem('sb-mock-project-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic-refresh-not-used',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:A,email:'owner@example.test',aud:'authenticated'}}));
 },{token,A});
 page=await context.newPage();page.setDefaultTimeout(7000);
});
after(async()=>{await context?.close();await browser?.close();await new Promise(resolve=>server?.close(resolve));});

test('product image display edit preview and upload use authenticated API and retain edit workflow',async()=>{
 await page.goto(base+'/products');
 await page.getByRole('heading',{name:'Products',exact:true}).waitFor();
 await page.waitForFunction(()=>Array.from(document.images).some(img=>img.alt==='חלב' && img.naturalWidth>0));
 await page.getByRole('button',{name:'Edit',exact:true}).click();
 await page.waitForFunction(()=>Array.from(document.images).some(img=>img.alt==='preview' && img.naturalWidth>0));
 await page.locator('input[type=file]').setInputFiles({name:'milk.png',mimeType:'image/png',buffer:png});
 await page.waitForFunction(()=>document.querySelector('button[type=submit]')?.disabled===false);
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('button[type=submit]'));
 assert.ok(requests.some(r=>r.path==='/api/uploads/product-image' && r.method==='POST' && r.contentType.startsWith('multipart/form-data')));
 assert.ok(requests.some(r=>r.path===`/api/products/${P}` && r.method==='PUT'));
 assert.ok(requests.filter(r=>r.path.endsWith('/image')).every(r=>r.authorization===`Bearer ${token}`));
 await context.close();
});

test('receipt image lightbox and replacement with PDF continue through authenticated blob downloads',async()=>{
 await page.goto(base+`/sessions/${S}`);
 await page.waitForFunction(()=>Array.from(document.images).some(img=>img.alt==='Receipt' && img.naturalWidth>0));
 await page.getByRole('button',{name:'View full',exact:true}).click();
 await page.waitForFunction(()=>Array.from(document.images).some(img=>img.alt==='Receipt full' && img.naturalWidth>0));
 await page.getByAltText('Receipt full').click();
 await page.getByRole('button',{name:'Replace',exact:true}).click();
 await page.locator('input[type=file]').setInputFiles({name:'receipt.pdf',mimeType:'application/pdf',buffer:pdf});
 await page.getByText('PDF Receipt uploaded',{exact:true}).waitFor();
 await page.evaluate(()=>{const original=window.open;window.open=function(url,...args){window.__openedReceiptUrl=String(url);return original.call(window,url,...args);};});
 const [popup]=await Promise.all([page.waitForEvent('popup'),page.getByRole('button',{name:'View full',exact:true}).click()]);
 const receiptUrl=await page.evaluate(()=>window.__openedReceiptUrl);assert.ok(receiptUrl.startsWith('blob:'));assert.ok(popup);
 const opened=await page.evaluate(async url=>{const response=await fetch(url);return {type:response.headers.get('content-type'),prefix:(await response.text()).slice(0,8)};},receiptUrl);
 assert.equal(opened.type,'application/pdf');assert.equal(opened.prefix,'%PDF-1.4');
 assert.ok(requests.some(r=>r.path===`/api/sessions/${S}/receipt` && r.method==='POST'));
 assert.ok(requests.filter(r=>r.path.includes('/receipt')).every(r=>r.authorization===`Bearer ${token}`));
 await context.close();
});

test('write consent is opt-in and existing read-only grants remain unchanged',async()=>{
 await page.goto(base+'/integrations/eden');await page.getByRole('heading',{name:'Connect Eden'}).waitFor();
 const writes=page.getByRole('checkbox',{name:'Also authorize shopping list and item changes'});assert.equal(await writes.isChecked(),false);
 await page.getByRole('button',{name:'Authorize Eden read access',exact:true}).click();await page.getByLabel('One-time Eden credential').waitFor();assert.deepEqual(createdScopes[0],['shopping:read']);
 await writes.check();await page.getByRole('button',{name:'Authorize Eden read and write access',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('button') && !Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Authorize Eden read and write access' && b.disabled));
 assert.deepEqual(createdScopes[1],['shopping:read','shopping:write']);assert.deepEqual(grants[0].scopes,['shopping:read']);
 await page.reload();await page.getByRole('heading',{name:'Connect Eden'}).waitFor();assert.equal(await page.getByRole('checkbox',{name:'Also authorize shopping list and item changes'}).isChecked(),false);
 await context.close();
});
