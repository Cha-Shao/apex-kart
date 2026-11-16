import * as THREE from 'three';
import {Reflector} from 'three/addons/objects/Reflector.js';
import {clipHalfPlane} from './track-footprint';
import type {Point} from './track';
import type {TerrainField} from './terrain';
import type {QuayEdge} from './coastal-terrain';
import {disposeSceneGroup,type SceneAssets} from './scene-assets';

interface WaterReflectionUniforms {
  map:{value:THREE.Texture};
  matrix:{value:THREE.Matrix4};
  ready:{value:number};
}

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
    const dx=-(h(x+1,z)-h(x-1,z))*size/12,dz=-(h(x,z+1)-h(x,z-1))*size/12,length=Math.hypot(dx,dz,1),i=(z*size+x)*4;
    pixels[i]=Math.round((dx/length*.5+.5)*255);pixels[i+1]=Math.round((dz/length*.5+.5)*255);pixels[i+2]=Math.round((1/length*.5+.5)*255);pixels[i+3]=255;
  }
  const texture=new THREE.DataTexture(pixels,size,size);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;
  texture.userData.sharedCC0=true;texture.needsUpdate=true;rippleTexture=texture;return texture;
}
function waterMaterial(time:{value:number},reflection:WaterReflectionUniforms,terrain:TerrainField,level:number){
  // Match the rendered ground's 2.5 cm offset and actual triangle diagonal.
  // Bilinear filtering would put the shallow-water transition off the bank.
  const heights=new THREE.DataTexture(Float32Array.from(terrain.heights,h=>h-.025),terrain.resolution,terrain.resolution,THREE.RedFormat,THREE.FloatType);
  heights.name='water-bottom-heightfield';heights.minFilter=heights.magFilter=THREE.NearestFilter;heights.generateMipmaps=false;heights.needsUpdate=true;
  const material=new THREE.MeshPhysicalMaterial({color:0xffffff,roughness:.14,metalness:0,ior:1.333,transmission:1,thickness:1,attenuationColor:new THREE.Color(0x7badb7),attenuationDistance:2.5,specularIntensity:1,envMapIntensity:1,normalMap:waterRipples()});
  material.name='terrain-water-PBR';
  material.addEventListener('dispose',()=>heights.dispose());
  material.onBeforeCompile=shader=>{
    shader.uniforms.waterTime=time;
    shader.uniforms.waterReflection=reflection.map;
    shader.uniforms.waterReflectionMatrix=reflection.matrix;
    shader.uniforms.waterReflectionReady=reflection.ready;
    shader.uniforms.waterTerrain={value:heights};
    shader.uniforms.waterTerrainGrid={value:new THREE.Vector4(terrain.originX,terrain.originZ,terrain.cellSize,terrain.resolution)};
    shader.uniforms.waterLevel={value:level-.03};
    shader.uniforms.waterScatterColor={value:new THREE.Color(0x244950)};
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      uniform mat4 waterReflectionMatrix;
      varying vec2 waterPosition;
      varying vec4 waterMirrorCoord;`).replace('#include <begin_vertex>',`#include <begin_vertex>
      waterPosition=(modelMatrix*vec4(position,1.0)).xz;
      waterMirrorCoord=waterReflectionMatrix*vec4(position,1.0);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      uniform float waterTime;
      uniform sampler2D waterReflection;
      uniform float waterReflectionReady;
      uniform sampler2D waterTerrain;
      uniform vec4 waterTerrainGrid;
      uniform float waterLevel;
      uniform vec3 waterScatterColor;
      varying vec2 waterPosition;
      varying vec4 waterMirrorCoord;
      float waterBottomHeight(vec2 position){
        vec2 grid=clamp((position-waterTerrainGrid.xy)/waterTerrainGrid.z,vec2(0.0),vec2(waterTerrainGrid.w-1.0));
        ivec2 cell=min(ivec2(floor(grid)),ivec2(int(waterTerrainGrid.w)-2));
        vec2 t=grid-vec2(cell);
        float a=texelFetch(waterTerrain,cell,0).r;
        float b=texelFetch(waterTerrain,cell+ivec2(1,0),0).r;
        float c=texelFetch(waterTerrain,cell+ivec2(0,1),0).r;
        float d=texelFetch(waterTerrain,cell+ivec2(1,1),0).r;
        return t.x>t.y?a+(b-a)*t.x+(d-b)*t.y:a+(d-c)*t.x+(c-a)*t.y;
      }`).replace('#include <normal_fragment_maps>',`
      float waterDepth=max(0.0,waterLevel-waterBottomHeight(waterPosition));
      vec2 waterUv=waterPosition/24.0;
      vec2 rippleA=texture2D(normalMap,waterUv+vec2(waterTime*0.018,waterTime*0.007)).rg*2.0-1.0;
      vec2 rippleB=texture2D(normalMap,vec2(-waterUv.y,waterUv.x)*3.4+vec2(-waterTime*0.031,waterTime*0.024)).rg*2.0-1.0;
      float waterFootprint=length(fwidth(waterPosition));
      float waterDetail=1.0-smoothstep(0.25,2.5,waterFootprint);
      // Broad wind waves remain readable beyond the fine, mipmapped ripples.
      vec2 waterWindA=vec2(0.93,0.37),waterWindB=vec2(-0.45,0.89);
      vec2 waterSwell=waterWindA*0.065*cos(dot(waterPosition,waterWindA)*0.65-waterTime*1.05)
        +waterWindB*0.04*cos(dot(waterPosition,waterWindB)*1.08-waterTime*1.32);
      waterSwell*=1.0-smoothstep(2.0,12.0,waterFootprint);
      vec2 waterSlope=waterSwell+(rippleA+vec2(-rippleB.y,rippleB.x)*0.5)*1.7*waterDetail;
      waterSlope*=smoothstep(0.0,0.7,waterDepth);
      normal=normalize(mat3(viewMatrix)*vec3(waterSlope.x,1.0,waterSlope.y));
      `).replace('#include <lights_fragment_maps>',`#include <lights_fragment_maps>
      // Feed linear HDR scene reflection into the physical BRDF, which supplies
      // water's Fresnel response and keeps the direct sun's moving highlights.
      vec2 waterReflectionUv=waterMirrorCoord.xy/max(waterMirrorCoord.w,0.0001);
      vec2 waterDistortion=(mat3(viewMatrix)*vec3(waterSlope.x,0.0,waterSlope.y)).xy;
      waterReflectionUv+=waterDistortion*(0.012+1.5/max(length(vViewPosition),8.0));
      vec2 waterReflectionEdge=smoothstep(vec2(0.0),vec2(0.035),waterReflectionUv)
        *(1.0-smoothstep(vec2(0.965),vec2(1.0),waterReflectionUv));
      float waterReflectionWeight=waterReflectionReady*waterReflectionEdge.x*waterReflectionEdge.y;
      vec3 waterReflectedLight=texture2D(waterReflection,clamp(waterReflectionUv,vec2(0.001),vec2(0.999))).rgb;
      radiance=mix(radiance,waterReflectedLight,waterReflectionWeight);`)
      .replace('#include <transmission_fragment>',`
      // Use the refracted light's path through the actual water column. Near
      // the bank this tends to zero, exposing the ground without a painted rim.
      vec3 waterWorldNormal=inverseTransformDirection(normal,viewMatrix);
      vec3 waterWorldView=inverseTransformDirection(normalize(vViewPosition),viewMatrix);
      vec3 waterRefractionRay=refract(-waterWorldView,waterWorldNormal,1.0/material.ior);
      float waterOpticalDepth=waterDepth/max(-waterRefractionRay.y,0.25);
      vec3 waterScatterLight=totalDiffuse*waterScatterColor;
      ${THREE.ShaderChunk.transmission_fragment.replace('material.thickness = thickness;','material.thickness = min(waterOpticalDepth,20.0);')}
      // Absorption and in-scattering approach the deep-water colour gradually;
      // the physical specular term remains independent of bottom visibility.
      vec3 waterTransmittance=volumeAttenuation(waterOpticalDepth,attenuationColor,attenuationDistance);
      vec3 waterFresnel=EnvironmentBRDF(normal,normalize(vViewPosition),material.specularColor,material.specularF90,material.roughness);
      totalDiffuse+=waterScatterLight*(vec3(1.0)-waterTransmittance)*(vec3(1.0)-waterFresnel);`);
  };
  material.customProgramCacheKey=()=> 'terrain-water-depth-transmission-v4';return material;
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
  private readonly reflection:Reflector;
  private constructor(readonly level:number,private terrain:TerrainField,quays:QuayEdge[],assets?:SceneAssets){
    this.group.name='terrain-sea-level-water';
    const geometry=new THREE.PlaneGeometry(terrain.size,terrain.size);
    // The helper only captures the reflected view; the visible surface retains
    // physical lighting, depth occlusion, fog and a shared mean water level.
    this.reflection=new Reflector(geometry,{textureWidth:512,textureHeight:512,clipBias:.001,multisample:0});
    const reflectionMaterial=this.reflection.material as THREE.ShaderMaterial;
    const reflection:WaterReflectionUniforms={map:{value:this.reflection.getRenderTarget().texture},matrix:reflectionMaterial.uniforms.textureMatrix,ready:{value:0}};
    const mesh=new THREE.Mesh(geometry,waterMaterial(this.clock,reflection,terrain,level));
    mesh.rotation.x=-Math.PI/2;
    mesh.position.set(terrain.originX+terrain.size/2,level-.03,terrain.originZ+terrain.size/2);
    // Ground sits 2.5 cm below its collision samples; keep equal-height land dry.
    mesh.name='horizontal-water-surface';mesh.receiveShadow=true;
    let lastReflection=-Infinity;
    const reflectedView=new THREE.Matrix4(),reflectedProjection=new THREE.Matrix4();
    mesh.onBeforeRender=(renderer,scene,camera,geo,material,group)=>{
      // Static views need only 30 captures/sec; camera movement refreshes the
      // projection immediately. Ripple animation always runs at display rate.
      if(this.clock.value-lastReflection<1/30&&reflectedView.equals(camera.matrixWorld)&&reflectedProjection.equals(camera.projectionMatrix))return;
      this.reflection.matrixWorld.copy(mesh.matrixWorld);
      this.reflection.camera.layers.mask=camera.layers.mask;
      mesh.visible=false;
      try{
        this.reflection.onBeforeRender(renderer,scene,camera,geo,material,group);
        reflection.ready.value=1;lastReflection=this.clock.value;
        reflectedView.copy(camera.matrixWorld);reflectedProjection.copy(camera.projectionMatrix);
      }finally{mesh.visible=true;}
    };
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
  dispose(){this.reflection.dispose();disposeSceneGroup(this.group);}
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
