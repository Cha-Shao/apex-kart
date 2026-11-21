import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';

const project=path.resolve('.');
const out=path.join(project,'public','assets','vegetation','tree-billboards');
const chrome='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const names=['oak','ash','pine'],views=['front','side'];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function unusedPort(){
  return new Promise((resolve,reject)=>{
    const server=net.createServer();server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});
  });
}
const mime=file=>file.endsWith('.html')?'text/html; charset=utf-8':
  file.endsWith('.js')?'text/javascript':file.endsWith('.mjs')?'text/javascript':
  file.endsWith('.png')?'image/png':file.endsWith('.webp')?'image/webp':
  file.endsWith('.glb')?'model/gltf-binary':'application/octet-stream';
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    const filepath=path.resolve(project,'.'+decodeURIComponent(url.pathname));
    if(!filepath.startsWith(project+path.sep))throw Error('Forbidden path');
    const content=await fs.readFile(filepath);
    res.writeHead(200,{'Content-Type':mime(filepath),'Cache-Control':'no-store'});
    res.end(content);
  }catch(error){res.writeHead(404);res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const webPort=server.address().port,debugPort=await unusedPort();
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'apex-bake-chrome-'));
const chromeProcess=spawn(chrome,[
  '--headless=new','--no-first-run','--no-default-browser-check','--no-sandbox',
  '--disable-extensions','--disable-background-networking','--disable-dev-shm-usage',
  '--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl',
  '--remote-allow-origins=*','--remote-debugging-port='+debugPort,
  '--user-data-dir='+profile,'--window-size=1100,1100','about:blank'
],{stdio:'ignore',windowsHide:true});

let socket;
const pending=new Map();
let nextId=1;
const rpc=(method,params={})=>new Promise((resolve,reject)=>{
  const id=nextId++;
  pending.set(id,{resolve,reject});
  socket.send(JSON.stringify({id,method,params}));
});
async function evalJS(expression){
  const response=await rpc('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(response.exceptionDetails)throw Error(JSON.stringify(response.exceptionDetails.exception?.description??response.exceptionDetails.text));
  return response.result.value;
}
const timeout=async(operation,ms,name)=>Promise.race([
  operation,new Promise((_,reject)=>setTimeout(()=>reject(Error(name+' timed out')),ms))
]);
try{
  let target;
  for(let i=0;i<150;i++){
    try{
      const res=await fetch('http://127.0.0.1:'+debugPort+'/json/list');
      if(res.ok){
        const tabs=await res.json();
        target=tabs.find(t=>t.type==='page'&&t.webSocketDebuggerUrl);
        if(target)break;
      }
    }catch{}
    await sleep(100);
  }
  if(!target)throw Error('Headless Chrome CDP port never opened');
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await timeout(new Promise((resolve,reject)=>{
    socket.onopen=resolve;socket.onerror=reject;
  }),15000,'CDP socket');
  socket.onmessage=event=>{
    const msg=JSON.parse(event.data);
    const item=pending.get(msg.id);
    if(item){pending.delete(msg.id);msg.error?item.reject(Error(JSON.stringify(msg.error))):item.resolve(msg.result);}
  };
  socket.onerror=error=>{for(const item of pending.values())item.reject(error);pending.clear();};
  await rpc('Page.enable');
  await rpc('Runtime.enable');
  await rpc('Page.navigate',{url:'http://127.0.0.1:'+webPort+'/scripts/tree-billboard-bake.html'});
  let ready=false;
  for(let i=0;i<360;i++){
    try{
      const state=await evalJS('JSON.stringify({ready:window.__bakeReady,error:window.__bakeError})');
      const parsed=JSON.parse(state||'{}');
      if(parsed.error)throw Error(parsed.error);
      if(parsed.ready){ready=true;break;}
    }catch(err){if(/GLTF|WebGL|shader|texture|failed|404|fetch/i.test(err.message))throw err;}
    await sleep(150);
  }
  if(!ready)throw Error('GLTF loading or WebGL setup never became ready');
  await fs.mkdir(out,{recursive:true});
  const meta={version:1,source:'Original highest-detail oak.glb, ash.glb, pine.glb',views:'Orthographic +Z front, +X side',size:1024,trees:{}};
  for(const name of names){
    for(const view of views){
      const expression=`(async()=>JSON.stringify(await window.bakeTree(${JSON.stringify(name)},${JSON.stringify(view)})))()`;
      const payload=await timeout(evalJS(expression),30000,name+'/'+view);
      const result=JSON.parse(payload);
      if(!result.png.startsWith('data:image/png;base64,'))throw Error('No PNG for '+name+'/'+view);
      const buffer=Buffer.from(result.png.slice('data:image/png;base64,'.length),'base64');
      const filepath=path.join(out,name+'-'+view+'.png');
      await fs.writeFile(filepath,buffer);
      meta.trees[name]=result.bounds;
      console.log(name+'/'+view+': '+buffer.length+' bytes; bounds '+JSON.stringify(result.bounds));
    }
  }
  await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(meta,null,2)+'\n');
  console.log('Baked 6 transparent high-model PNGs into '+out);
}finally{
  for(const item of pending.values())item.reject(Error('baker closing'));
  if(socket&&socket.readyState===WebSocket.OPEN)socket.close();
  chromeProcess.kill();
  server.close();
  await fs.rm(profile,{force:true,recursive:true,maxRetries:3,retryDelay:100}).catch(()=>{});
}
