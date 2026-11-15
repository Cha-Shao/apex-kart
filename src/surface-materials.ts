import * as THREE from 'three';

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
  roadWear?:boolean;
  albedoGain?:number;
}
export function stochasticSurface(material:THREE.MeshStandardMaterial,metres:number,variation:number,settings:ReliefSettings={}){
  const {roughnessCenter=.9,roughnessContrast=1,roughnessMin=.78,roughnessMax=1,sourceRoughness=.65,specular=1,aggregate,aggregateStrength=.8,ground,roadWear=false,albedoGain=1}=settings;
  material.onBeforeCompile=shader=>{
    if(aggregate)shader.uniforms.surfaceAggregateMap={value:aggregate};
    const mapChunk=THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )','surfaceColor( map, vMapUv )');
    const aggregateMap=aggregate?`
      #ifdef USE_MAP
      vec4 surfaceAggregate=surfaceAggregateSample(surfaceAggregateMap,vMapUv);
      #endif\n`:'';
    const aggregateAlbedo=aggregate?`diffuseColor.rgb*=mix(${ground==='grass'?'.91,1.04':'.80,1.10'},smoothstep(.18,.82,surfaceAggregate.a));`:'';
    const aggregateRoughness=aggregate?(ground==='grass'?'+(surfaceAggregate.b-.94)*.45':'+(surfaceAggregate.b-.65)*.18'):'';
    const groundAlbedo=ground==='grass'?`
      vec2 lawnWorld=vMapUv*${metres.toFixed(4)};
      float lawnPatch=surfaceNoise(lawnWorld/22.0)*.6+surfaceNoise(lawnWorld/73.0+19.0)*.4;
      diffuseColor.rgb*=mix(vec3(.84,.94,.74),vec3(1.06,1.04,.94),smoothstep(.15,.85,lawnPatch));
      float lawnClumps=surfaceNoise(lawnWorld/3.6);
      float mowing=sin(dot(lawnWorld,vec2(.83,.56))*.8976+surfaceNoise(lawnWorld/120.0)*1.5);
      diffuseColor.rgb*=.97+lawnClumps*.06+mowing*.025;
    `:ground==='asphalt'?`
      vec2 asphaltWorld=vMapUv*${metres.toFixed(4)};
      float repairMask=smoothstep(.63,.82,surfaceNoise(asphaltWorld/14.0+71.0))*smoothstep(.35,.7,surfaceNoise(asphaltWorld/4.8));
      diffuseColor.rgb*=1.0-repairMask*.14;
    `:'';
    const roadAlbedo=roadWear?`
      // Lateral position and the shared racing line are both in metres.
      float rubberCenter=vRoadUv.z;
      vec2 rubberDistance=(vec2(vRoadUv.y-rubberCenter)+vec2(-.64,.64))*2.8;
      vec2 rubberBands=exp(-rubberDistance*rubberDistance);
      float rubberTrack=rubberBands.x+rubberBands.y;
      float rubberCoverage=.3+.7*surfaceNoise(vec2(vRoadUv.x/28.0,29.0));
      diffuseColor.rgb*=1.0-min(1.0,rubberTrack)*rubberCoverage*.095;
    `:'';
    const roughnessChunk=`
      float roughnessFactor=roughness;
      #ifdef USE_ROUGHNESSMAP
      float surfaceRoughness=surfaceSample(roughnessMap,vRoughnessMapUv).g;
      roughnessFactor=clamp(${roughnessCenter.toFixed(4)}+(surfaceRoughness-${sourceRoughness.toFixed(4)})*${roughnessContrast.toFixed(4)}${aggregateRoughness},${roughnessMin.toFixed(4)},${roughnessMax.toFixed(4)});
      #endif`;
    let normalChunk=THREE.ShaderChunk.normal_fragment_maps.replaceAll('texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0','surfaceNormal( normalMap, vNormalMapUv )');
    if(aggregate)normalChunk=normalChunk.replace('mapN.xy *= normalScale;',`mapN.xy *= normalScale;\nmapN=normalize(vec3(mapN.xy/max(mapN.z,.1)+(surfaceAggregate.rg*2.0-1.0)*${aggregateStrength.toFixed(4)},1.0));`);
    if(roadWear)shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute vec3 roadUv;varying vec3 vRoadUv;').replace('#include <uv_vertex>','#include <uv_vertex>\nvRoadUv=roadUv;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\n${aggregate?'uniform sampler2D surfaceAggregateMap;':''}\n${roadWear?'varying vec3 vRoadUv;':''}\n${ground==='asphalt'?'#define SURFACE_ASPHALT_DETAIL\n':''}${stochasticGLSL}`)
      .replace('#include <map_fragment>',aggregateMap+mapChunk+`
        #ifdef USE_MAP
        float surfaceMacro=surfaceNoise(vMapUv*${(metres/37).toFixed(8)})*.7+surfaceNoise(vMapUv*${(metres/103).toFixed(8)}+31.0)*.3;
        diffuseColor.rgb*=1.0+(surfaceMacro-.5)*${variation.toFixed(4)};
        ${aggregateAlbedo}
        ${groundAlbedo}
        ${roadAlbedo}
        diffuseColor.rgb*=${albedoGain.toFixed(4)};
        #endif`)
      .replace('#include <roughnessmap_fragment>',roughnessChunk)
      .replace('#include <normal_fragment_maps>',normalChunk)
      .replace('#include <lights_physical_fragment>',`#include <lights_physical_fragment>\nmaterial.specularColor*=${specular.toFixed(4)};material.specularF90*=${specular.toFixed(4)};`);
  };
  material.customProgramCacheKey=()=>`stochastic-relief-v6-${metres}-${variation}-${roughnessCenter}-${roughnessContrast}-${roughnessMin}-${roughnessMax}-${sourceRoughness}-${specular}-${!!aggregate}-${aggregateStrength}-${ground}-${roadWear}-${albedoGain}`;
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
 * Adds centimetre-scale relief to the CC0 millimetre grain. It is mipmapped,
 * rotates with the source PBR channels and contains no recognisable cracks. */
export function asphaltAggregateTexture(){
  const size=512,cells=64,heights=new Float32Array(size*size),data=new Uint8Array(size*size*4),centers=new Float32Array(cells*cells*4);
  let seed=9173;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<cells*cells;i++){centers[i*4]=.16+random()*.68;centers[i*4+1]=.16+random()*.68;centers[i*4+2]=.36+random()*.32;centers[i*4+3]=.65+random()*.35;}
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
  // 2.5 mm stone relief across a 2.1 m source tile, with gradual bevels.
  const slope=.0025/(2.1/size*2);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const dx=(at(x+1,y)-at(x-1,y))*slope,dy=(at(x,y+1)-at(x,y-1))*slope,length=Math.hypot(dx,dy,1),i=(y*size+x)*4,h=at(x,y);
    data[i]=Math.round((.5-dx/length*.5)*255);data[i+1]=Math.round((.5-dy/length*.5)*255);data[i+2]=Math.round((.90-h*.42)*255);data[i+3]=Math.round(h*255);
  }
  const texture=new THREE.DataTexture(data,size,size);texture.name='asphalt-aggregate-normal-roughness';texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.generateMipmaps=true;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.needsUpdate=true;texture.userData.sharedCC0=true;return texture;
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
