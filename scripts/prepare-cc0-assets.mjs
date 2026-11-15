import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {dedup, prune, weld, simplify, simplifyPrimitive, textureCompress} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';
import sharp from 'sharp';
import {execFileSync} from 'node:child_process';
import {Matrix3,Vector3} from 'three';

// Source downloads stay out of the shipping bundle. Only processed CC0 assets ship.
const cache='test-results/asset-source', output='public/assets/cc0';
await fs.mkdir(cache,{recursive:true}); await fs.mkdir(output,{recursive:true});
try{await fs.access(`${cache}/Models/GLB format/kart-oopi.glb`);}catch{
  const response=await fetch('https://kenney.nl/download-link/6173736574732f6361722d6b6974',{headers:{Referer:'https://kenney.nl/assets/car-kit','X-Requested-With':'XMLHttpRequest'}});
  if(!response.ok)throw Error('Kenney download link unavailable');
  const {url}=await response.json();await download({url},`${cache}/kenney_car-kit.zip`);
  execFileSync('tar',['-xf',`${cache}/kenney_car-kit.zip`,'-C',cache,'Models/GLB format/kart-oopi.glb','Models/GLB format/sedan-sports.glb','Models/GLB format/truck.glb','Models/GLB format/cone.glb','Models/GLB format/Textures/colormap.png','License.txt']);
}
const records=[];
async function download(file,dest){
  try{const data=await fs.readFile(dest);if(!file.md5||createHash('md5').update(data).digest('hex')===file.md5)return;}catch{}
  let response;
  for(let attempt=0;attempt<4;attempt++){
    try{response=await fetch(file.url);if(response.ok)break;throw Error(`${response.status}: ${file.url}`);}catch(error){if(attempt===3)throw error;}
  }
  const data=Buffer.from(await response.arrayBuffer());
  if(file.md5&&createHash('md5').update(data).digest('hex')!==file.md5)throw Error(`Checksum mismatch: ${dest}`);
  await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,data);
}
async function metadata(id){
  const file=`${cache}/${id}.json`;
  try{return JSON.parse(await fs.readFile(file));}catch{}
  const response=await fetch(`https://api.polyhaven.com/files/${id}`);if(!response.ok)throw Error(`Asset not found: ${id}`);
  const data=await response.json();await fs.writeFile(file,JSON.stringify(data));return data;
}
function record(id,files,changes){records.push({id,source:`https://polyhaven.com/a/${id}`,license:'CC0-1.0',licenseUrl:'https://polyhaven.com/license',files,changes});}

// Preserve every leaf's placement and UVs. Collapsing tiny disconnected leaves
// with a global simplifier otherwise strips the canopy before the trunk.
function leafCards(primitive){
  const positions=primitive.getAttribute('POSITION'),uv=primitive.getAttribute('TEXCOORD_0'),indices=primitive.getIndices().getArray(),count=positions.getCount(),parent=Uint32Array.from({length:count},(_,i)=>i);
  const find=i=>{while(i!==parent[i]){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  for(let i=0;i<indices.length;i+=3){parent[find(indices[i+1])]=find(indices[i]);parent[find(indices[i+2])]=find(indices[i]);}
  const components=new Map();for(let i=0;i<count;i++){const key=find(i),list=components.get(key)??[];list.push(i);components.set(key,list);}
  const cards=[];
  for(const vertices of components.values()){
    let uu=0,vv=0,uvs=0,u=0,v=0,minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity;const sums=[new Vector3(),new Vector3(),new Vector3()];
    for(const index of vertices){const [a,b]=uv.getElement(index,[]),p=new Vector3().fromArray(positions.getElement(index,[]));uu+=a*a;vv+=b*b;uvs+=a*b;u+=a;v+=b;minU=Math.min(minU,a);maxU=Math.max(maxU,a);minV=Math.min(minV,b);maxV=Math.max(maxV,b);sums[0].addScaledVector(p,a);sums[1].addScaledVector(p,b);sums[2].add(p);}
    const inverse=new Matrix3().set(uu,uvs,u,uvs,vv,v,u,v,vertices.length);if(Math.abs(inverse.determinant())<1e-12)continue;inverse.invert();
    const fit=[0,1,2].map(axis=>new Vector3(sums[0].getComponent(axis),sums[1].getComponent(axis),sums[2].getComponent(axis)).applyMatrix3(inverse));
    const tex=[[minU,minV],[maxU,minV],[maxU,maxV],[minU,maxV]],points=tex.map(([a,b])=>new Vector3(...fit.map(f=>f.x*a+f.y*b+f.z))),center=points.reduce((sum,p)=>sum.add(p),new Vector3()).multiplyScalar(.25);
    cards.push({tex,points,center});
  }
  return cards;
}
function setCards(document,primitive,cards,stride=1,scale=1){
  const p=[],n=[],uv=[],indices=[],buffer=document.getRoot().listBuffers()[0];
  for(let i=0;i<cards.length;i+=stride){const card=cards[i],base=p.length/3,normal=new Vector3().crossVectors(card.points[1].clone().sub(card.points[0]),card.points[3].clone().sub(card.points[0])).normalize();
    card.points.forEach((point,j)=>{p.push(...point.clone().sub(card.center).multiplyScalar(scale).add(card.center).toArray());n.push(...normal.toArray());uv.push(...card.tex[j]);});indices.push(base,base+1,base+2,base,base+2,base+3);
  }
  for(const semantic of primitive.listSemantics())primitive.setAttribute(semantic,null);
  for(const [semantic,type,array] of [['POSITION','VEC3',p],['NORMAL','VEC3',n],['TEXCOORD_0','VEC2',uv]])primitive.setAttribute(semantic,document.createAccessor().setType(type).setArray(new Float32Array(array)).setBuffer(buffer));
  primitive.setIndices(document.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(buffer));
}

for(const id of ['clean_asphalt','concrete_layers_02','corrugated_iron','fabric_pattern_07','rubber_tiles']){
  const data=await metadata(id),files=[];
  const channels={color:data.Diffuse??data.col_1,normal:data.nor_gl,roughness:data.Rough};
  for(const [channel,variants] of Object.entries(channels)){
    const file=variants['1k'].jpg,source=`${cache}/${id}-${channel}.jpg`,target=`${id}-${channel}.webp`;
    await download(file,source);
    await sharp(source).resize(1024,1024,{fit:'inside'}).webp({quality:channel==='normal'?92:86}).toFile(`${output}/${target}`);files.push(target);
  }
  record(id,files,'1K source PBR maps converted to WebP; no baked lighting.'); console.log('material',id);
}
await download({url:'https://ambientcg.com/get?file=Grass001_1K-JPG.zip'},`${cache}/Grass001_1K-JPG.zip`);
execFileSync('tar',['-xf',`${cache}/Grass001_1K-JPG.zip`,'-C',cache,'Grass001_1K-JPG_Color.jpg','Grass001_1K-JPG_NormalGL.jpg','Grass001_1K-JPG_Roughness.jpg']);
for(const [channel,name] of Object.entries({color:'Color',normal:'NormalGL',roughness:'Roughness'}))await sharp(`${cache}/Grass001_1K-JPG_${name}.jpg`).webp({quality:channel==='normal'?92:86}).toFile(`${output}/grass-${channel}.webp`);
records.push({id:'Grass001',source:'https://ambientcg.com/view?id=Grass001',license:'CC0-1.0',licenseUrl:'https://docs.ambientcg.com/license/',files:['grass-color.webp','grass-normal.webp','grass-roughness.webp'],changes:'1K JPG PBR maps converted to WebP; OpenGL normal orientation.'});
const sky='kloofendal_48d_partly_cloudy_puresky',skyData=await metadata(sky);
await download(skyData.hdri['2k'].hdr,`${output}/sunny-sky.hdr`);
record(sky,['sunny-sky.hdr'],'2K linear HDR panorama used for sky and image based lighting.');

const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;
for(const id of ['tree_small_02','pine_sapling_small']){
  const data=await metadata(id),file=data.gltf['1k'].gltf,dir=`${cache}/${id}`;
  await download(file,`${dir}/source.gltf`);
  await Promise.all(Object.entries(file.include).map(([name,f])=>download(f,`${dir}/${name}`)));
  const document=await io.read(`${dir}/source.gltf`);
  let foliage,cards;
  if(id==='tree_small_02'){
    foliage=document.getRoot().listMeshes()[0].listPrimitives().find(p=>p.getMaterial().getName().includes('leaves'));cards=leafCards(foliage);setCards(document,foliage,cards);
    const alpha=data.leaves_alpha['1k'].png;await download(alpha,`${dir}/leaves-alpha.png`);
    const image=await sharp(foliage.getMaterial().getBaseColorTexture().getImage()).joinChannel(await sharp(`${dir}/leaves-alpha.png`).greyscale().toBuffer()).webp({quality:88}).toBuffer();
    foliage.getMaterial().getBaseColorTexture().setImage(image).setMimeType('image/webp');foliage.getMaterial().setAlphaMode('MASK').setAlphaCutoff(.45).setDoubleSided(true);
  }
  // Pine source has three full trees. One variant is sufficient; instances supply variety.
  if(id==='pine_sapling_small'){
    const scene=document.getRoot().listScenes()[0];
    for(const node of scene.listChildren().slice(1))node.dispose();
    scene.listChildren()[0].setTranslation([0,0,0]);
  }
  await document.transform(prune(),dedup(),weld());
  for(const mesh of document.getRoot().listMeshes())for(const primitive of mesh.listPrimitives())if(primitive!==foliage)simplifyPrimitive(primitive,{simplifier:MeshoptSimplifier,ratio:.12,error:.012});
  await document.transform(textureCompress({encoder:sharp,targetFormat:'webp',resize:[1024,1024]}),prune());
  const triangles=document.getRoot().listMeshes().reduce((sum,m)=>sum+m.listPrimitives().reduce((s,p)=>s+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0),0);
  await io.write(`${output}/${id}.glb`,document);
  if(foliage){setCards(document,foliage,cards,16,2.4);for(const mesh of document.getRoot().listMeshes())for(const primitive of mesh.listPrimitives())if(primitive!==foliage)simplifyPrimitive(primitive,{simplifier:MeshoptSimplifier,ratio:.1,error:.06});await document.transform(prune());}
  else await document.transform(simplify({simplifier:MeshoptSimplifier,ratio:.12,error:.06}),prune());
  await io.write(`${output}/${id}-far.glb`,document);
  record(id,[`${id}.glb`,`${id}-far.glb`],`Near model has ${triangles} triangles. Broadleaf keeps source leaf placement and UVs on alpha cards, with 1-in-16 enlarged leaves at distance; pine has a separately simplified far LOD and uses one supplied variant. 1K embedded WebP textures.`);console.log('tree',id,triangles);
}
// Kenney's archive uses external palette textures even for its GLB files.
// Re-export to embed the palette and bake the kart's palette into PBR material groups.
for(const name of ['kart-oopi','sedan-sports','truck','cone']){
  const document=await io.read(`${cache}/Models/GLB format/${name}.glb`);
  if(name==='kart-oopi'){
    const root=document.getRoot(),buffer=root.listBuffers()[0];
    const {data,info}=await sharp(root.listTextures()[0].getImage()).raw().toBuffer({resolveWithObject:true});
    const materials=Object.fromEntries(['paint','rubber','alloy','trim'].map(kind=>[kind,document.createMaterial(`kart-${kind}`).setBaseColorFactor(kind==='paint'?[1,1,1,1]:kind==='rubber'?[.025,.028,.032,1]:kind==='alloy'?[.4,.43,.47,1]:[.055,.06,.065,1]).setMetallicFactor(kind==='alloy'?.82:0).setRoughnessFactor(kind==='rubber'?.95:kind==='paint'?.3:.45)]));
    for(const node of root.listNodes()){
      if(node.getName()==='character'){node.dispose();continue;}
      const mesh=node.getMesh();if(!mesh)continue;
      for(const primitive of [...mesh.listPrimitives()]){
        const positions=primitive.getAttribute('POSITION'),normals=primitive.getAttribute('NORMAL'),uv=primitive.getAttribute('TEXCOORD_0'),indices=primitive.getIndices(),groups={};
        for(let i=0;i<indices.getCount();i+=3){
          const ids=[indices.getScalar(i),indices.getScalar(i+1),indices.getScalar(i+2)],tex=uv.getElement(ids[0],[]),x=Math.max(0,Math.min(info.width-1,Math.floor(tex[0]*info.width))),y=Math.max(0,Math.min(info.height-1,Math.floor(tex[1]*info.height))),off=(y*info.width+x)*info.channels,[r,g,b]=data.slice(off,off+3);
          const kind=node.getName().startsWith('wheel')?(r<85?'rubber':'alloy'):(g>r*1.3&&g>b*1.05?'paint':r>110&&b>r?'alloy':r>220?'paint':'trim');
          const group=groups[kind]??=( {p:[],n:[],uv:[]} );
          for(const id of ids){group.p.push(...positions.getElement(id,[]));group.n.push(...normals.getElement(id,[]));group.uv.push(...uv.getElement(id,[]));}
        }
        mesh.removePrimitive(primitive);primitive.dispose();
        for(const [kind,g] of Object.entries(groups))mesh.addPrimitive(document.createPrimitive().setAttribute('POSITION',document.createAccessor().setType('VEC3').setArray(new Float32Array(g.p)).setBuffer(buffer)).setAttribute('NORMAL',document.createAccessor().setType('VEC3').setArray(new Float32Array(g.n)).setBuffer(buffer)).setAttribute('TEXCOORD_0',document.createAccessor().setType('VEC2').setArray(new Float32Array(g.uv)).setBuffer(buffer)).setMaterial(materials[kind]));
      }
    }
  }
  await document.transform(dedup(),prune());await io.write(`${output}/${name}.glb`,document);
}
await fs.copyFile(`${cache}/License.txt`,`${output}/Kenney-License.txt`);
records.push({id:'kenney-car-kit',source:'https://kenney.nl/assets/car-kit',license:'CC0-1.0',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/',files:['kart-oopi.glb','sedan-sports.glb','truck.glb','cone.glb','Kenney-License.txt'],changes:'Kart character removed to retain the game driver and cockpit. Palette split into paint, alloy, rubber and trim. Palette textures embedded for scenery vehicles.'});
await fs.writeFile(`${output}/manifest.json`,JSON.stringify({license:'CC0-1.0',assets:records},null,2)+'\n');
console.log('CC0 assets ready');
