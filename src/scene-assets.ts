import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js';
import {stochasticSurface,tyreMaterial,asphaltAggregateTexture,grassReliefTexture,gravelMaterial,paintedSurface,type RoadWearUniforms} from './surface-materials';
import {roadWearTexture} from './road-wear';
import type {TrackData} from './track';

const BASE='/assets/cc0/';
/** UVs in metres keep road/ground texture scale identical across every circuit. */
export function surfaceUVs(geometry:THREE.BufferGeometry,metres:number){
  const positions=geometry.getAttribute('position'),uv=new Float32Array(positions.count*2);
  for(let i=0;i<positions.count;i++){uv[i*2]=positions.getX(i)/metres;uv[i*2+1]=positions.getZ(i)/metres;}
  geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));return geometry;
}
export function disposeSceneGroup(group:THREE.Group){
  const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
  group.traverse(object=>{
    if(!(object instanceof THREE.Mesh))return;
    if(!object.geometry.userData.sharedCC0)geometries.add(object.geometry);
    if(object instanceof THREE.InstancedMesh)object.dispose();
    for(const material of Array.isArray(object.material)?object.material:[object.material]){
      if(material.userData.sharedCC0)continue;materials.add(material);
      for(const value of Object.values(material))if(value instanceof THREE.Texture&&!value.userData.sharedCC0)textures.add(value);
    }
  });
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());group.clear();
}

/** One shared resource bank; track edits never dispose textures still in use. */
export class SceneAssets {
  readonly textures=new Map<string,THREE.Texture>();
  readonly models=new Map<string,THREE.Group>();
  readonly failures:string[]=[];
  readonly ready:Promise<void>;
  readonly grass:THREE.MeshStandardMaterial;
  readonly asphalt:THREE.MeshStandardMaterial;
  readonly runoff:THREE.MeshStandardMaterial;
  readonly gravel:THREE.MeshStandardMaterial;
  readonly concrete:THREE.MeshStandardMaterial;
  readonly roof:THREE.MeshStandardMaterial;
  readonly paint=new THREE.MeshPhysicalMaterial({color:0xc4ed4c,metalness:.12,roughness:.27,clearcoat:1,clearcoatRoughness:.18});
  readonly rubber:THREE.MeshStandardMaterial;
  readonly alloy:THREE.MeshStandardMaterial;
  readonly fabric:THREE.MeshStandardMaterial;
  readonly carbon:THREE.MeshStandardMaterial;
  readonly kerb:THREE.MeshStandardMaterial;
  readonly tyre=tyreMaterial();
  private readonly asphaltAggregate=asphaltAggregateTexture();
  private readonly grassRelief=grassReliefTexture();
  private readonly roadWear:RoadWearUniforms={map:{value:null},size:{value:new THREE.Vector2(1,1)}};
  private readonly maxTextureSize:number;
  sunDirection=new THREE.Vector3(-.52,.78,.35).normalize();
  private readonly anisotropy:number;
  private readonly loader=new THREE.TextureLoader();
  constructor(renderer:THREE.WebGLRenderer,scene:THREE.Scene,invalidate:()=>void){
    this.anisotropy=Math.min(16,renderer.capabilities.getMaxAnisotropy());this.asphaltAggregate.anisotropy=this.anisotropy;this.grassRelief.anisotropy=this.anisotropy;
    this.maxTextureSize=renderer.capabilities.maxTextureSize;
    this.invalidate=invalidate;
    // Combine source blade normals with centimetre-scale tufts; keep a dry,
    // rough surface while allowing the sun to reveal changes in orientation.
    this.grass=stochasticSurface(this.pbr('grass',0xffffff,.94,1.35),2,.24,{roughnessCenter:.94,sourceRoughness:.55,roughnessContrast:.38,roughnessMin:.86,roughnessMax:1,specular:.65,aggregate:this.grassRelief,aggregateStrength:1.1,ground:'grass'});this.grass.vertexColors=true;this.grass.envMapIntensity=.3;
    // Source macro relief is restrained; stone detail comes from the packed aggregate.
    this.asphalt=stochasticSurface(this.pbr('clean_asphalt',0xa5abb2,.9,1.05),2.1,.14,{roughnessCenter:.88,sourceRoughness:.66,roughnessContrast:1.1,roughnessMin:.76,roughnessMax:.99,specular:.7,aggregate:this.asphaltAggregate,aggregateStrength:1.25,ground:'asphalt',roadWear:this.roadWear});this.asphalt.envMapIntensity=.55;
    this.runoff=stochasticSurface(this.pbr('clean_asphalt',0xf2f3f4,.94,.9),2.1,.16,{roughnessCenter:.93,sourceRoughness:.66,roughnessContrast:.9,roughnessMin:.83,roughnessMax:1,specular:.55,aggregate:this.asphaltAggregate,aggregateStrength:1.05,albedoGain:1.15,ground:'asphalt'});this.runoff.envMapIntensity=.4;
    this.gravel=gravelMaterial();
    for(const texture of [this.gravel.map,this.gravel.normalMap,this.gravel.roughnessMap])if(texture)texture.anisotropy=this.anisotropy;
    this.concrete=this.pbr('concrete_layers_02',0xd9d9d4,.94,.45);
    this.roof=this.pbr('corrugated_iron',0x73808b,.65,.5);this.roof.metalness=.75;
    this.rubber=this.pbr('rubber_tiles',0x484b50,.98,.18,4);this.rubber.map=null;
    this.alloy=new THREE.MeshStandardMaterial({color:0xabb2bd,metalness:.9,roughness:.3,roughnessMap:this.texture('corrugated_iron','roughness',3)});
    this.fabric=this.pbr('fabric_pattern_07',0x33505e,1,.22,5);this.fabric.map=null;
    this.carbon=this.pbr('fabric_pattern_07',0x15191e,.65,.16,9);this.carbon.map=null;
    this.kerb=paintedSurface(this.pbr('concrete_layers_02',0xffffff,.93,1.25));this.kerb.envMapIntensity=.35;this.kerb.vertexColors=true;this.kerb.name='painted-concrete-kerb';this.kerb.polygonOffset=true;this.kerb.polygonOffsetFactor=-4;this.kerb.polygonOffsetUnits=-4;
    for(const material of [this.grass,this.asphalt,this.runoff,this.gravel,this.concrete,this.roof,this.paint,this.rubber,this.alloy,this.fabric,this.carbon,this.kerb])material.userData.sharedCC0=true;
    const models=['tree_small_02','pine_sapling_small','tree_small_02-far','pine_sapling_small-far','kart-oopi','sedan-sports','truck','cone'].map(async name=>{
      const gltf=await new GLTFLoader().loadAsync(`${BASE}${name}.glb`);
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse(object=>{
        if(!(object instanceof THREE.Mesh))return;
        object.geometry.userData.sharedCC0=true;object.castShadow=true;object.receiveShadow=true;
        for(const material of Array.isArray(object.material)?object.material:[object.material]){
          material.userData.sharedCC0=true;
          for(const value of Object.values(material))if(value instanceof THREE.Texture){value.anisotropy=this.anisotropy;value.userData.sharedCC0=true;}
          // Alpha testing writes depth and gives stable foliage shadows without sorting artifacts.
          if(material instanceof THREE.MeshStandardMaterial&&/leaves|twig/.test(material.name)){
            material.transparent=false;material.alphaTest=.45;material.side=THREE.DoubleSide;material.roughness=1;
          }
        }
      });
      // LODs share identical source textures, including embedded GLB image maps.
      gltf.scene.traverse(object=>{if(object instanceof THREE.Mesh)for(const material of Array.isArray(object.material)?object.material:[object.material]){
        for(const slot of ['map','normalMap','roughnessMap','metalnessMap','aoMap'] as const){const standard=material as THREE.MeshStandardMaterial,texture=standard[slot];if(!texture)continue;const key=`embedded/${material.name}/${slot}`;const shared=this.textures.get(key);if(shared&&shared!==texture){texture.dispose();standard[slot]=shared;}else if(!shared)this.textures.set(key,texture);}
      }});
      this.models.set(name,gltf.scene);
    });
    const sky=new HDRLoader().loadAsync(`${BASE}sunny-sky.hdr`).then(texture=>{
      texture.mapping=THREE.EquirectangularReflectionMapping;
      const {data,width,height}=texture.image as {data:Uint16Array;width:number;height:number};
      let brightest=0,bestX=width/3,bestY=height*.2;
      for(let y=0;y<Math.floor(height*.44);y++)for(let x=0;x<width;x++){
        const i=(y*width+x)*4,luminance=THREE.DataUtils.fromHalfFloat(data[i])*.2126+THREE.DataUtils.fromHalfFloat(data[i+1])*.7152+THREE.DataUtils.fromHalfFloat(data[i+2])*.0722;
        if(luminance>brightest){brightest=luminance;bestX=x;bestY=y;}
      }
      const azimuth=((bestX+.5)/width-.5)*Math.PI*2,elevation=(.5-(bestY+.5)/height)*Math.PI;
      this.sunDirection.set(Math.cos(elevation)*Math.cos(azimuth),Math.sin(elevation),Math.cos(elevation)*Math.sin(azimuth));
      const pmrem=new THREE.PMREMGenerator(renderer),environment=pmrem.fromEquirectangular(texture);
      // HDR supplies broad sky irradiance/reflections in addition to the sun.
      scene.environment=environment.texture;scene.environmentIntensity=.68;
      scene.background=texture;scene.backgroundIntensity=1.1;scene.backgroundBlurriness=0;pmrem.dispose();invalidate();
    });
    this.ready=Promise.allSettled([...models,sky]).then(results=>{
      results.forEach(result=>{if(result.status==='rejected'){this.failures.push(String(result.reason));console.warn('CC0 asset unavailable; keeping fallback.',result.reason);}});invalidate();
    });
  }
  private invalidate:()=>void;
  setRoadWear(track:TrackData){
    const previous=this.roadWear.map.value,texture=roadWearTexture(track,this.maxTextureSize);
    texture.anisotropy=this.anisotropy;this.roadWear.map.value=texture;
    this.roadWear.size.value.set(track.length,track.width);previous?.dispose();
  }
  private texture(id:string,channel:string,repeat=1){
    const key=`${id}/${channel}/${repeat}`;let texture=this.textures.get(key);if(texture)return texture;
    texture=this.loader.load(`${BASE}${id}-${channel}.webp`,()=>this.invalidate(),undefined,error=>{this.failures.push(`${key}: ${String(error)}`);});
    texture.colorSpace=channel==='color'?THREE.SRGBColorSpace:THREE.NoColorSpace;
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.setScalar(repeat);texture.anisotropy=this.anisotropy;texture.userData.sharedCC0=true;this.textures.set(key,texture);return texture;
  }
  private pbr(id:string,color:number,roughness:number,normalStrength:number,repeat=1){
    return new THREE.MeshStandardMaterial({color,roughness,map:this.texture(id,'color',repeat),normalMap:this.texture(id,'normal',repeat),roughnessMap:this.texture(id,'roughness',repeat),normalScale:new THREE.Vector2(normalStrength,normalStrength)});
  }
  clone(name:string){return this.models.get(name)?.clone(true);}
}
