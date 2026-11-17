import * as THREE from 'three';
import {foliageAlphaTestGLSL} from './foliage-cutout';

const coverageMaps=new WeakMap<THREE.DataTexture,THREE.DataTexture>();

const canopyAlphaTestGLSL=`
  #ifdef USE_ALPHATEST
  vec2 canopyUvDx=dFdx(vMapUv),canopyUvDy=dFdy(vMapUv);
  float canopyCardPixels=1.0/max(max(length(canopyUvDx),length(canopyUvDy)),.00001);
  float canopyMinified=1.0-smoothstep(4.0,12.0,canopyCardPixels);
  // These mips average the original binary leaf silhouette. Even the final
  // 1x1 mip retains fractional coverage instead of failing a 0.5 alpha test.
  float canopyMeanCoverage=texture2D(canopyCoverageMap,vMapUv).r;
  // Decorrelate overlapping cards. Identical fractional MSAA masks on every
  // layer would keep a dense distant crown just as transparent as one card.
  float canopyNoise=fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))+dot(vMapUv,vec2(.173,.319))+vViewPosition.z*.017));
  #ifdef ALPHA_TO_COVERAGE
  float canopyWidth=clamp(fwidth(diffuseColor.a),1.0/255.0,min(alphaTest,1.0-alphaTest));
  float canopyCutout=smoothstep(alphaTest-canopyWidth*.5,alphaTest+canopyWidth*.5,diffuseColor.a);
  float canopySample=canopyMeanCoverage>canopyNoise?1.0:0.0;
  diffuseColor.a=mix(canopyCutout,canopySample,canopyMinified);
  if(diffuseColor.a<=0.0)discard;
  #else
  float canopyCoverage=mix(step(alphaTest,diffuseColor.a),canopyMeanCoverage,canopyMinified);
  // Fully resolved leaves still use their normal hard cutout.
  if(canopyCoverage<=canopyNoise)discard;
  diffuseColor.a=1.0;
  #endif
  #endif
`;

/** Use filtered silhouette coverage when a whole leaf-cluster card is tiny.
 * Keep the padded colour atlas and its detailed cutout for resolved leaves. */
export function treeLeafCoverage(material:THREE.MeshStandardMaterial){
  const map=material.map;if(!(map instanceof THREE.DataTexture))return;
  const image=map.image as {data:Uint8Array;width:number;height:number};
  let coverage=coverageMaps.get(map);
  if(!coverage){
    const mask=new Uint8Array(image.width*image.height),threshold=Math.ceil(material.alphaTest*255);
    for(let i=0;i<mask.length;i++)mask[i]=image.data[i*4+3]>=threshold?255:0;
    coverage=new THREE.DataTexture(mask,image.width,image.height,THREE.RedFormat,THREE.UnsignedByteType);
    coverage.name=`${map.name}-silhouette-coverage`;
    coverage.wrapS=map.wrapS;coverage.wrapT=map.wrapT;coverage.flipY=map.flipY;coverage.anisotropy=map.anisotropy;
    coverage.generateMipmaps=true;coverage.minFilter=THREE.LinearMipmapLinearFilter;coverage.magFilter=THREE.LinearFilter;
    coverage.userData.sharedCC0=true;coverage.needsUpdate=true;coverageMaps.set(map,coverage);
  }
  const compile=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.onBeforeCompile=(shader,renderer)=>{
    compile.call(material,shader,renderer);shader.uniforms.canopyCoverageMap={value:coverage};
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>','#include <common>\nuniform sampler2D canopyCoverageMap;')
      .replace(foliageAlphaTestGLSL,canopyAlphaTestGLSL);
  };
  material.customProgramCacheKey=()=>`${key}:tree-subpixel-coverage-v1`;
  return coverage;
}
