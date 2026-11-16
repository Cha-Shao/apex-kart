import * as THREE from 'three';
import {clipHalfPlane} from './track-footprint';
import type {Point} from './track';
import type {TerrainField} from './terrain';
import type {QuayEdge} from './coastal-terrain';
import type {SceneAssets} from './scene-assets';

let rippleTexture:THREE.DataTexture|undefined;
function waterRipples(){
  if(rippleTexture)return rippleTexture;
  const size=256,heights=new Float32Array(size*size),pixels=new Uint8Array(size*size*4);
  let seed=4179;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  // Periodic, multi-scale noise has no repeating parallel wave fronts. The
  // normal texture is shared, mipmapped and sampled twice with different drift.
  for(const [frequency,amplitude] of [[8,.12],[23,.035],[61,.009]]){
    const lattice=Float32Array.from({length:frequency*frequency},random);
    const at=(x:number,z:number)=>lattice[((z+frequency)%frequency)*frequency+(x+frequency)%frequency];
    for(let z=0;z<size;z++)for(let x=0;x<size;x++){
      const u=x/size*frequency,v=z/size*frequency,ix=Math.floor(u),iz=Math.floor(v),tx=u-ix,tz=v-iz;
      const sx=tx*tx*(3-2*tx),sz=tz*tz*(3-2*tz);
      heights[z*size+x]+=((at(ix,iz)*(1-sx)+at(ix+1,iz)*sx)*(1-sz)+(at(ix,iz+1)*(1-sx)+at(ix+1,iz+1)*sx)*sz)*amplitude;
    }
  }
  const h=(x:number,z:number)=>heights[((z+size)%size)*size+(x+size)%size];
  for(let z=0;z<size;z++)for(let x=0;x<size;x++){
    const dx=-(h(x+1,z)-h(x-1,z))*size/64,dz=-(h(x,z+1)-h(x,z-1))*size/64,length=Math.hypot(dx,dz,1),i=(z*size+x)*4;
    pixels[i]=Math.round((dx/length*.5+.5)*255);pixels[i+1]=Math.round((dz/length*.5+.5)*255);pixels[i+2]=Math.round((1/length*.5+.5)*255);pixels[i+3]=255;
  }
  const texture=new THREE.DataTexture(pixels,size,size);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;
  texture.userData.sharedCC0=true;texture.needsUpdate=true;rippleTexture=texture;return texture;
}
function waterMaterial(time:{value:number}){
  const material=new THREE.MeshPhysicalMaterial({color:0x3e5c63,roughness:.28,metalness:0,ior:1.333,specularIntensity:1,envMapIntensity:1.1,normalMap:waterRipples()});
  material.name='terrain-water-PBR';
  material.onBeforeCompile=shader=>{
    shader.uniforms.waterTime=time;
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      varying vec2 waterPosition;`).replace('#include <begin_vertex>',`#include <begin_vertex>
      waterPosition=position.xz;`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      uniform float waterTime;
      varying vec2 waterPosition;`).replace('#include <normal_fragment_maps>',`
      vec2 waterUv=waterPosition/32.0;
      vec2 rippleA=texture2D(normalMap,waterUv+vec2(waterTime*0.009,waterTime*0.004)).rg*2.0-1.0;
      vec2 rippleB=texture2D(normalMap,vec2(-waterUv.y,waterUv.x)*1.73+vec2(-waterTime*0.005,waterTime*0.008)).rg*2.0-1.0;
      float waterDetail=1.0-smoothstep(0.8,6.0,length(fwidth(waterPosition)));
      vec2 waterSlope=(rippleA+vec2(-rippleB.y,rippleB.x)*0.6)*waterDetail;
      normal=normalize(mat3(viewMatrix)*vec3(waterSlope.x,1.0,waterSlope.y));`);
  };
  material.customProgramCacheKey=()=> 'terrain-water-noise-v2';return material;
}

/** Clip only for placement queries; the terrain itself is never cut away. */
function submerged(points:(Point&{height:number})[],level:number):Point[]{
  const result:Point[]=[];
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],inside=a.height<level;
    if(inside)result.push({x:a.x,z:a.z});
    if(inside!==(b.height<level)){
      const t=(level-a.height)/(b.height-a.height);
      result.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});
    }
  }
  return result;
}
const hasArea=(points:Point[])=>points.length>=3&&Math.abs(points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a.x*b.z-b.x*a.z;},0))>1e-8;

/** One horizontal water surface for every terrain, including hand-drawn maps.
 * Terrain depth occludes water on land; pavement retains its supporting ground. */
export class TerrainWater {
  readonly group=new THREE.Group();
  private readonly clock={value:0};
  private constructor(readonly level:number,private terrain:TerrainField,quays:QuayEdge[],assets?:SceneAssets){
    this.group.name='terrain-sea-level-water';
    const geometry=new THREE.PlaneGeometry(terrain.size,terrain.size);
    geometry.rotateX(-Math.PI/2);
    // Ripple coordinates use world metres and stay consistent on every map.
    geometry.translate(terrain.originX+terrain.size/2,0,terrain.originZ+terrain.size/2);
    const mesh=new THREE.Mesh(geometry,waterMaterial(this.clock));
    // Ground sits 2.5 cm below its collision samples; keep equal-height land dry.
    mesh.position.y=level-.03;mesh.name='horizontal-water-surface';mesh.receiveShadow=true;
    this.group.add(mesh);
    if(quays.length&&assets)this.addQuays(quays,assets);
  }
  static forTerrain(terrain:TerrainField,quays:QuayEdge[]=[],assets?:SceneAssets){
    const level=terrain.seaLevel;
    if(level===null||!terrain.heights.some(h=>h<level))return null;
    return new TerrainWater(level,terrain,quays,assets);
  }
  private addQuays(quays:QuayEdge[],assets:SceneAssets){
    const positions:number[]=[],colors:number[]=[],uvs:number[]=[],dry=new THREE.Color(0xb8b9ad),wet=new THREE.Color(0x56645b);
    const vertex=(p:Point,y:number,u:number,v:number,color:THREE.Color)=>{positions.push(p.x,y,p.z);uvs.push(u,v);colors.push(color.r,color.g,color.b);};
    for(const q of quays){
      const a=q.outerA,b=q.outerB,length=Math.hypot(b.x-a.x,b.z-a.z),width=Math.hypot(a.x-q.innerA.x,a.z-q.innerA.z);
      // The cap covers the service shoulder outside the guardrail. Its front
      // continues below water as one solid wall, without extra collision bodies.
      const cap=[[q.innerA,q.innerTopA,0,0],[a,q.topA,0,width],[q.innerB,q.innerTopB,length,0],[a,q.topA,0,width],[b,q.topB,length,width],[q.innerB,q.innerTopB,length,0]] as const;
      for(const [p,y,u,v] of cap)vertex(p,y+.015,u/2,v/2,dry);
      const face=[[a,q.topA,0],[a,q.bottom,0],[b,q.topB,length],[a,q.bottom,0],[b,q.bottom,length],[b,q.topB,length]] as const;
      for(const [p,y,u] of face)vertex(p,y,u/2,y/2,y<this.level?wet:dry);
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.computeVertexNormals();
    const material=new THREE.MeshStandardMaterial({map:assets.concrete.map,normalMap:assets.concrete.normalMap,normalScale:new THREE.Vector2(.25,.25),vertexColors:true,roughness:.92,envMapIntensity:.35,side:THREE.DoubleSide});
    const mesh=new THREE.Mesh(geometry,material);mesh.name='generated-waterfront-foundations';mesh.receiveShadow=true;this.group.add(mesh);
  }
  update(time:number){this.clock.value=time;}
  contains(p:Point){
    const f=this.terrain;
    return p.x>=f.originX&&p.x<=f.originX+f.size&&p.z>=f.originZ&&p.z<=f.originZ+f.size&&f.sample(p.x,p.z)<this.level;
  }
  intersects(minX:number,maxX:number,minZ:number,maxZ:number){
    const f=this.terrain,n=f.resolution,cell=f.cellSize;
    minX=Math.max(minX,f.originX);maxX=Math.min(maxX,f.originX+f.size);
    minZ=Math.max(minZ,f.originZ);maxZ=Math.min(maxZ,f.originZ+f.size);
    if(minX>=maxX||minZ>=maxZ)return false;
    const box=[{x:minX,z:minZ},{x:maxX,z:minZ},{x:maxX,z:maxZ},{x:minX,z:maxZ}];
    const startX=Math.max(0,Math.floor((minX-f.originX)/cell)),endX=Math.min(n-2,Math.floor((maxX-f.originX)/cell));
    const startZ=Math.max(0,Math.floor((minZ-f.originZ)/cell)),endZ=Math.min(n-2,Math.floor((maxZ-f.originZ)/cell));
    const vertex=(x:number,z:number)=>({x:f.originX+x*cell,z:f.originZ+z*cell,height:f.heights[z*n+x]});
    for(let z=startZ;z<=endZ;z++)for(let x=startX;x<=endX;x++){
      const a=vertex(x,z),b=vertex(x+1,z),c=vertex(x,z+1),d=vertex(x+1,z+1);
      if(Math.min(a.height,b.height,c.height,d.height)>=this.level)continue;
      // The same a-c-d / a-d-b diagonal used by the terrain and collision mesh.
      for(const triangle of [[a,c,d],[a,d,b]]){
        let water=submerged(triangle,this.level);
        for(let i=0;i<4&&hasArea(water);i++)water=clipHalfPlane(water,box[i],box[(i+1)%4],1);
        if(hasArea(water))return true;
      }
    }
    return false;
  }
  allowsScenery=(p:Point,margin=0)=>margin>0?!this.intersects(p.x-margin,p.x+margin,p.z-margin,p.z+margin):!this.contains(p);
}
