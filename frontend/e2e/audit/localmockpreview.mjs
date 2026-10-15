import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Vive en `e2e/audit/`, así que el build está dos niveles arriba (`frontend/build`).
// Venía de `frontend/.tmp/`, donde bastaba un nivel: al moverlo hubo que ajustarla,
// porque una ruta relativa sin corregir deja la herramienta rota en silencio.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'build');
const started = new Date().toISOString();
const tables = [
  { id:'table-01', number:1, area:'Salón', status:'ocupada', capacity:4, branch_id:'branch-local', active_order:{id:'order-sent',status:'enviado_cocina'}, created_at:started },
  { id:'table-02', number:2, area:'Salón', status:'disponible', capacity:2, branch_id:'branch-local', created_at:started },
  { id:'table-03', number:3, area:'Terraza', status:'disponible', capacity:4, branch_id:'branch-local', created_at:started },
  { id:'table-04', number:4, area:'Terraza', status:'ocupada', capacity:4, branch_id:'branch-local', active_order:{id:'order-draft',status:'borrador'}, created_at:started },
];
const categories=[{id:'cat-food',name:'Platos'},{id:'cat-drink',name:'Bebidas'}];
const products=[
 {id:'prod-empanada',name:'Empanadas x3',price:18,category_id:'cat-food',is_available:true,is_combo:false},
 {id:'prod-lomo',name:'Lomo saltado',price:32,category_id:'cat-food',is_available:true,is_combo:false},
 {id:'prod-limonada',name:'Limonada',price:10,category_id:'cat-drink',is_available:true,is_combo:false},
 {id:'prod-agua',name:'Agua sin gas',price:5,category_id:'cat-drink',is_available:true,is_combo:false},
];
const orders=[
 {id:'order-sent',order_number:101,table_id:'table-01',table_number:1,status:'enviado_cocina',order_type:'mesa',created_at:started,updated_at:started,customer_name:'Mesa 1',items:[{id:'item-sent-1',product_id:'prod-lomo',product_name:'Lomo saltado',quantity:1,unit_price:32,subtotal:32,status:'enviado_cocina',notes:''},{id:'item-sent-2',product_id:'prod-limonada',product_name:'Limonada',quantity:2,unit_price:10,subtotal:20,status:'enviado_cocina',notes:''},{id:'item-draft-agua',product_id:'prod-agua',product_name:'Agua sin gas',quantity:1,unit_price:5,subtotal:5,status:'borrador',notes:''}],total:57,amount_paid:0},
 {id:'order-draft',order_number:102,table_id:'table-04',table_number:4,status:'borrador',order_type:'mesa',created_at:started,updated_at:started,customer_name:'',items:[{id:'item-draft-1',product_id:'prod-empanada',product_name:'Empanadas x3',quantity:1,unit_price:18,subtotal:18,status:'borrador',notes:''}],total:18,amount_paid:0},
];
const users={'mozo@resto.com':{id:'local-mozo',email:'mozo@resto.com',name:'Mozo Demo',full_name:'Mozo Demo',role:'mozo',restaurant_id:'local-restaurant',home:'/salon',functions:['atencion']},'admin@resto.com':{id:'local-admin',email:'admin@resto.com',name:'Admin Demo',full_name:'Admin Demo',role:'admin',restaurant_id:'local-restaurant',home:'/salon',functions:['atencion','preparacion','cobro','administracion']}};
let orderSeq=103,itemSeq=3;
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'GET,POST,PATCH,PUT,DELETE,OPTIONS'});res.end(status===204?'':JSON.stringify(data));};
const readBody=req=>new Promise(resolve=>{let s='';req.on('data',c=>s+=c);req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch{resolve({})}})});
const sum=o=>{for(const i of o.items||[])if(i.subtotal==null)i.subtotal=Number(i.quantity||0)*Number(i.unit_price||0);o.total=(o.items||[]).filter(i=>i.status!=='cancelado').reduce((n,i)=>n+Number(i.subtotal||0),0);o.updated_at=new Date().toISOString();return o;};
const mockApi=http.createServer(async(req,res)=>{
 if(req.method==='OPTIONS')return send(res,204,{});
 const u=new URL(req.url,'http://127.0.0.1'),p=u.pathname.replace(/^\/api/,''),body=await readBody(req);
 if(p==='/__preview/health')return send(res,200,{service:'localmockpreview',loopback:true,data:'in-memory-only'});
 if(p==='/auth/login'&&req.method==='POST'){const user=users[String(body.email||'').toLowerCase()];if(!user||body.password!==(user.role==='admin'?'admin123':'mozo123'))return send(res,401,{detail:'Credenciales demo inválidas'});return send(res,200,{access_token:'local-preview-token',token_type:'bearer',user});}
 if(p==='/auth/me'&&req.method==='GET')return send(res,200,users['mozo@resto.com']);
 if(p==='/public/restaurant'&&req.method==='GET')return send(res,200,{id:'local-restaurant',name:'Restaurante Demo',logo_url:null});
 if(p==='/restaurants/current'&&req.method==='GET')return send(res,200,{id:'local-restaurant',name:'Restaurante Demo'});
 if(p==='/branches'&&req.method==='GET')return send(res,200,[{id:'branch-local',name:'Sucursal Demo'}]);
 if(p==='/tables'&&req.method==='GET')return send(res,200,tables);
 if(p==='/categories'&&req.method==='GET')return send(res,200,categories);
 if(p==='/products'&&req.method==='GET')return send(res,200,products);
 if(p==='/orders'&&req.method==='POST'){const t=tables.find(x=>x.id===body.table_id);if(!t)return send(res,400,{detail:'Mesa demo no encontrada'});const o={id:`order-local-${orderSeq}`,order_number:orderSeq++,table_id:t.id,table_number:t.number,status:'borrador',order_type:'mesa',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),customer_name:'',items:[],total:0,amount_paid:0};orders.push(o);t.status='ocupada';t.active_order={id:o.id,status:o.status};return send(res,200,o);}
 if(p==='/orders'&&req.method==='GET'){let rows=orders;if(u.searchParams.has('table_id'))rows=rows.filter(o=>o.table_id===u.searchParams.get('table_id'));if(u.searchParams.get('active_only')==='true')rows=rows.filter(o=>!['pagado','cancelado','entregado'].includes(o.status));return send(res,200,rows);}
 const m=p.match(/^\/orders\/([^/]+)(.*)$/);
 if(m){const o=orders.find(x=>x.id===m[1]);if(!o)return send(res,404,{detail:'Pedido demo no encontrado'});const tail=m[2];
  if(!tail&&req.method==='GET')return send(res,200,o);
  if(tail==='/items'&&req.method==='POST'){const entries=Array.isArray(body)?body:[body];for(const entry of entries){const product=products.find(x=>x.id===entry.product_id);if(!product)return send(res,400,{detail:'Producto de preview no encontrado'});const quantity=Number(entry.quantity||1),unitPrice=Number(product.price||0);o.items.push({id:`item-local-${itemSeq++}`,product_id:product.id,product_name:product.name,quantity,unit_price:unitPrice,subtotal:quantity*unitPrice,status:'borrador',notes:entry.notes||''});}return send(res,200,sum(o));}
  const im=tail.match(/^\/items\/([^/]+)$/);if(im){const it=o.items.find(x=>x.id===im[1]);if(it&&req.method==='PATCH'){Object.assign(it,body);if(Object.hasOwn(body,'quantity'))it.subtotal=Number(it.quantity||0)*Number(it.unit_price||0);return send(res,200,sum(o));}if(it&&req.method==='DELETE'){o.items=o.items.filter(x=>x!==it);return send(res,200,sum(o));}}
  if(tail==='/send-to-kitchen'&&req.method==='POST'){o.items.forEach(i=>{if(i.status==='borrador')i.status='enviado_cocina'});o.status='enviado_cocina';const t=tables.find(x=>x.id===o.table_id);if(t){t.status='ocupada';t.active_order={id:o.id,status:o.status}}return send(res,200,sum(o));}
  if((tail==='/alias'||tail==='/notes')&&(req.method==='PATCH'||req.method==='PUT')){Object.assign(o,body);return send(res,200,o);}
  if(tail==='/close'&&req.method==='POST'){o.status='pagado';return send(res,200,o);}
  return send(res,200,o);
 }
 if(p==='/__preview/requests')return send(res,200,{mode:'local mock only'});
 return send(res,404,{detail:'Fuera del alcance de localmockpreview; no se reenvían solicitudes'});
});
const staticServer=http.createServer((req,res)=>{const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);let file=path.resolve(root,'.'+pathname);if(!file.startsWith(root)){res.writeHead(403);return res.end('forbidden');}if(!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(root,'index.html');if(!fs.existsSync(file)){res.writeHead(500);return res.end('Build missing');}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Preview-Mode':'localmockpreview'});fs.createReadStream(file).pipe(res);});
mockApi.listen(8000,'127.0.0.1',()=>console.log('MOCK_API_READY http://127.0.0.1:8000/api/__preview/health'));
staticServer.listen(3001,'127.0.0.1',()=>console.log('FRONTEND_READY http://127.0.0.1:3001/salon'));

