import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Document,NodeIO} from '@gltf-transform/core';
import {dedup,prune,weld,simplifyPrimitive} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';
import sharp from 'sharp';
import * as THREE from 'three';
import {groundcoverPatches,rgbaPixels} from './groundcover-patches.mjs';

// Artist-authored photographic cutouts and small-plant meshes, prepared offline.
const SOURCES=[
  {id:'grass_medium_01',variants:[]},
  {id:'shrub_sorrel_01',variants:[['weed-a','shrub_sorrel_01_b',.16,350,110],['weed-b','shrub_sorrel_01_a',.18,320,100]]},
  {id:'shrub_02',variants:[['shrub-a','shrub_02_a',1.1,2600,650],['shrub-b','shrub_02_b',.85,2200,600]]},
];
const hash=bytes=>createHash('md5').update(bytes).digest('hex');
async function download(url){
  let last;
  for(let attempt=0;attempt<4;attempt++){
    try{const response=await fetch(url);if(!response.ok)throw Error(`${response.status}: ${url}`);return Buffer.from(await response.arrayBuffer());}
    catch(error){last=error;}
  }
  throw last;
}
async function cached(file,descriptor){
  let bytes;try{bytes=await fs.readFile(file);}catch{}
  if(!bytes||descriptor.md5&&hash(bytes)!==descriptor.md5){
    bytes=await download(descriptor.url);
    if(descriptor.md5&&hash(bytes)!==descriptor.md5)throw Error(`Source checksum mismatch: ${descriptor.url}`);
    await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);
  }
  return bytes;
}
function accessor(document,buffer,type,array){return document.createAccessor().setType(type).setArray(array).setBuffer(buffer);}

export async function prepareGroundcover({cache='test-results/asset-source/groundcover',output='public/assets/vegetation'}={}){
  await fs.mkdir(cache,{recursive:true});await fs.mkdir(output,{recursive:true});await MeshoptSimplifier.ready;
  const io=new NodeIO(),document=new Document(),buffer=document.createBuffer(),scene=document.createScene('groundcover'),records=[];let meadow;
  for(const {id,variants} of SOURCES){
    // Cache the source manifest as the asset lock; recorded hashes also ship
    // in the provenance manifest so a rebuild does not silently change it.
    const metadataFile=path.join(cache,`${id}-files.json`);let metadata;
    try{metadata=JSON.parse(await fs.readFile(metadataFile,'utf8'));}
    catch{metadata=JSON.parse(await download(`https://api.polyhaven.com/files/${id}`));await fs.writeFile(metadataFile,JSON.stringify(metadata,null,2));}
    if(id==='grass_medium_01'){
      meadow=await groundcoverPatches({document,buffer,scene,metadata,cache,cached});
      const record={id,url:`https://polyhaven.com/a/${id}`,license:'CC0-1.0',sourceFiles:meadow.sourceFiles,variants:meadow.grassVariants};
      records.push(record);console.log(id,record.variants);continue;
    }
    const descriptor=metadata.gltf['1k'].gltf,resources={},sourceJson=JSON.parse(await cached(path.join(cache,id,'source.gltf'),descriptor));
    for(const [uri,file] of Object.entries(descriptor.include))resources[uri]=await cached(path.join(cache,id,uri),file);
    const source=await io.readJSON({json:sourceJson,resources});
    const diffuse=resources[`textures/${id}_diff_1k.jpg`],alphaFile=metadata.Alpha['1k'].png;
    const alpha=await cached(path.join(cache,id,'alpha.png'),alphaFile);
    const mask=await sharp(alpha).resize(1024,1024).removeAlpha().toColourspace('b-w').raw().toBuffer();
    const rgb=await sharp(diffuse).resize(1024,1024).removeAlpha().raw().toBuffer();
    const rgba=await sharp(rgbaPixels(rgb,mask),{raw:{width:1024,height:1024,channels:4}}).webp({quality:88,alphaQuality:100}).toBuffer();
    const normal=await sharp(resources[`textures/${id}_nor_gl_1k.jpg`]).resize(512,512).webp({quality:94}).toBuffer();
    const arm=await sharp(resources[`textures/${id}_arm_1k.jpg`]).resize(512,512).webp({quality:92}).toBuffer();
    const colorTexture=document.createTexture(`${id}-rgba`).setImage(rgba).setMimeType('image/webp');
    const normalTexture=document.createTexture(`${id}-normal`).setImage(normal).setMimeType('image/webp');
    const armTexture=document.createTexture(`${id}-arm`).setImage(arm).setMimeType('image/webp');
    const material=document.createMaterial(`${id}-groundcover`).setBaseColorTexture(colorTexture).setNormalTexture(normalTexture).setNormalScale(.5)
      .setMetallicFactor(0).setRoughnessFactor(1).setMetallicRoughnessTexture(armTexture).setOcclusionTexture(armTexture)
      .setAlphaMode('MASK').setAlphaCutoff(.4).setDoubleSided(true);
    const record={id,url:`https://polyhaven.com/a/${id}`,license:'CC0-1.0',sourceFiles:[descriptor,...Object.values(descriptor.include),alphaFile].map(({url,md5})=>({url,md5})),variants:[]};
    for(const [name,nodeName,height,nearBudget,farBudget] of variants){
      const node=source.getRoot().listNodes().find(node=>node.getName()===nodeName);
      if(!node?.getMesh())throw Error(`Missing source mesh: ${nodeName}`);
      const primitive=node.getMesh().listPrimitives()[0],position=primitive.getAttribute('POSITION'),matrix=new THREE.Matrix4().fromArray(node.getWorldMatrix());
      matrix.setPosition(0,0,0); // Remove the artist's side-by-side display layout.
      const normalMatrix=new THREE.Matrix3().getNormalMatrix(matrix),positions=new Float32Array(position.getCount()*3),normals=new Float32Array(positions.length),p=new THREE.Vector3(),box=new THREE.Box3();
      for(let i=0;i<position.getCount();i++){p.fromArray(position.getArray(),i*3).applyMatrix4(matrix);p.toArray(positions,i*3);box.expandByPoint(p);}
      const scale=height/(box.max.y-box.min.y),center=box.getCenter(new THREE.Vector3()),sourceNormals=primitive.getAttribute('NORMAL').getArray();
      for(let i=0;i<position.getCount();i++){
        positions[i*3]=(positions[i*3]-center.x)*scale;positions[i*3+1]=(positions[i*3+1]-box.min.y)*scale;positions[i*3+2]=(positions[i*3+2]-center.z)*scale;
        p.fromArray(sourceNormals,i*3).applyNormalMatrix(normalMatrix).toArray(normals,i*3);
      }
      for(const [level,budget] of [nearBudget,farBudget].entries()){
        const geometry=document.createPrimitive().setMaterial(material)
          .setAttribute('POSITION',accessor(document,buffer,'VEC3',positions.slice()))
          .setAttribute('NORMAL',accessor(document,buffer,'VEC3',normals.slice()))
          .setAttribute('TEXCOORD_0',accessor(document,buffer,'VEC2',new Float32Array(primitive.getAttribute('TEXCOORD_0').getArray())))
          .setIndices(accessor(document,buffer,'SCALAR',new Uint32Array(primitive.getIndices().getArray())));
        const triangles=geometry.getIndices().getCount()/3;
        simplifyPrimitive(geometry,{simplifier:MeshoptSimplifier,ratio:Math.min(1,budget/triangles),error:level===0?.008:.035});
        const key=`${name}-${level===0?'near':'far'}`;
        scene.addChild(document.createNode(key).setMesh(document.createMesh(key).addPrimitive(geometry)));
        record.variants.push({name:key,sourceNode:nodeName,height,triangles:geometry.getIndices().getCount()/3});
      }
    }
    records.push(record);console.log(id,record.variants);
  }
  await document.transform(weld(),dedup(),prune());
  const bytes=await io.writeBinary(document);await fs.writeFile(path.join(output,'groundcover.glb'),bytes);
  await fs.writeFile(path.join(output,'groundcover-manifest.json'),JSON.stringify({license:'CC0-1.0',file:'groundcover.glb',bytes:bytes.length,changes:'Connected grass colonies assembled at runtime from dense high/low tufts of 4.5-6.5cm two-face cards. Each tuft fits narrow verges independently, with no random thinning inside a tuft. Moderate authored height differences and partial low-grass skirts. Root UV padding is trimmed; shared anchors and bends across mesh LODs; artist-authored weeds and shrubs retained.',sources:records,meadow},null,2)+'\n');
  await fs.writeFile(path.join(output,'Poly-Haven-LICENSE.txt'),'Groundcover models and textures from Poly Haven.\nLicense: CC0 1.0 Universal (public domain dedication).\nhttps://polyhaven.com/license\nhttps://creativecommons.org/publicdomain/zero/1.0/\nIndividual asset links and source checksums: groundcover-manifest.json\n');
  console.log(`groundcover.glb: ${(bytes.length/1024/1024).toFixed(2)} MiB`);
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)await prepareGroundcover();
