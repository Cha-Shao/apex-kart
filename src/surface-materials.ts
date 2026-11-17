import * as THREE from 'three';
import {foliageAlphaTestGLSL} from './foliage-cutout';
import {vegetationPaletteGLSL,grassPaletteGLSL} from './vegetation-palette';

export const ASPHALT_TEXTURE_METRES=1.2;

// Original implementation of triangular stochastic sampling. Reference:
// Mikkelsen, Practical Real-Time Hex-Tiling, JCGT 11(3), 2022.
// All PBR channels use the same cells/transforms; normal XY is rotated back.
const stochasticGLSL=/* glsl */`
vec2 surfaceHash(vec2 p){
  return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);
}
float surfaceNoise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(surfaceHash(i).x,surfaceHash(i+vec2(1,0)).x,f.x),mix(surfaceHash(i+vec2(0,1)).x,surfaceHash(i+vec2(1,1)).x,f.x),f.y);
}
void surfaceCells(vec2 uv,out vec2 a,out vec2 b,out vec2 c,out vec3 weights){
  #ifdef SURFACE_ASPHALT_DETAIL
  // Blend before a source tile can repeat inside a single stochastic cell.
  vec2 skew=mat2(1.0,0.0,-0.577350269,1.154700538)*(uv*1.85);
  #else
  vec2 skew=mat2(1.0,0.0,-0.577350269,1.154700538)*(uv*0.65);
  #endif
  vec2 cell=floor(skew),f=fract(skew);float z=1.0-f.x-f.y;
  if(z>0.0){a=cell;b=cell+vec2(0,1);c=cell+vec2(1,0);weights=vec3(z,f.y,f.x);}
  else{a=cell+vec2(1,1);b=cell+vec2(1,0);c=cell+vec2(0,1);weights=vec3(-z,1.0-f.y,1.0-f.x);}
  #ifdef SURFACE_ASPHALT_DETAIL
  weights=max(weights,vec3(0.0));weights*=weights;weights/=dot(weights,vec3(1.0));
  #else
  weights=pow(max(weights,vec3(0.0)),vec3(5.0));weights/=dot(weights,vec3(1.0));
  #endif
}
mat2 surfaceRotation(vec2 cell){
  #ifdef SURFACE_ASPHALT_DETAIL
  float angle=surfaceHash(cell+17.0).x*6.283185307,c=cos(angle),s=sin(angle);
  #else
  float angle=floor(surfaceHash(cell+17.0).x*4.0)*1.570796327,c=cos(angle),s=sin(angle);
  #endif
  return mat2(c,s,-s,c);
}
float surfaceScale(vec2 cell){
  #ifdef SURFACE_ASPHALT_DETAIL
  return .85+surfaceHash(cell+43.0).y*.3;
  #else
  return 1.0;
  #endif
}
vec4 surfaceTap(sampler2D tex,vec2 uv,vec2 cell,vec2 dx,vec2 dy){
  mat2 r=surfaceRotation(cell)*surfaceScale(cell);
  return textureGrad(tex,r*uv+surfaceHash(cell)*19.0,r*dx,r*dy);
}
vec4 surfaceSample(sampler2D tex,vec2 uv){
  vec2 a,b,c;vec3 w;surfaceCells(uv,a,b,c,w);vec2 dx=dFdx(uv),dy=dFdy(uv);
  return surfaceTap(tex,uv,a,dx,dy)*w.x+surfaceTap(tex,uv,b,dx,dy)*w.y+surfaceTap(tex,uv,c,dx,dy)*w.z;
}
#ifdef SURFACE_ASPHALT_DETAIL
vec4 surfaceGrainTap(sampler2D tex,vec2 uv,vec2 cell,vec2 dx,vec2 dy,float lowLod){
  mat2 r=surfaceRotation(cell)*surfaceScale(cell);vec2 q=r*uv+surfaceHash(cell)*19.0;
  vec4 grain=textureGrad(tex,q,r*dx,r*dy);
  // Remove source stains while retaining the aggregate-sized colour detail.
  // The coarse sample comes from the existing, heavily cached mip chain.
  vec3 localMean=textureLod(tex,q,lowLod).rgb;
  grain.rgb=clamp(grain.rgb/max(localMean,vec3(.005)),vec3(.5),vec3(1.8));return grain;
}
#endif
vec4 surfaceColor(sampler2D tex,vec2 uv){
  #ifdef SURFACE_ASPHALT_DETAIL
  vec2 a,b,c;vec3 w;surfaceCells(uv,a,b,c,w);vec2 dx=dFdx(uv),dy=dFdy(uv);
  vec2 texels=vec2(textureSize(tex,0)),gx=dx*texels,gy=dy*texels;
  // Keep the high-pass window wider than the pixel footprint at distance.
  float lowLod=max(5.0,.5*log2(max(max(dot(gx,gx),dot(gy,gy)),1.0))+2.0);
  vec4 grain=surfaceGrainTap(tex,uv,a,dx,dy,lowLod)*w.x+surfaceGrainTap(tex,uv,b,dx,dy,lowLod)*w.y+surfaceGrainTap(tex,uv,c,dx,dy,lowLod)*w.z;
  grain.rgb*=textureLod(tex,vec2(.5),16.0).rgb;return grain;
  #else
  return surfaceSample(tex,uv);
  #endif
}
vec3 surfaceNormalTap(sampler2D tex,vec2 uv,vec2 cell,vec2 dx,vec2 dy){
  mat2 r=surfaceRotation(cell);vec3 n=surfaceTap(tex,uv,cell,dx,dy).xyz*2.0-1.0;
  n.xy=transpose(r)*n.xy;return n;
}
vec3 surfaceNormal(sampler2D tex,vec2 uv){
  vec2 a,b,c;vec3 w;surfaceCells(uv,a,b,c,w);vec2 dx=dFdx(uv),dy=dFdy(uv);
  return normalize(surfaceNormalTap(tex,uv,a,dx,dy)*w.x+surfaceNormalTap(tex,uv,b,dx,dy)*w.y+surfaceNormalTap(tex,uv,c,dx,dy)*w.z);
}
vec4 surfaceAggregateTap(sampler2D tex,vec2 uv,vec2 cell,vec2 dx,vec2 dy){
  vec4 detail=surfaceTap(tex,uv,cell,dx,dy);
  detail.rg=(transpose(surfaceRotation(cell))*(detail.rg*2.0-1.0))*.5+.5;return detail;
}
vec4 surfaceAggregateSample(sampler2D tex,vec2 uv){
  vec2 a,b,c;vec3 w;surfaceCells(uv,a,b,c,w);vec2 dx=dFdx(uv),dy=dFdy(uv);
  return surfaceAggregateTap(tex,uv,a,dx,dy)*w.x+surfaceAggregateTap(tex,uv,b,dx,dy)*w.y+surfaceAggregateTap(tex,uv,c,dx,dy)*w.z;
}
`;

export interface RoadWearUniforms {
  map:{value:THREE.Texture|null};
  size:{value:THREE.Vector2};
}
interface ReliefSettings {
  roughnessCenter?:number;
  roughnessContrast?:number;
  roughnessMin?:number;
  roughnessMax?:number;
  sourceRoughness?:number;
  specular?:number;
  /** Packed mesoscopic relief: RG normal, B roughness, A height. */
  aggregate?:THREE.Texture;
  aggregateStrength?:number;
  ground?:'grass'|'asphalt';
  roadWear?:RoadWearUniforms;
  albedoGain?:number;
}
export function stochasticSurface(material:THREE.MeshStandardMaterial,metres:number,variation:number,settings:ReliefSettings={}){
  const {roughnessCenter=.9,roughnessContrast=1,roughnessMin=.78,roughnessMax=1,sourceRoughness=.65,specular=1,aggregate,aggregateStrength=.8,ground,roadWear,albedoGain=1}=settings;
  material.onBeforeCompile=shader=>{
    if(aggregate)shader.uniforms.surfaceAggregateMap={value:aggregate};
    if(roadWear){shader.uniforms.roadWearMap=roadWear.map;shader.uniforms.roadWearSize=roadWear.size;}
    const mapChunk=THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )','surfaceColor( map, vMapUv )');
    const aggregateMap=aggregate?`
      #ifdef USE_MAP
      vec4 surfaceAggregate=surfaceAggregateSample(surfaceAggregateMap,vMapUv);
      #endif\n`:'';
    const aggregateAlbedo=aggregate?`diffuseColor.rgb*=mix(${ground==='grass'?'.91,1.04':'.96,1.035'},smoothstep(.18,.82,surfaceAggregate.a));`:'';
    const aggregateRoughness=aggregate?(ground==='grass'?'+(surfaceAggregate.b-.94)*.45':'+(surfaceAggregate.b-.87)*.1'):'';
    const groundAlbedo=ground==='grass'?`
      vec2 lawnWorld=vMapUv*${metres.toFixed(4)};
      float lawnPatch=surfaceNoise(lawnWorld/22.0)*.6+surfaceNoise(lawnWorld/73.0+19.0)*.4;
      diffuseColor.rgb*=mix(vec3(.74,.87,.73),vec3(1.03,1.01,.88),smoothstep(.15,.85,lawnPatch));
      float lawnClumps=surfaceNoise(lawnWorld/3.6);
      float lawnFine=surfaceNoise(lawnWorld*2.4+vec2(17.3,41.7));
      float lawnGrowth=surfaceNoise(lawnWorld/7.0+vec2(8.1,19.4));
      float lawnDry=smoothstep(.56,.84,surfaceNoise(lawnWorld/16.0+vec2(53.7,6.2)));
      diffuseColor.rgb*=.91+lawnClumps*.1+lawnFine*.045+lawnGrowth*.055;
      diffuseColor.rgb*=mix(vec3(1.0),vec3(1.08,1.025,.92),lawnDry*.45);
    `:ground==='asphalt'?`
      vec2 asphaltWorld=vMapUv*${metres.toFixed(4)};
      float repairMask=smoothstep(.63,.82,surfaceNoise(asphaltWorld/14.0+71.0))*smoothstep(.35,.7,surfaceNoise(asphaltWorld/4.8));
      diffuseColor.rgb*=1.0-repairMask*.14;
    `:'';
    const roadAlbedo=roadWear?`
      vec2 rubberUv=vec2(vRoadUv.y/roadWearSize.y+.5,vRoadUv.x/roadWearSize.x);
      float roadRubber=texture2D(roadWearMap,rubberUv).r;
      // Retain the asphalt grain beneath dry, dark rubber deposits.
      diffuseColor.rgb*=1.0-roadRubber*.82;
    `:'';
    const roughnessChunk=`
      float roughnessFactor=roughness;
      #ifdef USE_ROUGHNESSMAP
      float surfaceRoughness=surfaceSample(roughnessMap,vRoughnessMapUv).g;
      roughnessFactor=clamp(${roughnessCenter.toFixed(4)}+(surfaceRoughness-${sourceRoughness.toFixed(4)})*${roughnessContrast.toFixed(4)}${aggregateRoughness},${roughnessMin.toFixed(4)},${roughnessMax.toFixed(4)});
      #endif
      ${roadWear?'#ifdef USE_MAP\nroughnessFactor=max(.72,roughnessFactor-roadRubber*.13);\n#endif':''}`;
    let normalChunk=THREE.ShaderChunk.normal_fragment_maps.replaceAll('texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0','surfaceNormal( normalMap, vNormalMapUv )');
    if(aggregate)normalChunk=normalChunk.replace('mapN.xy *= normalScale;',`mapN.xy *= normalScale;\nmapN=normalize(vec3(mapN.xy/max(mapN.z,.1)+(surfaceAggregate.rg*2.0-1.0)*${aggregateStrength.toFixed(4)},1.0));`);
    if(roadWear)shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute vec2 roadUv;varying vec2 vRoadUv;').replace('#include <uv_vertex>','#include <uv_vertex>\nvRoadUv=roadUv;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\n${aggregate?'uniform sampler2D surfaceAggregateMap;':''}\n${roadWear?'varying vec2 vRoadUv;uniform sampler2D roadWearMap;uniform vec2 roadWearSize;':''}\n${ground==='asphalt'?'#define SURFACE_ASPHALT_DETAIL\n':''}${stochasticGLSL}\n${ground==='grass'?grassPaletteGLSL:''}`)
      .replace('#include <map_fragment>',aggregateMap+mapChunk+`
        #ifdef USE_MAP
        float surfaceMacro=surfaceNoise(vMapUv*${(metres/37).toFixed(8)})*.7+surfaceNoise(vMapUv*${(metres/103).toFixed(8)}+31.0)*.3;
        diffuseColor.rgb*=1.0+(surfaceMacro-.5)*${variation.toFixed(4)};
        ${aggregateAlbedo}
        ${groundAlbedo}
        ${roadAlbedo}
        diffuseColor.rgb*=${albedoGain.toFixed(4)};
        #endif`)
      .replace('#include <color_fragment>',`#include <color_fragment>${ground==='grass'?`
        #ifdef USE_MAP
        diffuseColor.rgb=grassAlbedo(diffuseColor.rgb,lawnWorld,.074);
        #endif
      `:''}`)
      .replace('#include <roughnessmap_fragment>',roughnessChunk+(ground==='grass'?'\nroughnessFactor=clamp(roughnessFactor+(lawnClumps-.5)*.055+(lawnFine-.5)*.025,.86,1.0);':''))
      .replace('#include <normal_fragment_maps>',normalChunk)
      .replace('#include <lights_physical_fragment>',`#include <lights_physical_fragment>\nmaterial.specularColor*=${specular.toFixed(4)};material.specularF90*=${specular.toFixed(4)};`);
  };
  material.customProgramCacheKey=()=>`stochastic-relief-v13-${metres}-${variation}-${roughnessCenter}-${roughnessContrast}-${roughnessMin}-${roughnessMax}-${sourceRoughness}-${specular}-${!!aggregate}-${aggregateStrength}-${ground}-${!!roadWear}-${albedoGain}`;
  material.userData.stochastic=true;return material;
}

/** Two-metre, tileable grass heightfield. Broad tufts survive the mip levels
 * that filter out the source map's tiny blades at driving distance. */
export function grassReliefTexture(){
  const size=512,metres=2,heights=new Float32Array(size*size),data=new Uint8Array(size*size*4);
  let seed=4381;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const layers=[{cells:8,height:.016},{cells:24,height:.016},{cells:64,height:.006}].map(layer=>({...layer,values:Float32Array.from({length:layer.cells*layer.cells},random)}));
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    let height=0;
    for(const layer of layers){
      const {cells,values}=layer,px=x/size*cells,py=y/size*cells,ix=Math.floor(px),iy=Math.floor(py),fx=px-ix,fy=py-iy,sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
      const a=values[iy*cells+ix],b=values[iy*cells+(ix+1)%cells],c=values[((iy+1)%cells)*cells+ix],d=values[((iy+1)%cells)*cells+(ix+1)%cells];
      height+=((a+(b-a)*sx)*(1-sy)+(c+(d-c)*sx)*sy)*layer.height;
    }
    heights[y*size+x]=height;
  }
  const at=(x:number,y:number)=>heights[((y+size)%size)*size+(x+size)%size],slope=1/(2*metres/size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const dx=(at(x+1,y)-at(x-1,y))*slope,dy=(at(x,y+1)-at(x,y-1))*slope,length=Math.hypot(dx,dy,1),i=(y*size+x)*4,h=at(x,y)/.038;
    data[i]=Math.round((.5-dx/length*.5)*255);data[i+1]=Math.round((.5-dy/length*.5)*255);
    data[i+2]=Math.round((.98-h*.08)*255);data[i+3]=Math.round(h*255);
  }
  const texture=new THREE.DataTexture(data,size,size);texture.name='grass-tuft-normal-roughness-height';texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.generateMipmaps=true;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.needsUpdate=true;texture.userData.sharedCC0=true;return texture;
}

/** One packed tile: RG = tangent normal, B = roughness, A = aggregate height.
 * Adds fine, embedded stone to the CC0 grain. It is mipmapped,
 * rotates with the source PBR channels and contains no recognisable cracks. */
export function asphaltAggregateTexture(){
  const size=512,cells=128,heights=new Float32Array(size*size),data=new Uint8Array(size*size*4),centers=new Float32Array(cells*cells*4);
  let seed=9173;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<cells*cells;i++){centers[i*4]=.16+random()*.68;centers[i*4+1]=.16+random()*.68;centers[i*4+2]=.28+random()*.18;centers[i*4+3]=.65+random()*.35;}
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const fx=x/size*cells,fy=y/size*cells,ix=Math.floor(fx),iy=Math.floor(fy);let height=.12;
    for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){
      const index=(((iy+j+cells)%cells)*cells+(ix+i+cells)%cells)*4,dx=fx-(ix+i+centers[index]),dy=fy-(iy+j+centers[index+1]),distance=Math.hypot(dx,dy)/centers[index+2];
      const shoulder=Math.max(0,Math.min(1,(1-distance)*4)),dome=Math.max(0,1-distance*distance);
      height=Math.max(height,.12+centers[index+3]*(shoulder*shoulder*(3-2*shoulder))*(.48+.32*dome));
    }
    heights[y*size+x]=height;
  }
  const at=(x:number,y:number)=>heights[((y+size)%size)*size+(x+size)%size];
  // Sub-millimetre exposed relief: the small stones sit in compacted binder.
  const slope=.00055/(ASPHALT_TEXTURE_METRES/size*2);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const dx=(at(x+1,y)-at(x-1,y))*slope,dy=(at(x,y+1)-at(x,y-1))*slope,length=Math.hypot(dx,dy,1),i=(y*size+x)*4,h=at(x,y);
    data[i]=Math.round((.5-dx/length*.5)*255);data[i+1]=Math.round((.5-dy/length*.5)*255);data[i+2]=Math.round((.91-h*.1)*255);data[i+3]=Math.round(h*255);
  }
  const texture=new THREE.DataTexture(data,size,size);texture.name='asphalt-aggregate-normal-roughness';texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.generateMipmaps=true;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.needsUpdate=true;texture.userData.sharedCC0=true;return texture;
}

/** Boundary overlays share the original PBR shading. Soil remains below
 * paving; grass tips and loose gravel sit just above their receiving surface.
 * verge.x is metres outside the paved edge; verge.y selects road (+1) or
 * lighter runoff (-1), with zero reserved for kerbs and gravel. */
export function roadsideMaterial(source:THREE.MeshStandardMaterial,surface:'grass'|'grass-fringe'|'asphalt'|'runoff'|'gravel'='grass'){
  const asphalt=surface==='asphalt'||surface==='runoff',fringe=surface==='grass-fringe',material=source.clone();material.name=asphalt?`irregular-${surface}-fringe`:surface==='gravel'?'loose-gravel-spill':fringe?'grass-overhanging-paved-edge':'worn-grass-verge';
  material.transparent=true;material.depthTest=true;material.depthWrite=false;material.depthFunc=THREE.LessDepth;material.polygonOffset=false;
  material.onBeforeCompile=(shader,renderer)=>{
    source.onBeforeCompile(shader,renderer);
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\nattribute vec2 verge;varying vec2 vVerge;${fringe?'\nattribute float vergeGrass;varying float vVergeGrass;':''}`).replace('#include <begin_vertex>',`#include <begin_vertex>\nvVerge=verge;${fringe?'\nvVergeGrass=vergeGrass;':''}`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec2 vVerge;${fringe?'\nvarying float vVergeGrass;':''}`)
      .replace('#include <alphatest_fragment>',fringe?`
        vec2 vergeWorld=vMapUv*2.0;
        float grassPatch=surfaceNoise(vergeWorld*3.7+23.0);
        float grassTips=surfaceNoise(vergeWorld*38.0+7.0);
        float grassReach=.035+grassPatch*.05+grassTips*.025;
        float grassAA=max(.0015,fwidth(vVerge.x)*.6);
        // Continuous turf reaches across the kerb edge, ending in small,
        // irregular tips. It remains visible when blade instances are culled.
        float grassInner=smoothstep(-grassReach-grassAA,-grassReach+grassAA,vVerge.x);
        float grassOuter=1.0-smoothstep(.035,.16,vVerge.x);
        diffuseColor.a*=clamp(vVergeGrass,0.0,1.0)*grassInner*grassOuter;
        if(diffuseColor.a<.001)discard;
        #include <alphatest_fragment>
      `:surface==='gravel'?`
        vec2 vergeWorld=vMapUv*${GRAVEL_TEXTURE_METRES.toFixed(4)};
        float gravelReach=.12+surfaceNoise(vergeWorld*3.0)*.2;
        float gravelFade=1.0-smoothstep(0.0,gravelReach,vVerge.x);
        // Packed height follows the very same stone footprints as the colour
        // and normals, so the spill consists of grains rather than a flat band.
        float gravelHeight=surfaceSample(normalMap,vNormalMapUv).a;
        float gravelStone=smoothstep(.1,.2,gravelHeight);
        float gravelPatch=.35+.65*smoothstep(.27,.68,surfaceNoise(vergeWorld*17.0+13.0));
        float gravelPixel=max(length(dFdx(vergeWorld)),length(dFdy(vergeWorld)));
        float gravelDetail=1.0-smoothstep(.003,.02,gravelPixel);
        float gravelScatter=mix(.12,gravelStone*gravelPatch,gravelDetail)*gravelFade*gravelFade;
        float gravelBed=1.0-smoothstep(-.025,.006,vVerge.x);
        diffuseColor.a*=max(gravelBed,gravelScatter);
        if(diffuseColor.a<.001)discard;
        #include <alphatest_fragment>
      `:asphalt?`
        vec2 vergeWorld=vMapUv*${ASPHALT_TEXTURE_METRES.toFixed(4)};
        float vergeFine=1.0-smoothstep(.015,.075,fwidth(vVerge.x));
        float vergeReach=.012+surfaceNoise(vergeWorld*9.0)*.025+(surfaceNoise(vergeWorld*43.0)-.5)*.022*vergeFine;
        float vergeAA=max(.002,fwidth(vVerge.x));
        diffuseColor.a*=clamp(vVerge.y*${surface==='runoff'?'-1.0':'1.0'},0.0,1.0)*(1.0-smoothstep(vergeReach-vergeAA,vergeReach+vergeAA,vVerge.x));
        if(diffuseColor.a<.001)discard;
        #include <alphatest_fragment>
      `:`
        vec2 vergeWorld=vMapUv*2.0;
        float vergePatch=surfaceNoise(vergeWorld*2.3+17.0);
        float vergeWidth=.14+surfaceNoise(vergeWorld*.8)*.27;
        float vergeDry=(1.0-smoothstep(.01,vergeWidth,vVerge.x))*(.3+.7*vergePatch);
        // Local straw and exposed soil, fading into the existing lawn.
        diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.25,1.04,.64)+vec3(.014,.009,.003),vergeDry*.7);
        float vergeSoil=(1.0-smoothstep(.015,.055+vergePatch*.075,vVerge.x))*smoothstep(.3,.72,surfaceNoise(vergeWorld*21.0));
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.09,.067,.036),vergeSoil*.48);
        diffuseColor.a*=1.0-smoothstep(vergeWidth*.55,vergeWidth,vVerge.x);
        if(diffuseColor.a<.001)discard;
        #include <alphatest_fragment>
      `);
  };
  material.customProgramCacheKey=()=>`${source.customProgramCacheKey()}-roadside-v3-${surface}`;return material;
}

export const GRAVEL_TEXTURE_METRES=.6;
/** Scatter overlapping crushed stones into a fine sand bed, rather than
 * tessellating flat cells. The same millimetre heightfield drives the normals. */
export function gravelMaterial(){
  const size=1024,metres=GRAVEL_TEXTURE_METRES,heights=new Float32Array(size*size),grain=new Float32Array(size*size),colors=new Uint8Array(size*size*4),normals=new Uint8Array(size*size*4),roughness=new Uint8Array(size*size*4);
  let seed=6217;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const wrap=(v:number)=>(v%size+size)%size;
  for(let pixel=0;pixel<heights.length;pixel++){
    const noise=random(),shade=.9+noise*.16,index=pixel*4;grain[pixel]=noise;heights[pixel]=.0002+noise*.00045;
    colors[index]=Math.round(190*shade);colors[index+1]=Math.round(174*shade);colors[index+2]=Math.round(146*shade);colors[index+3]=255;
    roughness[index]=roughness[index+1]=roughness[index+2]=250;roughness[index+3]=255;
  }
  const scatter=(count:number,minRadius:number,maxRadius:number)=>{
    for(let stone=0;stone<count;stone++){
      const cx=random()*size,cy=random()*size,radius=minRadius+(maxRadius-minRadius)*random()**2,rx=radius/metres*size,ry=rx*(.48+random()*.5),angle=random()*Math.PI*2,c=Math.cos(angle),s=Math.sin(angle),reach=Math.ceil(rx+1);
      const height=radius*(.45+random()*.4),tone=.78+random()*.4,warm=random(),tiltX=(random()-.5)*.5,tiltY=(random()-.5)*.5,r=.9+random()*.08;
      const stoneColor=[(182+warm*25)*tone,(174+warm*8)*tone,(161-warm*22)*tone];
      for(let y=Math.floor(cy)-reach;y<=Math.ceil(cy)+reach;y++)for(let x=Math.floor(cx)-reach;x<=Math.ceil(cx)+reach;x++){
        const dx=x-cx,dy=y-cy,u=(dx*c+dy*s)/rx,v=(-dx*s+dy*c)/ry;
        // Unequal angular faces, random sizes and overlapping footprints leave
        // fine sand in the gaps instead of a continuous network of grout.
        const d=Math.max(Math.hypot(u,v)*.88,Math.abs(u)*.9+Math.abs(v)*.32,Math.abs(v)*.92+Math.abs(u)*.24);
        if(d>=1)continue;
        const pixel=wrap(y)*size+wrap(x),bevel=Math.min(1,(1-d)*5),h=.00035+height*bevel*Math.max(.15,.8+tiltX*u+tiltY*v-d*.28)+grain[pixel]*.00016;
        if(h<=heights[pixel])continue;heights[pixel]=h;
        const index=pixel*4,shade=(.89+bevel*.11)*(.96+grain[pixel]*.08);
        colors[index]=Math.min(255,Math.round(stoneColor[0]*shade));colors[index+1]=Math.min(255,Math.round(stoneColor[1]*shade));colors[index+2]=Math.min(255,Math.round(stoneColor[2]*shade));
        roughness[index]=roughness[index+1]=roughness[index+2]=Math.round(r*255);
      }
    }
  };
  scatter(18000,.0005,.0015);scatter(10000,.0012,.0035);scatter(1400,.0025,.009);
  const at=(x:number,y:number)=>heights[wrap(y)*size+wrap(x)],slope=1/(2*metres/size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const dx=(at(x+1,y)-at(x-1,y))*slope,dy=(at(x,y+1)-at(x,y-1))*slope,length=Math.hypot(dx,dy,1),i=(y*size+x)*4;
    normals[i]=Math.round((.5-dx/length*.5)*255);normals[i+1]=Math.round((.5-dy/length*.5)*255);normals[i+2]=Math.round((.5+.5/length)*255);normals[i+3]=Math.round(Math.min(1,at(x,y)/.006)*255);
  }
  const texture=(data:Uint8Array,name:string,color=false)=>{
    const map=new THREE.DataTexture(data,size,size);map.name=`gravel-${name}`;map.colorSpace=color?THREE.SRGBColorSpace:THREE.NoColorSpace;map.wrapS=map.wrapT=THREE.RepeatWrapping;map.generateMipmaps=true;map.minFilter=THREE.LinearMipmapLinearFilter;map.magFilter=THREE.LinearFilter;map.needsUpdate=true;map.userData.sharedCC0=true;return map;
  };
  const material=stochasticSurface(new THREE.MeshStandardMaterial({map:texture(colors,'color',true),normalMap:texture(normals,'normal'),roughnessMap:texture(roughness,'roughness'),normalScale:new THREE.Vector2(1.2,1.2),roughness:.97,envMapIntensity:.25}),metres,.12,{roughnessCenter:.96,sourceRoughness:.96,roughnessContrast:.6,roughnessMin:.9,roughnessMax:1,specular:.5});
  material.name='crushed-gravel-and-sand';return material;
}

/** Dry road paint follows the asphalt grain instead of reading as a white decal. */
export function roadPaintMaterial(normalMap:THREE.Texture){
  const material=new THREE.MeshStandardMaterial({color:0xbab9ad,normalMap,normalScale:new THREE.Vector2(.18,.18),roughness:.97,metalness:0,envMapIntensity:.18});
  material.name='worn-grey-white-road-paint';
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vPaintPosition;').replace('#include <begin_vertex>','#include <begin_vertex>\nvPaintPosition=position.xz;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec2 vPaintPosition;\n${stochasticGLSL}`)
      .replace('#include <map_fragment>',`#include <map_fragment>
        float paintDirt=surfaceNoise(vPaintPosition*.7+19.0);
        float paintDetail=1.0-smoothstep(.08,.35,max(fwidth(vPaintPosition.x),fwidth(vPaintPosition.y)));
        float paintWear=smoothstep(.64,.85,surfaceNoise(vPaintPosition*14.0))*paintDetail;
        diffuseColor.rgb*=.84+.16*paintDirt;
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.065,.071,.07),paintWear*.32);
      `)
      .replace('#include <lights_physical_fragment>','#include <lights_physical_fragment>\nmaterial.specularColor*=.35;material.specularF90*=.4;');
  };
  material.customProgramCacheKey=()=>'worn-road-paint-v1';return material;
}

/** Clamp the sampled roughness too: roughness=1 still multiplies the source map. */
export function matteFoliage(material:THREE.MeshStandardMaterial,volume=false,leafNormals=false){
  material.transparent=false;material.alphaTest=.5;material.alphaHash=false;material.alphaToCoverage=true;material.depthTest=true;material.depthWrite=true;material.side=THREE.DoubleSide;material.shadowSide=THREE.DoubleSide;
  material.metalness=0;material.roughness=1;material.envMapIntensity=.42;material.normalScale.set(.18,.18);material.color.multiply(new THREE.Color(0xe0e9d5));
  const canopyDefines=`${volume?'#define CANOPY_VOLUME\n':''}${leafNormals?'#define LEAF_SURFACE_NORMAL\n':''}`;
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>',`#include <common>\n${canopyDefines}
        #ifdef CANOPY_VOLUME
        attribute float canopyOcclusion;varying float vCanopyOcclusion;
        #endif
        #ifdef LEAF_SURFACE_NORMAL
        attribute vec3 leafSurfaceNormal;varying vec3 vLeafSurfaceNormal;
        #endif
      `)
      .replace('#include <defaultnormal_vertex>',`#include <defaultnormal_vertex>
        #ifdef LEAF_SURFACE_NORMAL
        vec3 leafNormal=leafSurfaceNormal;
        #ifdef USE_INSTANCING
        // Match Three.js inverse-scale normal transform for stretched trees.
        mat3 leafInstance=mat3(instanceMatrix);
        leafNormal/=vec3(dot(leafInstance[0],leafInstance[0]),dot(leafInstance[1],leafInstance[1]),dot(leafInstance[2],leafInstance[2]));
        leafNormal=leafInstance*leafNormal;
        #endif
        vLeafSurfaceNormal=normalize(normalMatrix*leafNormal);
        #endif
      `)
      .replace('#include <begin_vertex>','#include <begin_vertex>\n#ifdef CANOPY_VOLUME\nvCanopyOcclusion=canopyOcclusion;\n#endif');
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>',`#include <common>\n${vegetationPaletteGLSL}\n${canopyDefines}
        #ifdef CANOPY_VOLUME
        varying float vCanopyOcclusion;
        #endif
        #ifdef LEAF_SURFACE_NORMAL
        varying vec3 vLeafSurfaceNormal;
        #endif
      `)
      .replace('#include <lights_physical_pars_fragment>',`#include <lights_physical_pars_fragment>
        #ifdef CANOPY_VOLUME
        void RE_Direct_Canopy(const in IncidentLight leafLight,const in vec3 leafPosition,const in vec3 canopyNormal,const in vec3 leafView,const in vec3 clearcoatNormal,const in PhysicalMaterial leafMaterial,inout ReflectedLight leafReflected){
          RE_Direct_Physical(leafLight,leafPosition,canopyNormal,leafView,clearcoatNormal,leafMaterial,leafReflected);
          vec3 surfaceNormal=canopyNormal;
          #ifdef LEAF_SURFACE_NORMAL
          surfaceNormal=normalize(vLeafSurfaceNormal);
          #endif
          // Only the physical leaf normal follows the visible side. The
          // envelope normal stays outward to shade the crown as one volume.
          surfaceNormal*=dot(surfaceNormal,leafView)<0.0?-1.0:1.0;
          float access=clamp(vCanopyOcclusion,.18,1.0);
          float noL=dot(canopyNormal,leafLight.direction);
          float wrap=max(0.0,clamp((noL+.3)/1.3,0.0,1.0)-max(noL,0.0));
          vec3 scatterDirection=normalize(leafLight.direction+surfaceNormal*.2);
          float forwardScatter=pow(max(dot(leafView,-scatterDirection),0.0),4.0);
          float transmission=max(-dot(surfaceNormal,leafLight.direction),0.0)*(.22+.48*forwardScatter)*access*access;
          // The renderer calls RE_Direct after applying each light's shadow.
          // This also keeps transmission dark behind trunks and buildings.
          leafReflected.directDiffuse+=leafLight.color*BRDF_Lambert(leafMaterial.diffuseColor)*(vec3(wrap*.3)+vec3(.95,1.0,.74)*transmission);
        }
        #undef RE_Direct
        #define RE_Direct RE_Direct_Canopy
        #endif
      `)
      .replace('#include <map_fragment>',`#include <map_fragment>
        diffuseColor.rgb=vegetationAlbedo(diffuseColor.rgb,.82);
        #ifdef CANOPY_VOLUME
        float canopyAccess=clamp(vCanopyOcclusion,.18,1.0);
        diffuseColor.rgb*=mix(vec3(.84,.94,.9),vec3(1.0,.99,.91),smoothstep(.22,.95,canopyAccess));
        #endif
      `)
      .replace('#include <alphatest_fragment>',foliageAlphaTestGLSL)
      // Volume normals point out of the canopy, independent of which side of
      // the carrier card the camera sees. Keep normal-map handedness intact.
      .replace('#include <normal_fragment_begin>',THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;','#ifndef CANOPY_VOLUME\nnormal *= faceDirection;\n#endif'))
      .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=clamp(.9+roughnessFactor*.1,.9,1.0);')
      .replace('#include <lights_physical_fragment>','#include <lights_physical_fragment>\nmaterial.specularColor*=.22;material.specularF90*=.28;')
      .replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
        #ifdef CANOPY_VOLUME
        // Bound ambient occlusion so shaded leaf colour survives. Sunlight
        // already has shadow-map occlusion and must not be darkened twice.
        float canopySkyAccess=.68+.32*canopyAccess;
        // Mix irradiance from both sides instead of imposing an upward-sky
        // brightness floor, which flattened the crown's directional shading.
        vec3 canopyBackIrradiance=getAmbientLightIrradiance(ambientLightColor);
        #if defined(USE_LIGHT_PROBES)
        canopyBackIrradiance+=getLightProbeIrradiance(lightProbe,-geometryNormal);
        #endif
        #if NUM_HEMI_LIGHTS > 0
        #pragma unroll_loop_start
        for(int i=0;i<NUM_HEMI_LIGHTS;i++){
          canopyBackIrradiance+=getHemisphereLightIrradiance(hemisphereLights[i],-geometryNormal);
        }
        #pragma unroll_loop_end
        #endif
        #if defined(USE_ENVMAP) && defined(STANDARD) && defined(ENVMAP_TYPE_CUBE_UV)
        canopyBackIrradiance+=getIBLIrradiance(-geometryNormal);
        #endif
        reflectedLight.indirectDiffuse=(reflectedLight.indirectDiffuse*.76+canopyBackIrradiance*BRDF_Lambert(material.diffuseColor)*vec3(.95,1.0,.94)*.24)*canopySkyAccess;
        reflectedLight.indirectSpecular*=canopySkyAccess;
        #endif
      `);
  };
  material.customProgramCacheKey=()=>`two-sided-volume-canopy-v7-${volume}-${leafNormals}`;return material;
}

/** Matte painted concrete with inner-edge grime and racing-line tyre deposits. */
export function paintedSurface(material:THREE.MeshStandardMaterial){
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute vec2 kerbUv;attribute float kerbTraffic;varying vec2 vKerbUv;varying float vKerbTraffic;').replace('#include <uv_vertex>','#include <uv_vertex>\nvKerbUv=kerbUv;vKerbTraffic=kerbTraffic;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec2 vKerbUv;varying float vKerbTraffic;\n${stochasticGLSL}
      float kerbJoint(vec2 uv){float local=mod(uv.x,.54);float width=max(.006,fwidth(uv.x)*.65);return 1.0-smoothstep(width,width+.009,min(local,.54-local));}
      float kerbVisualHeight(vec2 uv){
        float nearFade=1.0-smoothstep(.018,.09,fwidth(uv.x));
        return uv.y*.055-kerbJoint(uv)*.0045*nearFade;
      }
      float kerbRubberMask(vec2 uv,float traffic){
        // kerbUv.y is zero at the asphalt, on either side of the track.
        float buildup=surfaceNoise(vec2(uv.x*.19,37.0));
        float reach=.27+.14*buildup+traffic*.25;
        float innerEdge=1.0-smoothstep(reach*.18,reach,uv.y);
        float patches=surfaceNoise(vec2(uv.x*.72,uv.y*8.0+13.0));
        float coverage=smoothstep(.23,.73,buildup)*(.24+.76*smoothstep(.2,.8,patches));
        // Long, broken streaks soften away before their fine detail can shimmer.
        float nearFade=(1.0-smoothstep(.018,.09,fwidth(uv.x)))*(1.0-smoothstep(.006,.025,fwidth(uv.y)));
        float streaks=mix(.84,.68+.32*surfaceNoise(vec2(uv.x*1.3,uv.y*64.0+buildup*3.0)),nearFade);
        return innerEdge*(.46+.54*coverage)*(.35+.65*traffic)*streaks;
      }
      vec3 kerbReliefNormal(vec3 n,float height){
        vec3 sx=dFdx(-vViewPosition),sy=dFdy(-vViewPosition),rx=cross(sy,n),ry=cross(n,sx);float det=dot(sx,rx);
        vec3 gradient=sign(det)*(dFdx(height)*rx+dFdy(height)*ry);return normalize(abs(det)*n-gradient);
      }
    `)
      .replace('#include <map_fragment>',THREE.ShaderChunk.map_fragment+`
        float kerbNear=1.0-smoothstep(.018,.09,fwidth(vKerbUv.x));
        float kerbGroove=kerbJoint(vKerbUv)*kerbNear;
        float kerbDirt=surfaceNoise(vec2(vKerbUv.x*.7,vKerbUv.y*3.0));
        float kerbWear=smoothstep(.83,1.0,vKerbUv.y)*surfaceNoise(vKerbUv*vec2(11.0,27.0));
        diffuseColor.rgb*=1.0-kerbGroove*.27-kerbDirt*.065;
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.22,.20,.16),kerbWear*.17);
        float kerbUse=clamp(vKerbTraffic,0.0,1.0);
        float kerbGrime=(1.0-smoothstep(.015,.38+kerbUse*.08,vKerbUv.y+(kerbDirt-.5)*.035))*(.8+.2*kerbDirt);
        diffuseColor.rgb*=1.0-kerbGrime*(.38+.12*kerbUse);
        float kerbRubber=kerbRubberMask(vKerbUv,kerbUse);
        diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*.08+vec3(.008,.009,.008),kerbRubber*.93);
      `)
      .replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\nnormal=kerbReliefNormal(normal,kerbVisualHeight(vKerbUv));')
      .replace('#include <roughnessmap_fragment>',THREE.ShaderChunk.roughnessmap_fragment+`
      #ifdef USE_ROUGHNESSMAP
      roughnessFactor=clamp(.93+(texelRoughness.g-.82)*2.0,.82,1.0);
      #endif
      roughnessFactor=clamp(roughnessFactor-kerbRubber*.11,.76,1.0);`);
  };
  material.customProgramCacheKey=()=>'painted-concrete-racing-wear-v4';return material;
}

/** Smooth tyre shoulders and moulding rings, with the axle on local X. */
export function tyreGeometry(radius:number,width:number){
  const profile=[[.62,-.5],[.77,-.5],[.78,-.505],[.79,-.5],[.87,-.49],[.94,-.45],[.985,-.34],[1,-.18],[1,.18],[.985,.34],[.94,.45],[.87,.49],[.79,.5],[.78,.505],[.77,.5],[.62,.5]];
  const geometry=new THREE.LatheGeometry(profile.map(([r,y])=>new THREE.Vector2(r*radius,y*width)),80);
  geometry.rotateZ(Math.PI/2);return geometry;
}
export function tyreMaterial(){
  const size=256,height=new Float32Array(size*size),normalData=new Uint8Array(size*size*4),roughnessData=new Uint8Array(size*size*4);let seed=7123;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const grain=(seed>>>24)/255,wear=.5+.2*Math.sin(x*.9+y*.025)+.08*Math.sin(x*2.3);height[y*size+x]=grain*.5+wear*.5;
  }
  const at=(x:number,y:number)=>height[((y+size)%size)*size+(x+size)%size];
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const dx=(at(x+1,y)-at(x-1,y))*.65,dy=(at(x,y+1)-at(x,y-1))*.65,length=Math.hypot(dx,dy,1),i=(y*size+x)*4;
    normalData[i]=Math.round((.5-dx/length*.5)*255);normalData[i+1]=Math.round((.5-dy/length*.5)*255);normalData[i+2]=Math.round((.5+.5/length)*255);normalData[i+3]=255;
    const rough=Math.round((.84+at(x,y)*.15)*255);roughnessData[i]=roughnessData[i+1]=roughnessData[i+2]=rough;roughnessData[i+3]=255;
  }
  const texture=(data:Uint8Array)=>{const map=new THREE.DataTexture(data,size,size);map.wrapS=map.wrapT=THREE.RepeatWrapping;map.repeat.set(5,2);map.generateMipmaps=true;map.minFilter=THREE.LinearMipmapLinearFilter;map.magFilter=THREE.LinearFilter;map.needsUpdate=true;map.userData.sharedCC0=true;return map;};
  const material=new THREE.MeshStandardMaterial({color:0x17191c,metalness:0,roughness:.94,normalMap:texture(normalData),normalScale:new THREE.Vector2(.22,.22),roughnessMap:texture(roughnessData),envMapIntensity:.32});
  material.name='tyre-rubber';material.userData.sharedCC0=true;return material;
}
