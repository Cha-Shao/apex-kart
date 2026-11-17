import * as THREE from 'three';

// Shared by CPU batch visibility, colour cutouts and the shadow depth pass.
const NEAR_BAND=[42,72] as const,FAR_BAND=[145,210] as const;

/** Cull whole instance batches; the shader blends individual trees within them. */
export class TreeLOD extends THREE.Group {
  readonly levels=[new THREE.Group(),new THREE.Group(),new THREE.Group()];
  transitioning=false;
  constructor(readonly radius:number){super();this.name='woodland-distance-levels';this.add(...this.levels);}
  update(view:THREE.Vector3){
    const distance=this.position.distanceTo(view),near=Math.max(0,distance-this.radius),far=distance+this.radius;
    const visible=[near<NEAR_BAND[1],far>NEAR_BAND[0]&&near<FAR_BAND[1],far>FAR_BAND[0]];
    let changed=false,active=0;
    this.levels.forEach((level,i)=>{if(level.visible!==visible[i])changed=true;level.visible=visible[i];if(visible[i])active++;});
    this.transitioning=active>1;return changed;
  }
}

/** Complementary opaque cutouts avoid blend sorting, including in shadows. */
export function treeLodFade(material:THREE.Material,level:number,viewPosition:THREE.Vector3){
  const compile=material.onBeforeCompile,cacheKey=material.customProgramCacheKey();
  material.onBeforeCompile=(shader,renderer)=>{
    compile.call(material,shader,renderer);shader.uniforms.treeLodViewPosition={value:viewPosition};
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nuniform vec3 treeLodViewPosition;varying float vTreeLodDistance;')
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        vec4 treeLodAnchor=vec4(0.0,0.0,0.0,1.0);
        #ifdef USE_INSTANCING
        treeLodAnchor=instanceMatrix*treeLodAnchor;
        #endif
        vTreeLodDistance=distance((modelMatrix*treeLodAnchor).xyz,treeLodViewPosition);
      `);
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>','#include <common>\nvarying float vTreeLodDistance;')
      // Both colour and depth shaders retain this hook after alpha testing,
      // including foliage materials that provide their own MSAA edge filter.
      .replace('#include <alphahash_fragment>',`#include <alphahash_fragment>
        float treeNearOut=1.0-smoothstep(${NEAR_BAND[0].toFixed(1)},${NEAR_BAND[1].toFixed(1)},vTreeLodDistance);
        float treeMidOut=1.0-smoothstep(${FAR_BAND[0].toFixed(1)},${FAR_BAND[1].toFixed(1)},vTreeLodDistance);
        float treeLodNoise=fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))));
        ${level===0?'if(treeLodNoise>=treeNearOut)discard;':level===1?'if(treeLodNoise<treeNearOut||treeLodNoise>=treeMidOut)discard;':'if(treeLodNoise<treeMidOut)discard;'}
      `);
  };
  material.customProgramCacheKey=()=>`${cacheKey}:tree-crossfade-v2-${level}`;return material;
}
