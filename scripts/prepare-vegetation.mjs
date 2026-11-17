import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import * as THREE from 'three';
import {Document,NodeIO} from '@gltf-transform/core';
import {dedup,prune,weld,simplifyPrimitive} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';
import sharp from 'sharp';

// Offline authoring only: the generator and source archive never ship.
const VERSION='1.1.0',INTEGRITY='6pvS6hD6B6h00dm0SnkgYeT4ABU5Y1Z9M44p1tXiV5C0eKrQy2sKECXshoaUv0qAOqYVL68w/PwadUxDFDiHUg==';
const TYPES=[{id:'oak',height:11,seed:35729},{id:'ash',height:10.5,seed:36330},{id:'pine',height:12.5,seed:13977}];

async function sourcePackage(cache){
  const dir=path.resolve(cache,'ez-tree'),archive=path.join(dir,'source.tgz');await fs.mkdir(dir,{recursive:true});
  let bytes;try{bytes=await fs.readFile(archive);}catch{}
  if(!bytes||createHash('sha512').update(bytes).digest('base64')!==INTEGRITY){
    const response=await fetch(`https://registry.npmjs.org/@dgreenheck/ez-tree/-/ez-tree-${VERSION}.tgz`);if(!response.ok)throw Error(`EZ-Tree download: ${response.status}`);
    bytes=Buffer.from(await response.arrayBuffer());if(createHash('sha512').update(bytes).digest('base64')!==INTEGRITY)throw Error('EZ-Tree checksum mismatch');await fs.writeFile(archive,bytes);
  }
  execFileSync('tar',['-xf',archive,'-C',dir,'package/LICENSE','package/build/ez-tree.es.js','package/src/lib/presets','package/src/lib/assets']);
  // Node authors geometry without a DOM. Sharp embeds the actual textures below.
  const load=THREE.TextureLoader.prototype.load;let Tree;
  try{THREE.TextureLoader.prototype.load=function(){return new THREE.Texture();};({Tree}=await import(pathToFileURL(path.join(dir,'package/build/ez-tree.es.js')).href));}
  finally{THREE.TextureLoader.prototype.load=load;}
  return {Tree,dir:path.join(dir,'package')};
}

async function texture(document,file,name,size,color=true){
  const image=await sharp(file).resize(size,size,{fit:'inside'}).webp({quality:color?85:92,alphaQuality:100}).toBuffer();
  return document.createTexture(name).setImage(image).setMimeType('image/webp');
}

function accessor(document,buffer,type,array){return document.createAccessor().setType(type).setArray(array).setBuffer(buffer);}

function barkPrimitive(document,buffer,geometry,scale,uvScale){
  const position=new Float32Array(geometry.attributes.position.array),uv=new Float32Array(geometry.attributes.uv.array);
  for(let i=0;i<position.length;i++)position[i]*=scale;
  for(let i=0;i<uv.length;i+=2){uv[i]*=uvScale.x;uv[i+1]=1-uv[i+1]/uvScale.y;}
  return document.createPrimitive()
    .setAttribute('POSITION',accessor(document,buffer,'VEC3',position))
    .setAttribute('NORMAL',accessor(document,buffer,'VEC3',new Float32Array(geometry.attributes.normal.array)))
    .setAttribute('TEXCOORD_0',accessor(document,buffer,'VEC2',uv))
    .setIndices(accessor(document,buffer,'SCALAR',new Uint16Array(geometry.index.array)));
}

function leafPrimitive(document,buffer,geometry,scale,level){
  const source=geometry.attributes.position.array,sourceUv=geometry.attributes.uv.array,sourceNormal=geometry.attributes.normal.array,positions=[],normals=[],uvs=[],occlusion=[],indices=[];
  geometry.computeBoundingBox();const bounds=geometry.boundingBox,center=bounds.getCenter(new THREE.Vector3()),extent=bounds.getSize(new THREE.Vector3());
  const stride=[1,2,4][level],enlargement=[1,1.18,1.42][level],groups=source.length/24;
  // Keep crossed leaf-cluster pairs together and retain deterministic anchors.
  for(let group=0;group<groups;group+=stride){
    const start=group*8,anchor=new THREE.Vector3();for(let j=0;j<8;j++)anchor.add(new THREE.Vector3().fromArray(source,(start+j)*3));anchor.multiplyScalar(1/8);
    const radial=anchor.clone().sub(center).divide(new THREE.Vector3(Math.max(extent.x,.1),Math.max(extent.y,.1),Math.max(extent.z,.1))),height=(anchor.y-bounds.min.y)/Math.max(extent.y,.1);
    const access=Math.min(1,.6+.22*Math.min(1,radial.length()*2)+.16*height);radial.normalize();
    const base=positions.length/3;
    for(let j=0;j<8;j++){
      const i=start+j,p=new THREE.Vector3().fromArray(source,i*3).sub(anchor).multiplyScalar(enlargement).add(anchor).multiplyScalar(scale),normal=new THREE.Vector3().fromArray(sourceNormal,i*3);
      normal.multiplyScalar(.25).addScaledVector(radial,.75).normalize();positions.push(...p.toArray());normals.push(...normal.toArray());uvs.push(sourceUv[i*2],1-sourceUv[i*2+1]);occlusion.push(access);
    }
    for(const offset of [0,4]){const i=base+offset;indices.push(i,i+1,i+2,i,i+2,i+3);}
  }
  return document.createPrimitive()
    .setAttribute('POSITION',accessor(document,buffer,'VEC3',new Float32Array(positions)))
    .setAttribute('NORMAL',accessor(document,buffer,'VEC3',new Float32Array(normals)))
    .setAttribute('TEXCOORD_0',accessor(document,buffer,'VEC2',new Float32Array(uvs)))
    .setAttribute('_CANOPY_OCCLUSION',accessor(document,buffer,'SCALAR',new Float32Array(occlusion)))
    .setIndices(accessor(document,buffer,'SCALAR',new Uint16Array(indices)));
}

export async function prepareVegetation({cache='test-results/asset-source',output='public/assets/vegetation'}={}){
  const {Tree,dir}=await sourcePackage(cache),io=new NodeIO(),records=[];await fs.mkdir(output,{recursive:true});await MeshoptSimplifier.ready;
  await fs.copyFile(path.join(dir,'LICENSE'),path.join(output,'EZ-Tree-LICENSE.txt'));
  for(const {id,height,seed} of TYPES){
    const preset=JSON.parse(await fs.readFile(path.join(dir,`src/lib/presets/${id}_medium.json`)));
    preset.seed=seed;preset.leaves.count=id==='pine'?16:12;
    if(id==='pine'){preset.branch.children[0]=56;preset.branch.sections[1]=6;preset.branch.segments[1]=4;}
    else {preset.branch.children[0]=id==='oak'?5:6;preset.branch.children[1]=3;preset.branch.sections[0]=10;preset.branch.sections[1]=6;preset.branch.sections[2]=4;preset.branch.sections[3]=2;preset.branch.segments[0]=10;preset.branch.segments[1]=6;preset.branch.segments[2]=4;preset.branch.segments[3]=3;}
    const tree=new Tree();tree.loadFromJson(preset);const bounds=new THREE.Box3().setFromObject(tree),scale=height/(bounds.max.y-bounds.min.y),files=[],lods=[];
    for(const [level,suffix] of ['','-mid','-far'].entries()){
      const document=new Document(),buffer=document.createBuffer(),bark=barkPrimitive(document,buffer,tree.branchesMesh.geometry,scale,preset.bark.textureScale),leaves=leafPrimitive(document,buffer,tree.leavesMesh.geometry,scale,level);
      const barkMaterial=document.createMaterial(`${id}-bark`).setMetallicFactor(0).setRoughnessFactor(.94)
        .setBaseColorTexture(await texture(document,path.join(dir,'src/lib/assets/bark/oak_color_1k.jpg'),'oak-bark-color',512))
        .setNormalTexture(await texture(document,path.join(dir,'src/lib/assets/bark/oak_normal_1k.jpg'),'oak-bark-normal',256,false)).setNormalScale(.5);
      const leafMaterial=document.createMaterial(`${id}-leaves`).setMetallicFactor(0).setRoughnessFactor(1).setAlphaMode('MASK').setAlphaCutoff(.45).setDoubleSided(true)
        .setBaseColorTexture(await texture(document,path.join(dir,`src/lib/assets/leaves/${id}_color.png`),`${id}-leaf-cluster`,512));
      bark.setMaterial(barkMaterial);leaves.setMaterial(leafMaterial);
      const root=document.createNode(id);for(const [name,primitive] of [['bark',bark],['leaves',leaves]])root.addChild(document.createNode(`${id}-${name}`).setMesh(document.createMesh(`${id}-${name}`).addPrimitive(primitive)));document.createScene(id).addChild(root);
      await document.transform(weld());
      const count=bark.getIndices().getCount()/3;simplifyPrimitive(bark,{simplifier:MeshoptSimplifier,ratio:Math.min(1,[1800,650,220][level]/count),error:[.006,.02,.06][level]});
      await document.transform(dedup(),prune());
      const triangles=document.getRoot().listMeshes().reduce((sum,m)=>sum+m.listPrimitives().reduce((s,p)=>s+p.getIndices().getCount()/3,0),0),bytes=await io.writeBinary(document),file=`${id}${suffix}.glb`;
      if(bytes.byteLength>1024*1024)throw Error(`${file} exceeds the 1 MiB web asset budget (${bytes.byteLength} bytes)`);
      await fs.writeFile(path.join(output,file),bytes);files.push(file);lods.push({file,bytes:bytes.byteLength,triangles});
    }
    records.push({id,source:'https://github.com/dgreenheck/ez-tree',version:VERSION,author:'Daniel Greenheck',license:'MIT',licenseFile:'EZ-Tree-LICENSE.txt',files,height,seed,lods,changes:'Offline low-poly EZ-Tree preset. Natural branching and photographic alpha leaf clusters; 512px colour and 256px bark normals. Paired leaf cards and shared anchors across LODs. Generator and source archive are not shipped.'});console.log(id,lods);
  }
  const manifest={license:'MIT; bark textures CC0-1.0',assets:records,barkSource:{url:'https://polyhaven.com/a/bark_brown_02',license:'CC0-1.0'},budgets:{maxGlbBytes:1024*1024,colorTextureSize:512,barkNormalSize:256}};
  await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');return records;
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)await prepareVegetation();
