import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
await fs.mkdir('test-results',{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
try{
  const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
  const errors=[],failed=[],warnings=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')warnings.push(m.text());});
  page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/cc0/'))failed.push([r.status(),r.url()]);});
  await page.goto('http://localhost:5173/',{waitUntil:'networkidle',timeout:90000});
  await page.waitForFunction(()=>window.apex?.game,{timeout:90000});
  await page.evaluate(()=>window.apex.game.assets.ready);
  await page.waitForTimeout(1000);
  const initial=await page.evaluate(()=>{const g=window.apex.game;return {failures:g.assets.failures,models:[...g.assets.models.keys()],trees:g.scenery.children.filter(o=>o.isInstancedMesh).map(o=>({name:o.name,count:o.count})),kart:g.kart.body?.userData.cc0,environment:!!g.scene.environment,sky:!!g.scene.background?.isTexture,sun:g.assets.sunDirection.toArray(),render:g.renderer.info.render,memory:g.renderer.info.memory};});
  assert.deepEqual(initial.failures,[]);assert.equal(initial.models.length,8);assert.equal(initial.kart,true);assert.equal(initial.sky,true);assert.equal(initial.environment,true);assert.ok(initial.sun[1]>.35);
  console.log('initial',JSON.stringify(initial));
  await page.screenshot({path:'test-results/cc0-overview.png',timeout:90000});
  // Inspect the body and wheel alignment close up without UI driving the camera.
  await page.evaluate(()=>{const g=window.apex.game,p=g.kart.root.position;g.orbit.target.set(p.x,p.y+.25,p.z);g.camera.position.set(p.x+2.7,p.y+1.7,p.z-3.2);g.camera.near=.05;g.camera.updateProjectionMatrix();g.orbit.update();});
  await page.waitForTimeout(500);await page.screenshot({path:'test-results/cc0-kart.png'});
  await page.getByRole('button',{name:'上车试驾',exact:true}).click();
  await page.waitForFunction(()=>window.apex.running&&!window.apex.countingDown,{},{timeout:90000});
  await page.screenshot({path:'test-results/cc0-cockpit.png'});
  const cockpit=await page.evaluate(()=>({mode:window.apex.game.mode,hiddenHead:!window.apex.game.kart.head.visible,grounded:window.apex.physics.telemetry.grounded}));
  assert.equal(cockpit.mode,'cockpit');assert.equal(cockpit.hiddenHead,true);
  await page.keyboard.down('w');await page.waitForFunction(()=>window.apex.physics.telemetry.speed>6,{},{timeout:60000});await page.keyboard.up('w');
  const drive=await page.evaluate(()=>({speed:window.apex.physics.telemetry.speed,grounded:window.apex.physics.telemetry.grounded,finite:Number.isFinite(window.apex.physics.body.position.y)}));
  assert.equal(drive.finite,true);assert.ok(drive.speed>6);console.log('drive',JSON.stringify(drive));
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'返回工坊',exact:true}).click();
  await page.getByRole('button',{name:/FORMULA \/ 02/}).click();
  await page.waitForTimeout(500);
  await page.evaluate(()=>{const g=window.apex.game,p=g.kart.root.position;g.orbit.target.set(p.x,p.y+.3,p.z);g.camera.position.set(p.x+5,p.y+2.8,p.z-6);g.camera.near=.05;g.camera.updateProjectionMatrix();g.orbit.update();});
  await page.waitForTimeout(500);await page.screenshot({path:'test-results/cc0-rb20.png'});
  // Repeated scene rebuilds and switches must keep the shared PBR textures valid.
  const rebuilt=await page.evaluate(()=>{const a=window.apex,g=a.game;for(let i=0;i<3;i++)g.setTrack(a.track,{},g.terrain,false);let treeMeshes=0;g.scenery.traverse(o=>{if(o.name.startsWith('CC0 tree')||o.name.startsWith('CC0 pine'))treeMeshes++;});return {vehicle:a.physics.profile.id,treeMeshes,textures:g.renderer.info.memory.textures};});
  console.log('rebuilt',JSON.stringify(rebuilt));assert.equal(rebuilt.vehicle,'rb20');assert.ok(rebuilt.treeMeshes>0);
  await page.getByRole('button',{name:/KART \/ 01/}).click();await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>window.apex.game.kart.body.userData.cc0),true);
  await page.evaluate(()=>{const g=window.apex.game,Vector3=g.camera.position.constructor,Matrix4=g.camera.matrixWorld.constructor;let tree;g.scenery.traverse(o=>{if(!tree&&o.isInstancedMesh&&o.name==='CC0 tree_small_02')tree=o;});const m=new Matrix4();tree.getMatrixAt(0,m);const p=new Vector3().setFromMatrixPosition(m).applyMatrix4(tree.matrixWorld);g.orbit.target.set(p.x,p.y+4,p.z);g.camera.position.set(p.x+12,p.y+7,p.z+15);g.camera.near=.1;g.camera.updateProjectionMatrix();g.orbit.update();});
  await page.waitForTimeout(500);await page.screenshot({path:'test-results/cc0-trees.png'});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);await page.screenshot({path:'test-results/cc0-mobile.png'});
  console.log('browser',JSON.stringify({errors,failed,warnings,cockpit}));
  await fs.writeFile('test-results/cc0-browser-report.json',JSON.stringify({initial,cockpit,drive,rebuilt,errors,failed,warnings},null,2));
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);assert.ok(!warnings.some(w=>/shader error|WebGL.*INVALID|asset unavailable/i.test(w)));
}finally{await browser.close();}
