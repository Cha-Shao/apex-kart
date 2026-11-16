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

const waterNoiseTextures=new Map<'ripple'|'swell',THREE.DataTexture>();
function waterNoise(kind:'ripple'|'swell'){
  const cached=waterNoiseTextures.get(kind);if(cached)return cached;
  const size=256,heights=new Float32Array(size*size),pixels=new Uint8Array(size*size*4);
  let seed=kind==='ripple'?4179:8231;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  // Independent broad relief and fine capillary normals, with periodic edges.
  // Alpha carries height noise for breaking up the shoreline wave fronts.
  const bands=kind==='ripple'?[[8,.12],[23,.035],[61,.009]]:[[3,.6],[7,.26],[15,.1]];
  const amplitudeSum=bands.reduce((sum,band)=>sum+band[1],0);
  for(const [frequency,amplitude] of bands){
    const lattice=Float32Array.from({length:frequency*frequency},random);
    const at=(x:number,z:number)=>lattice[((z+frequency)%frequency)*frequency+(x+frequency)%frequency];
    for(let z=0;z<size;z++)for(let x=0;x<size;x++){
      const u=x/size*frequency,v=z/size*frequency,ix=Math.floor(u),iz=Math.floor(v),tx=u-ix,tz=v-iz;
      const sx=tx*tx*tx*(tx*(tx*6-15)+10),sz=tz*tz*tz*(tz*(tz*6-15)+10);
      heights[z*size+x]+=((at(ix,iz)*(1-sx)+at(ix+1,iz)*sx)*(1-sz)+(at(ix,iz+1)*(1-sx)+at(ix+1,iz+1)*sx)*sz)*amplitude;
    }
  }
  const h=(x:number,z:number)=>heights[((z+size)%size)*size+(x+size)%size];
  const heightMean=heights.reduce((sum,value)=>sum+value,0)/heights.length;
  for(let z=0;z<size;z++)for(let x=0;x<size;x++){
    const dx=-(h(x+1,z)-h(x-1,z))*size/12,dz=-(h(x,z+1)-h(x,z-1))*size/12,length=Math.hypot(dx,dz,1),i=(z*size+x)*4;
    const nx=dx/length,nz=dz/length;
    pixels[i]=Math.round((nx*.5+.5)*255);pixels[i+1]=Math.round((nz*.5+.5)*255);
    // B stores the second moment of the normal's horizontal components. Mips
    // retain this energy when averaging RG towards a flat normal at distance.
    pixels[i+2]=Math.round(Math.min(1,(nx*nx+nz*nz)*4)*255);
    // Centre height before variance-preserving blends to keep their mean level.
    pixels[i+3]=Math.round(THREE.MathUtils.clamp(.5+(heights[z*size+x]-heightMean)/amplitudeSum,0,1)*255);
  }
  const texture=new THREE.DataTexture(pixels,size,size);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;
  texture.name=`water-${kind}-normal-height-moment`;texture.userData.sharedCC0=true;texture.needsUpdate=true;waterNoiseTextures.set(kind,texture);return texture;
}

// Blend three randomly transformed samples before a source tile can repeat.
// Cells stay anchored to world coordinates while the waves scroll within them.
// Both shader stages share the same height field; explicit fragment gradients
// keep random offsets out of mip selection at cell boundaries.
const waterSamplingShader=/* glsl */`
  vec3 waterCellHash(vec2 cell){
    vec3 p=fract(vec3(cell.x,cell.y,cell.x+cell.y)*vec3(0.1031,0.11369,0.13787));
    p+=dot(p,p.zxy+19.19);
    return fract(vec3((p.x+p.y)*p.z,(p.y+p.z)*p.x,(p.z+p.x)*p.y));
  }
  void waterNoiseCells(vec2 uv,out vec2 a,out vec2 b,out vec2 c,out vec3 weights){
    vec2 skew=mat2(1.0,0.0,-0.577350269,1.154700538)*(uv*1.85);
    vec2 cell=floor(skew),f=fract(skew);
    float third=1.0-f.x-f.y;
    if(third>0.0){
      a=cell;b=cell+vec2(0.0,1.0);c=cell+vec2(1.0,0.0);
      weights=vec3(third,f.y,f.x);
    }else{
      a=cell+vec2(1.0);b=cell+vec2(1.0,0.0);c=cell+vec2(0.0,1.0);
      weights=vec3(-third,1.0-f.y,1.0-f.x);
    }
    weights=max(weights,vec3(0.0));weights*=weights;
    weights/=dot(weights,vec3(1.0));
  }
  vec4 waterNoiseTap(sampler2D tex,vec2 uv,vec2 drift,vec2 cell,vec2 dx,vec2 dy){
    vec3 random=waterCellHash(cell);
    float turn=floor(random.z*4.0);
    vec2 axis=turn<1.0?vec2(1.0,0.0):turn<2.0?vec2(0.0,1.0):turn<3.0?vec2(-1.0,0.0):vec2(0.0,-1.0);
    mat2 rotation=mat2(axis.x,axis.y,-axis.y,axis.x);
    vec2 sampleUv=rotation*(uv+drift)+random.xy;
    #ifdef WATER_FRAGMENT_SAMPLE
      vec4 sampleValue=textureGrad(tex,sampleUv,rotation*dx,rotation*dy);
    #else
      vec4 sampleValue=textureLod(tex,sampleUv,0.0);
    #endif
    // Rotate the normal back and retain the variance lost to texture filtering.
    vec2 slope=transpose(rotation)*(sampleValue.rg*2.0-1.0);
    float variance=max(0.0,sampleValue.b*0.25-dot(slope,slope));
    return vec4(slope,sampleValue.a-0.5,variance);
  }
  vec4 waterNoiseSample(sampler2D tex,vec2 uv,vec2 drift){
    vec2 a,b,c;vec3 weights;waterNoiseCells(uv,a,b,c,weights);
    vec2 dx=vec2(0.0),dy=vec2(0.0);
    #ifdef WATER_FRAGMENT_SAMPLE
      dx=dFdx(uv);dy=dFdy(uv);
    #endif
    vec4 tapA=waterNoiseTap(tex,uv,drift,a,dx,dy),tapB=waterNoiseTap(tex,uv,drift,b,dx,dy),tapC=waterNoiseTap(tex,uv,drift,c,dx,dy);
    vec3 value=tapA.xyz*weights.x+tapB.xyz*weights.y+tapC.xyz*weights.z;
    float weightEnergy=dot(weights,weights);
    float variance=dot(vec3(tapA.w,tapB.w,tapC.w),weights*weights)/weightEnergy;
    // Preserve wave energy through blends instead of outlining a grid of calm
    // patches where independent normals happen to average towards zero.
    return vec4(value*inversesqrt(weightEnergy),variance);
  }
`;

/** Signed distance to shoreline crossings in the ground's actual triangles.
 * This also locates the shore on flat-bottom bays without a bottom gradient. */
function waterShoreline(terrain:TerrainField,level:number){
  const n=terrain.resolution,total=n*n,cell=terrain.cellSize;
  const nearestX=new Float32Array(total),nearestZ=new Float32Array(total),squared=new Float64Array(total).fill(Infinity);
  const height=(i:number)=>terrain.heights[i]-.025,waterLevel=level-.03;
  const offer=(i:number,x:number,z:number)=>{
    const distance=(i%n-x)**2+(Math.floor(i/n)-z)**2;
    if(distance<squared[i]){squared[i]=distance;nearestX[i]=x;nearestZ[i]=z;}
  };
  const edge=(a:number,b:number)=>{
    const ah=height(a),bh=height(b);if((ah<waterLevel)===(bh<waterLevel))return;
    const t=(waterLevel-ah)/(bh-ah),x=a%n+(b%n-a%n)*t,z=Math.floor(a/n)+(Math.floor(b/n)-Math.floor(a/n))*t;
    offer(a,x,z);offer(b,x,z);
  };
  for(let z=0;z<n;z++)for(let x=0;x<n;x++){
    const i=z*n+x;
    if(x<n-1)edge(i,i+1);
    if(z<n-1)edge(i,i+n);
    if(x<n-1&&z<n-1)edge(i,i+n+1);
  }
  // Propagate sub-cell crossings in linear time, only when the terrain changes.
  for(const reverse of [false,true]){
    const step=reverse?-1:1,from=reverse?n-1:0,to=reverse?-1:n;
    for(let z=from;z!==to;z+=step)for(let x=from;x!==to;x+=step){
      const i=z*n+x;
      for(const [dx,dz] of [[-step,0],[-step,-step],[0,-step],[step,-step]]){
        const nx=x+dx,nz=z+dz;if(nx<0||nz<0||nx>=n||nz>=n)continue;
        const neighbor=nz*n+nx;if(!Number.isFinite(squared[neighbor]))continue;
        offer(i,nearestX[neighbor],nearestZ[neighbor]);
      }
    }
  }
  const pixels=new Uint16Array(total),half=THREE.DataUtils.toHalfFloat;
  for(let i=0;i<total;i++){
    const distance=Math.sqrt(squared[i]),sign=height(i)<waterLevel?1:-1;
    pixels[i]=half(sign*Math.min(64,distance*cell));
  }
  const texture=new THREE.DataTexture(pixels,n,n,THREE.RedFormat,THREE.HalfFloatType);
  texture.name='water-shore-distance';texture.minFilter=texture.magFilter=THREE.LinearFilter;
  texture.generateMipmaps=false;texture.needsUpdate=true;return texture;
}

// Keep the geometry in world space as the camera moves: the grid supplies LOD,
// while the animated height field stays anchored to the terrain. Geometry waves
// and capillary normals are separate, as in Minecraft's water shader pipelines.
const WATER_GRID_SEGMENTS=192;
const WATER_GRID_CELL=.75;
const WATER_ENVIRONMENT_REFLECTION_GAIN=.58;
const waterDisplacementShader=/* glsl */`
  uniform float waterTime;
  uniform sampler2D waterSwellMap;
  uniform sampler2D waterShoreline;
  uniform vec4 waterTerrainGrid;
  uniform float waterLevel;
  uniform vec2 waterDetailCenter;
  float waterGridOffset(float index){
    float a=abs(index);
    // Match the inner grid spacing before gradually widening the outer cells.
    return sign(index)*${WATER_GRID_CELL}*(min(a,64.0)+(exp2(max(a-64.0,0.0)*0.15)-1.0)*9.617967);
  }
  float waterSurfaceDetail(vec2 position){
    float distanceToCamera=length(vec3(position.x-cameraPosition.x,waterLevel-cameraPosition.y,position.y-cameraPosition.z));
    return 1.0-smoothstep(50.0,135.0,distanceToCamera);
  }
  float waterSurfaceHeight(vec2 position){
    float detail=waterSurfaceDetail(position);
    if(detail<=0.0)return 0.0;
    vec2 grid=clamp((position-waterTerrainGrid.xy)/waterTerrainGrid.z,vec2(0.0),vec2(waterTerrainGrid.w-1.0));
    float shoreDistance=textureLod(waterShoreline,(grid+0.5)/waterTerrainGrid.w,0.0).r;
    float coast=1.0-smoothstep(2.0,12.0,max(0.0,shoreDistance));
    // Let crests cross the mean shoreline instead of pinning every edge vertex
    // to sea level. Fade out on dry ground so inland depressions stay dry.
    float dryFade=1.0-smoothstep(0.35,1.8,max(0.0,-shoreDistance));
    vec2 uv=position/42.0;
    float broad=waterNoiseSample(waterSwellMap,uv,vec2(waterTime*0.006,-waterTime*0.004)).z;
    float crossed=waterNoiseSample(waterSwellMap,mat2(0.8,0.6,-0.6,0.8)*uv*1.73+0.37,vec2(-waterTime*0.005,waterTime*0.007)).z;
    // Break up crests along the coastline as well as across it; a constant
    // shore phase would merely raise a straight waterline up and down.
    float phase=shoreDistance*1.8+waterTime*1.65+broad*8.0+crossed*5.0;
    float shoreWave=sin(phase)*0.18+sin(phase*1.67+crossed*3.0+waterTime*0.23)*0.045;
    // Short waves fade before the outer grid becomes too coarse for them.
    float shoreDetail=1.0-smoothstep(38.0,78.0,length(vec3(position.x-cameraPosition.x,waterLevel-cameraPosition.y,position.y-cameraPosition.z)));
    return ((broad*0.32+crossed*0.14)*detail+shoreWave*coast*shoreDetail)*dryFade;
  }
`;

function waterMaterial(time:{value:number},reflection:WaterReflectionUniforms,terrain:TerrainField,level:number){
  // Match the rendered ground's 2.5 cm offset and actual triangle diagonal.
  // Bilinear filtering would put the shallow-water transition off the bank.
  const heights=new THREE.DataTexture(Float32Array.from(terrain.heights,h=>h-.025),terrain.resolution,terrain.resolution,THREE.RedFormat,THREE.FloatType);
  heights.name='water-bottom-heightfield';heights.minFilter=heights.magFilter=THREE.NearestFilter;heights.generateMipmaps=false;heights.needsUpdate=true;
  const shoreline=waterShoreline(terrain,level);
  const material=new THREE.MeshPhysicalMaterial({color:0xffffff,roughness:.14,metalness:0,ior:1.333,transmission:1,thickness:1,attenuationColor:new THREE.Color(0x7badb7),attenuationDistance:2.5,specularIntensity:1,envMapIntensity:1,normalMap:waterNoise('ripple')});
  const detailCenter={value:new THREE.Vector2()};
  material.name='terrain-water-PBR';
  material.addEventListener('dispose',()=>{heights.dispose();shoreline.dispose();});
  material.onBeforeCompile=shader=>{
    shader.uniforms.waterTime=time;
    shader.uniforms.waterReflection=reflection.map;
    shader.uniforms.waterReflectionMatrix=reflection.matrix;
    shader.uniforms.waterReflectionReady=reflection.ready;
    shader.uniforms.waterTerrain={value:heights};
    shader.uniforms.waterShoreline={value:shoreline};
    shader.uniforms.waterSwellMap={value:waterNoise('swell')};
    shader.uniforms.waterDetailCenter=detailCenter;
    shader.uniforms.waterTerrainGrid={value:new THREE.Vector4(terrain.originX,terrain.originZ,terrain.cellSize,terrain.resolution)};
    shader.uniforms.waterLevel={value:level-.03};
    shader.uniforms.waterScatterColor={value:new THREE.Color(0x244950)};
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      ${waterSamplingShader}
      ${waterDisplacementShader}
      uniform mat4 waterReflectionMatrix;
      varying vec2 waterPosition;
      varying vec4 waterSurface;
      varying vec4 waterMirrorCoord;`).replace('#include <begin_vertex>',`#include <begin_vertex>
      vec2 waterIndex=vec2(position.x,-position.y)*${WATER_GRID_SEGMENTS/2}.0;
      vec2 waterMin=waterTerrainGrid.xy,waterMax=waterMin+vec2(waterTerrainGrid.z*(waterTerrainGrid.w-1.0));
      waterPosition=clamp(waterDetailCenter+vec2(waterGridOffset(waterIndex.x),waterGridOffset(waterIndex.y)),waterMin,waterMax);
      // The last row spans the rest of the map. Its height is already zero at
      // this distance, joining the detailed centre to a flat far surface.
      if(waterIndex.x<=-${WATER_GRID_SEGMENTS/2}.0)waterPosition.x=waterMin.x;
      if(waterIndex.x>=${WATER_GRID_SEGMENTS/2}.0)waterPosition.x=waterMax.x;
      if(waterIndex.y<=-${WATER_GRID_SEGMENTS/2}.0)waterPosition.y=waterMin.y;
      if(waterIndex.y>=${WATER_GRID_SEGMENTS/2}.0)waterPosition.y=waterMax.y;
      float waterHeight=waterSurfaceHeight(waterPosition);
      // Derive lighting normals from the same height function as displacement.
      // Interpolation keeps the close grid smooth without per-pixel height taps.
      vec2 waterHeightSlope=-(vec2(waterSurfaceHeight(waterPosition+vec2(0.25,0.0)),waterSurfaceHeight(waterPosition+vec2(0.0,0.25)))-waterHeight)/0.25;
      waterSurface=vec4(waterHeight,waterHeightSlope,waterSurfaceDetail(waterPosition));
      vec2 waterLocal=waterPosition-(waterMin+waterMax)*0.5;
      transformed=vec3(waterLocal.x,-waterLocal.y,waterHeight);
      waterMirrorCoord=waterReflectionMatrix*vec4(transformed,1.0);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      #define WATER_FRAGMENT_SAMPLE
      ${waterSamplingShader}
      uniform float waterTime;
      uniform sampler2D waterReflection;
      uniform mat4 waterReflectionMatrix;
      uniform float waterReflectionReady;
      uniform sampler2D waterTerrain;
      uniform sampler2D waterShoreline;
      uniform sampler2D waterSwellMap;
      uniform vec4 waterTerrainGrid;
      uniform float waterLevel;
      uniform vec3 waterScatterColor;
      varying vec2 waterPosition;
      varying vec4 waterSurface;
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
      float waterDepth=max(0.0,waterLevel+waterSurface.x-waterBottomHeight(waterPosition));
      vec2 waterGrid=clamp((waterPosition-waterTerrainGrid.xy)/waterTerrainGrid.z,vec2(0.0),vec2(waterTerrainGrid.w-1.0));
      float waterShoreDistance=max(0.0,texture2D(waterShoreline,(waterGrid+0.5)/waterTerrainGrid.w).r);
      vec2 waterUv=waterPosition/20.0;
      vec4 rippleA=waterNoiseSample(normalMap,waterUv,vec2(waterTime*0.015,waterTime*0.009));
      vec4 rippleB=waterNoiseSample(normalMap,mat2(0.6,-0.8,0.8,0.6)*waterUv*2.9,vec2(-waterTime*0.023,waterTime*0.019));
      rippleB.xy=vec2(0.6*rippleB.x-0.8*rippleB.y,0.8*rippleB.x+0.6*rippleB.y);
      float waterFootprint=length(fwidth(waterPosition));
      float waterDetail=1.0-smoothstep(0.18,1.8,waterFootprint);
      // Carry visible wave faces beyond the local geometry instead of leaving
      // the horizon as a nearly horizontal reflecting sheet.
      vec2 waterMacroUv=waterPosition/42.0;
      vec4 waterFarA=waterNoiseSample(waterSwellMap,waterMacroUv,vec2(waterTime*0.006,-waterTime*0.004));
      vec4 waterFarB=waterNoiseSample(waterSwellMap,mat2(0.8,0.6,-0.6,0.8)*waterMacroUv*1.73+0.37,vec2(-waterTime*0.005,waterTime*0.007));
      waterFarB.xy=vec2(0.8*waterFarB.x+0.6*waterFarB.y,-0.6*waterFarB.x+0.8*waterFarB.y);
      float waterBroadWeight=1.0-waterSurface.w;
      float waterBroadDetail=1.0-smoothstep(1.5,10.0,waterFootprint);
      vec2 waterFarSlope=(waterFarA.xy*0.38+waterFarB.xy*0.24)*waterBroadWeight*waterBroadDetail;
      float waterCoast=(1.0-smoothstep(2.0,11.0,waterShoreDistance))*smoothstep(0.0,0.06,waterDepth);
      // Restrain fine normals at grazing angles; geometry supplies the bank's
      // changing silhouette instead of increasingly distorted flat reflections.
      vec3 waterView=inverseTransformDirection(normalize(vViewPosition),viewMatrix);
      float waterGrazing=mix(0.4,1.0,smoothstep(0.02,0.5,abs(waterView.y)));
      float waterRippleStrength=(1.15+waterCoast*0.25)*waterGrazing;
      vec2 waterSlope=waterSurface.yz+waterFarSlope+(rippleA.xy+rippleB.xy*0.55)*waterDetail*waterRippleStrength;
      normal=normalize(mat3(viewMatrix)*vec3(waterSlope.x,1.0,waterSlope.y));
      // Transfer filtered and deliberately faded detail into the specular lobe
      // instead of turning the distant surface back into a perfect mirror.
      float waterResolvedEnergy=dot(rippleA.xy,rippleA.xy)+0.3025*dot(rippleB.xy,rippleB.xy);
      float waterMissingVariance=(rippleA.w+0.3025*rippleB.w+waterResolvedEnergy*(1.0-waterDetail*waterDetail))*waterRippleStrength*waterRippleStrength;
      float waterBroadResolvedEnergy=0.1444*dot(waterFarA.xy,waterFarA.xy)+0.0576*dot(waterFarB.xy,waterFarB.xy);
      waterMissingVariance+=(0.1444*waterFarA.w+0.0576*waterFarB.w+waterBroadResolvedEnergy*(1.0-waterBroadDetail*waterBroadDetail))*waterBroadWeight*waterBroadWeight;
      vec2 waterSlopeDx=dFdx(waterSlope),waterSlopeDy=dFdy(waterSlope);
      float waterPixelVariance=0.25*(dot(waterSlopeDx,waterSlopeDx)+dot(waterSlopeDy,waterSlopeDy));
      float waterBaseRoughness=roughnessFactor+waterCoast*0.03;
      roughnessFactor=clamp(pow(pow(waterBaseRoughness,4.0)+2.0*(waterMissingVariance+min(waterPixelVariance,0.04)),0.25),0.14,0.48);
      `).replace('#include <lights_fragment_maps>',`#include <lights_fragment_maps>
      // Project the change in reflected ray direction. A small screen-space
      // normal offset leaves recognisable clouds pasted over the wave pattern.
      vec2 waterReflectionUv=waterMirrorCoord.xy/max(waterMirrorCoord.w,0.0001);
      vec3 waterReflectedRay=reflect(-waterView,normalize(vec3(waterSlope.x,1.0,waterSlope.y)));
      vec3 waterFlatRay=reflect(-waterView,vec3(0.0,1.0,0.0));
      // The plane's local XY maps to world X/-Z; directions have no translation.
      vec4 waterRayCoord=waterReflectionMatrix*vec4(waterReflectedRay.x,-waterReflectedRay.z,waterReflectedRay.y,0.0);
      vec4 waterFlatCoord=waterReflectionMatrix*vec4(waterFlatRay.x,-waterFlatRay.z,waterFlatRay.y,0.0);
      waterReflectionUv+=waterRayCoord.xy/max(waterRayCoord.w,0.0001)-waterFlatCoord.xy/max(waterFlatCoord.w,0.0001);
      float waterProjectionValid=step(0.0001,waterRayCoord.w)*step(0.0001,waterFlatCoord.w);
      // Filter the planar capture with the same effective roughness as the BRDF.
      // A small five-tap kernel softens mip boundaries without another scene pass.
      vec2 waterReflectionSize=vec2(textureSize(waterReflection,0));
      float waterMaxMip=log2(max(waterReflectionSize.x,waterReflectionSize.y));
      float waterReflectionCone=material.roughness*material.roughness*mix(0.55,1.4,1.0-abs(waterView.y));
      float waterReflectionLod=clamp(log2(max(1.0,waterReflectionCone*max(waterReflectionSize.x,waterReflectionSize.y))),0.0,waterMaxMip-2.0);
      vec2 waterFilterRadius=exp2(waterReflectionLod)/waterReflectionSize*0.7;
      vec2 waterReflectionMargin=vec2(0.02)+waterFilterRadius*1.5;
      vec2 waterReflectionEdge=smoothstep(vec2(0.0),waterReflectionMargin,waterReflectionUv)
        *(1.0-smoothstep(vec2(1.0)-waterReflectionMargin,vec2(1.0),waterReflectionUv));
      float waterReflectionWeight=waterReflectionReady*waterProjectionValid*waterReflectionEdge.x*waterReflectionEdge.y;
      vec2 waterReflectionSampleUv=clamp(waterReflectionUv,waterFilterRadius+0.001,vec2(0.999)-waterFilterRadius);
      vec3 waterReflectedLight=textureLod(waterReflection,waterReflectionSampleUv,waterReflectionLod).rgb*0.4;
      waterReflectedLight+=(textureLod(waterReflection,waterReflectionSampleUv+vec2(waterFilterRadius.x,0.0),waterReflectionLod).rgb
        +textureLod(waterReflection,waterReflectionSampleUv-vec2(waterFilterRadius.x,0.0),waterReflectionLod).rgb
        +textureLod(waterReflection,waterReflectionSampleUv+vec2(0.0,waterFilterRadius.y),waterReflectionLod).rgb
        +textureLod(waterReflection,waterReflectionSampleUv-vec2(0.0,waterFilterRadius.y),waterReflectionLod).rgb)*0.15;
      // Apply the same water-only gain to the planar capture and HDR fallback.
      // Fresnel and direct sunlight stay in the physical BRDF, so the sun can
      // still sparkle without the whole sky covering the water in pale light.
      radiance=mix(radiance,waterReflectedLight,waterReflectionWeight)*${WATER_ENVIRONMENT_REFLECTION_GAIN};`)
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
  material.customProgramCacheKey=()=> 'terrain-water-balanced-reflection-v9';return {material,detailCenter};
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

/** One shared mean level for every terrain, including hand-drawn maps. Nearby
 * waves move the real surface; terrain depth still occludes it on dry ground. */
export class TerrainWater {
  readonly group=new THREE.Group();
  private readonly clock={value:0};
  private readonly waveTime={value:0};
  private readonly reflection:Reflector;
  private constructor(readonly level:number,private terrain:TerrainField,quays:QuayEdge[],assets?:SceneAssets){
    this.group.name='terrain-sea-level-water';
    const geometry=new THREE.PlaneGeometry(2,2,WATER_GRID_SEGMENTS,WATER_GRID_SEGMENTS);
    // The helper only captures the reflected view; the visible surface retains
    // physical lighting, depth occlusion, fog and a shared mean water level.
    this.reflection=new Reflector(geometry,{textureWidth:512,textureHeight:512,clipBias:.001,multisample:0});
    // WebGLRenderer refreshes this mip chain after each reflection capture.
    const reflectionTexture=this.reflection.getRenderTarget().texture;
    reflectionTexture.generateMipmaps=true;reflectionTexture.minFilter=THREE.LinearMipmapLinearFilter;
    const reflectionMaterial=this.reflection.material as THREE.ShaderMaterial;
    const reflection:WaterReflectionUniforms={map:{value:this.reflection.getRenderTarget().texture},matrix:reflectionMaterial.uniforms.textureMatrix,ready:{value:0}};
    const {material,detailCenter}=waterMaterial(this.waveTime,reflection,terrain,level);
    const mesh=new THREE.Mesh(geometry,material);
    mesh.rotation.x=-Math.PI/2;
    mesh.position.set(terrain.originX+terrain.size/2,level-.03,terrain.originZ+terrain.size/2);
    // The shader spreads this grid across the terrain, with 75 cm cells near
    // the camera and progressively coarser rows outside the displacement band.
    mesh.name='terrain-water-local-waves';mesh.receiveShadow=true;mesh.frustumCulled=false;
    let lastReflection=-Infinity;
    const reflectedView=new THREE.Matrix4(),reflectedProjection=new THREE.Matrix4();
    mesh.onBeforeRender=(renderer,scene,camera,geo,material,group)=>{
      const cameraPosition=camera.matrixWorld.elements;
      detailCenter.value.set(Math.round(cameraPosition[12]/WATER_GRID_CELL)*WATER_GRID_CELL,Math.round(cameraPosition[14]/WATER_GRID_CELL)*WATER_GRID_CELL);
      // Static views need only 30 captures/sec; camera movement refreshes the
      // projection immediately. Ripple animation always runs at display rate.
      if(this.clock.value-lastReflection<1/30&&reflectedView.equals(camera.matrixWorld)&&reflectedProjection.equals(camera.projectionMatrix))return;
      this.reflection.matrixWorld.copy(mesh.matrixWorld);
      this.reflection.camera.layers.mask=camera.layers.mask;
      mesh.visible=false;
      const backgroundIntensity=scene.backgroundIntensity;
      try{
        // The visible sky uses a brighter exposure than scene.environment.
        // Capture it at the lighting exposure to match HDR fallback radiance.
        if(scene.environment)scene.backgroundIntensity=scene.environmentIntensity;
        this.reflection.onBeforeRender(renderer,scene,camera,geo,material,group);
        reflection.ready.value=1;lastReflection=this.clock.value;
        reflectedView.copy(camera.matrixWorld);reflectedProjection.copy(camera.projectionMatrix);
      }finally{scene.backgroundIntensity=backgroundIntensity;mesh.visible=true;}
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
  update(time:number){this.clock.value=time;this.waveTime.value=time*2;}
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
