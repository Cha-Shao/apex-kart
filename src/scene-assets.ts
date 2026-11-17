import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js';
import {ASPHALT_TEXTURE_METRES,stochasticSurface,tyreMaterial,asphaltAggregateTexture,grassReliefTexture,gravelMaterial,paintedSurface,roadPaintMaterial,roadsideMaterial,matteFoliage,type RoadWearUniforms} from './surface-materials';
import {roadWearTexture} from './road-wear';
import {TREE_ASSET_BASE,TREE_MODELS} from './foliage';
import {treeLodFade} from './tree-lod';
import {foliageCutoutTexture} from './foliage-cutout';
import {treeLeafCoverage} from './tree-leaf-coverage';
import {prepareTreeWind,treeWind} from './tree-wind';
import {daylightSky} from './daylight';
import type {TrackData} from './track';

const BASE='/assets/cc0/';
// Source-map averages keep surfaces recognisable while the PBR images download.
const PBR_FALLBACKS:Record<string,{color:string;roughness:number}>={
  grass:{color:'#445c28',roughness:139},
  clean_asphalt:{color:'#444746',roughness:168},
  concrete_layers_02:{color:'#7d7a74',roughness:210},
  corrugated_iron:{color:'#aab3ae',roughness:180},
  fabric_pattern_07:{color:'#9b5955',roughness:163},
  rubber_tiles:{color:'#1f2125',roughness:191},
};
const GRASS_HIGH_TINT=new THREE.Color(0xe6dfc9),GRASS_LOW_TINT=new THREE.Color(0xdce7cc);
/** Keep terrain and its overhanging turf identical in colour at the seam. */
export function terrainGrassColor(x:number,z:number,height:number,target=new THREE.Color()){
  return target.set(0xffffff).lerp(height>=0?GRASS_HIGH_TINT:GRASS_LOW_TINT,Math.min(.55,Math.abs(height)/70)).multiplyScalar(.9+.1*Math.sin(x*.025)*Math.cos(z*.019));
}
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
  readonly grassVerge:THREE.MeshStandardMaterial;
  readonly grassFringe:THREE.MeshStandardMaterial;
  readonly asphaltVerge:THREE.MeshStandardMaterial;
  readonly runoffVerge:THREE.MeshStandardMaterial;
  readonly runoff:THREE.MeshStandardMaterial;
  readonly gravel:THREE.MeshStandardMaterial;
  readonly gravelSpill:THREE.MeshStandardMaterial;
  readonly concrete:THREE.MeshStandardMaterial;
  readonly roof:THREE.MeshStandardMaterial;
  readonly paint=new THREE.MeshPhysicalMaterial({color:0xc4ed4c,metalness:.12,roughness:.27,clearcoat:1,clearcoatRoughness:.18});
  readonly rubber:THREE.MeshStandardMaterial;
  readonly alloy:THREE.MeshStandardMaterial;
  readonly fabric:THREE.MeshStandardMaterial;
  readonly carbon:THREE.MeshStandardMaterial;
  readonly kerb:THREE.MeshStandardMaterial;
  readonly roadPaint:THREE.MeshStandardMaterial;
  readonly treeViewPosition=new THREE.Vector3();
  readonly treeWindTime={value:0};
  private readonly treeMaterials=new Map<string,THREE.Material>();
  private readonly treeDepthMaterials=new Map<string,THREE.MeshDepthMaterial>();
  readonly tyre=tyreMaterial();
  private readonly asphaltAggregate=asphaltAggregateTexture();
  private readonly grassRelief=grassReliefTexture();
  private readonly roadWear:RoadWearUniforms={map:{value:null},size:{value:new THREE.Vector2(1,1)}};
  private readonly maxTextureSize:number;
  sunDirection=new THREE.Vector3(-.52,.78,.35).normalize();
  private readonly anisotropy:number;
  private readonly loader=new THREE.TextureLoader();
  constructor(renderer:THREE.WebGLRenderer,scene:THREE.Scene,invalidate:()=>void){
    const foliageMSAA=renderer.getContext().getContextAttributes()?.antialias===true;
    this.anisotropy=Math.min(16,renderer.capabilities.getMaxAnisotropy());this.asphaltAggregate.anisotropy=this.anisotropy;this.grassRelief.anisotropy=this.anisotropy;
    this.maxTextureSize=renderer.capabilities.maxTextureSize;
    this.invalidate=invalidate;
    // Combine source blade normals with centimetre-scale tufts; keep a dry,
    // rough surface while allowing the sun to reveal changes in orientation.
    this.grass=stochasticSurface(this.pbr('grass',0xffffff,.94,1.35),2,.24,{roughnessCenter:.94,sourceRoughness:.55,roughnessContrast:.38,roughnessMin:.86,roughnessMax:1,specular:.65,aggregate:this.grassRelief,aggregateStrength:1.1,ground:'grass'});this.grass.vertexColors=true;this.grass.envMapIntensity=.3;
    // Fine aggregate sits in binder; avoid oversized stones and dark grooves.
    this.asphalt=stochasticSurface(this.pbr('clean_asphalt',0xa5abb2,.9,.42),ASPHALT_TEXTURE_METRES,.1,{roughnessCenter:.9,sourceRoughness:.66,roughnessContrast:.5,roughnessMin:.84,roughnessMax:.98,specular:.65,aggregate:this.asphaltAggregate,aggregateStrength:.55,ground:'asphalt',roadWear:this.roadWear});this.asphalt.envMapIntensity=.5;
    this.runoff=stochasticSurface(this.pbr('clean_asphalt',0xf2f3f4,.94,.36),ASPHALT_TEXTURE_METRES,.12,{roughnessCenter:.94,sourceRoughness:.66,roughnessContrast:.45,roughnessMin:.87,roughnessMax:1,specular:.55,aggregate:this.asphaltAggregate,aggregateStrength:.45,albedoGain:1.15,ground:'asphalt'});this.runoff.envMapIntensity=.4;
    this.grassVerge=roadsideMaterial(this.grass);this.grassFringe=roadsideMaterial(this.grass,'grass-fringe');this.asphaltVerge=roadsideMaterial(this.asphalt,'asphalt');this.runoffVerge=roadsideMaterial(this.runoff,'runoff');
    this.gravel=gravelMaterial();
    this.gravelSpill=roadsideMaterial(this.gravel,'gravel');
    for(const texture of [this.gravel.map,this.gravel.normalMap,this.gravel.roughnessMap])if(texture)texture.anisotropy=this.anisotropy;
    this.concrete=this.pbr('concrete_layers_02',0xd9d9d4,.94,.45);
    this.roof=this.pbr('corrugated_iron',0x73808b,.65,.5);this.roof.metalness=.75;
    this.rubber=this.pbr('rubber_tiles',0x484b50,.98,.18,4);this.rubber.map=null;
    this.alloy=new THREE.MeshStandardMaterial({color:0xabb2bd,metalness:.9,roughness:.3,roughnessMap:this.texture('corrugated_iron','roughness',3)});
    this.fabric=this.pbr('fabric_pattern_07',0x33505e,1,.22,5);this.fabric.map=null;
    this.carbon=this.pbr('fabric_pattern_07',0x15191e,.65,.16,9);this.carbon.map=null;
    this.kerb=paintedSurface(this.pbr('concrete_layers_02',0xffffff,.93,1.25));this.kerb.envMapIntensity=.35;this.kerb.vertexColors=true;this.kerb.name='painted-concrete-kerb';this.kerb.polygonOffset=true;this.kerb.polygonOffsetFactor=-4;this.kerb.polygonOffsetUnits=-4;
    this.roadPaint=roadPaintMaterial(this.texture('clean_asphalt','normal'));
    for(const material of [this.grass,this.asphalt,this.grassVerge,this.grassFringe,this.asphaltVerge,this.runoffVerge,this.runoff,this.gravel,this.gravelSpill,this.concrete,this.roof,this.paint,this.rubber,this.alloy,this.fabric,this.carbon,this.kerb,this.roadPaint])material.userData.sharedCC0=true;
    const vegetation=TREE_MODELS.flatMap(name=>[name,`${name}-mid`,`${name}-far`]);
    const models=[...vegetation,'groundcover','kart-oopi','sedan-sports','truck','cone'].map(async name=>{
      const tree=vegetation.includes(name),groundcover=name==='groundcover',gltf=await new GLTFLoader().loadAsync(`${tree||groundcover?TREE_ASSET_BASE:BASE}${name}.glb${tree?'?v=canopy-coverage-3':groundcover?'?v=grounded-fine-grass-6':''}`);
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse(object=>{
        if(!(object instanceof THREE.Mesh))return;
        object.geometry.userData.sharedCC0=true;object.castShadow=true;object.receiveShadow=true;
        for(const material of Array.isArray(object.material)?object.material:[object.material]){
          if(groundcover)material.alphaToCoverage=foliageMSAA;
          material.userData.sharedCC0=true;
          for(const value of Object.values(material))if(value instanceof THREE.Texture){value.anisotropy=this.anisotropy;value.userData.sharedCC0=true;}
          // Alpha testing writes depth and gives stable foliage shadows without sorting artifacts.
          if(material instanceof THREE.MeshStandardMaterial&&/leaves|twig/.test(material.name)){
            const occlusion=object.geometry.getAttribute('_canopy_occlusion');
            if(occlusion)object.geometry.setAttribute('canopyOcclusion',occlusion);
            const leafNormal=object.geometry.getAttribute('_leaf_normal');
            if(leafNormal)object.geometry.setAttribute('leafSurfaceNormal',leafNormal);
            matteFoliage(material,!!occlusion,!!leafNormal);material.alphaToCoverage=foliageMSAA;
            if(tree){prepareTreeWind(object.geometry);treeWind(material,this.treeWindTime);}
          }
        }
      });
      // LODs share identical source textures, including embedded GLB image maps.
      gltf.scene.traverse(object=>{if(object instanceof THREE.Mesh)for(const material of Array.isArray(object.material)?object.material:[object.material]){
        for(const slot of ['map','normalMap','roughnessMap','metalnessMap','aoMap'] as const){
          const standard=material as THREE.MeshStandardMaterial,texture=standard[slot];if(!texture)continue;
          const key=`embedded/${material.name}/${slot}`,shared=this.textures.get(key);
          if(shared){if(shared!==texture){texture.dispose();standard[slot]=shared;}continue;}
          const cutout=slot==='map'&&(groundcover||tree&&/leaves|twig/.test(material.name));
          const prepared=cutout?foliageCutoutTexture(texture,groundcover ? .4 : standard.alphaTest):texture;
          prepared.userData.sharedCC0=true;standard[slot]=prepared;this.textures.set(key,prepared);
          if(prepared!==texture)texture.dispose();
        }
        if(tree&&material instanceof THREE.MeshStandardMaterial&&/leaves|twig/.test(material.name)){
          const coverage=treeLeafCoverage(material);if(coverage)this.textures.set(`embedded/${material.name}/canopyCoverage`,coverage);
        }
      }});
      this.models.set(name,gltf.scene);
    });
    const sky=new HDRLoader().setDataType(THREE.HalfFloatType).loadAsync(`${BASE}sunny-sky.hdr`).then(texture=>{
      texture.mapping=THREE.EquirectangularReflectionMapping;
      const daylight=daylightSky(texture);this.sunDirection.copy(daylight.sunDirection);
      const pmrem=new THREE.PMREMGenerator(renderer),environment=pmrem.fromEquirectangular(daylight.sky);
      daylight.sky.dispose();
      // Retain broad HDR sky and ground bounce. Only the directional light
      // supplies the solar disc, so it can be occluded by the scene's shadows.
      scene.environment=environment.texture;scene.environmentIntensity=.58;
      scene.background=texture;scene.backgroundIntensity=1.1;scene.backgroundBlurriness=0;pmrem.dispose();invalidate();
    });
    this.ready=Promise.allSettled([...models,sky]).then(results=>{
      results.forEach(result=>{if(result.status==='rejected'){this.failures.push(String(result.reason));console.warn('CC0 asset unavailable; keeping fallback.',result.reason);}});invalidate();
    });
  }
  private invalidate:()=>void;
  private roadWearTrack:TrackData|undefined;
  setRoadWear(track:TrackData){
    if(this.roadWearTrack===track)return;
    const previous=this.roadWear.map.value,texture=roadWearTexture(track,this.maxTextureSize);
    texture.anisotropy=this.anisotropy;this.roadWear.map.value=texture;
    this.roadWear.size.value.set(track.length,track.width);this.roadWearTrack=track;previous?.dispose();
  }
  private texture(id:string,channel:string,repeat=1){
    const key=`${id}/${channel}/${repeat}`;let texture=this.textures.get(key);if(texture)return texture;
    texture=this.loader.load(`${BASE}${id}-${channel}.webp`,()=>this.invalidate(),undefined,error=>{this.failures.push(`${key}: ${String(error)}`);});
    texture.colorSpace=channel==='color'?THREE.SRGBColorSpace:THREE.NoColorSpace;
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.setScalar(repeat);texture.anisotropy=this.anisotropy;texture.userData.sharedCC0=true;
    const fallback=PBR_FALLBACKS[id],roughness=fallback?.roughness??255;
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
    const context=canvas.getContext('2d')!;
    context.fillStyle=channel==='normal'?'#8080ff':channel==='roughness'?`rgb(${roughness},${roughness},${roughness})`:fallback?.color??'#ffffff';
    context.fillRect(0,0,1,1);
    // TextureLoader replaces this image in place on success; errors keep the fallback.
    texture.image=canvas;texture.needsUpdate=true;
    this.textures.set(key,texture);return texture;
  }
  private pbr(id:string,color:number,roughness:number,normalStrength:number,repeat=1){
    return new THREE.MeshStandardMaterial({color,roughness,map:this.texture(id,'color',repeat),normalMap:this.texture(id,'normal',repeat),roughnessMap:this.texture(id,'roughness',repeat),normalScale:new THREE.Vector2(normalStrength,normalStrength)});
  }
  treeMaterial(source:THREE.Material|THREE.Material[],level:number):THREE.Material|THREE.Material[]{
    if(Array.isArray(source))return source.map(material=>this.treeMaterial(material,level) as THREE.Material);
    const key=`${source.uuid}/${level}`;let material=this.treeMaterials.get(key);if(material)return material;
    material=source.clone();material.onBeforeCompile=source.onBeforeCompile;material.customProgramCacheKey=source.customProgramCacheKey.bind(source);material.userData.sharedCC0=true;
    treeLodFade(material,level,this.treeViewPosition);this.treeMaterials.set(key,material);return material;
  }
  treeDepthMaterial(source:THREE.Material,level:number){
    const key=`${source.uuid}/${level}`;let material=this.treeDepthMaterials.get(key);if(material)return material;
    material=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});material.userData.sharedCC0=true;
    if(source.userData.treeWind)treeWind(material,this.treeWindTime);
    treeLodFade(material,level,this.treeViewPosition);this.treeDepthMaterials.set(key,material);return material;
  }
  clone(name:string){return this.models.get(name)?.clone(true);}
}
