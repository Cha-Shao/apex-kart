import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {dedup, prune} from '@gltf-transform/functions';
import sharp from 'sharp';
import {execFileSync} from 'node:child_process';
import {prepareVegetation} from './prepare-vegetation.mjs';

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
await prepareVegetation({cache});
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
