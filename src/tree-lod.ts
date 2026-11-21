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
export function treeLodFade(material:THREE.Material,level:number,viewPosition:THREE.Vector3,debugColors?:{value:number}){
  const compile=material.onBeforeCompile,cacheKey=material.customProgramCacheKey();
  material.onBeforeCompile=(shader,renderer)=>{
    compile.call(material,shader,renderer);shader.uniforms.treeLodViewPosition={value:viewPosition};
    if(debugColors)shader.uniforms.treeLodDebugColors=debugColors;
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>',`#include <common>
        uniform vec3 treeLodViewPosition;varying float vTreeLodDistance;
        ${debugColors?'varying float vTreeDebugBrightness;':''}
      `)
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        vec4 treeLodAnchor=vec4(0.0,0.0,0.0,1.0);
        #ifdef USE_INSTANCING
        treeLodAnchor=instanceMatrix*treeLodAnchor;
        #endif
        vec3 treeLodWorld=(modelMatrix*treeLodAnchor).xyz;
        vTreeLodDistance=distance(treeLodWorld,treeLodViewPosition);
        ${debugColors?`
          // Same instance root in all 3 LODs, all branch/leaf materials.
          // Stable per-tree brightness, not a per-pixel flickering tint.
          vec2 treeId=floor(treeLodWorld.xz*32.0);
          float treeRandom=fract(sin(dot(treeId,vec2(127.1,311.7)))*43758.5453);
          vTreeDebugBrightness=mix(0.65,1.0,treeRandom);
        `:''}
      `);
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>',`#include <common>
        varying float vTreeLodDistance;
        ${debugColors?'uniform float treeLodDebugColors;varying float vTreeDebugBrightness;':''}
      `)
      .replace('#include <color_fragment>',debugColors?`#include <color_fragment>
        // Only diffuse RGB is overwritten: silhouette, depth, lighting and
        // the existing per-instance LOD dither remain fully intact.
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(${level===0?'0.045,0.92,0.14':level===1?'0.98,0.82,0.045':'0.98,0.055,0.065'})*vTreeDebugBrightness,treeLodDebugColors);
      `:'#include <color_fragment>')
      // Both colour and depth shaders retain this hook after alpha testing,
      // including foliage materials that provide their own MSAA edge filter.
      .replace('#include <alphahash_fragment>',`#include <alphahash_fragment>
        float treeNearOut=1.0-smoothstep(${NEAR_BAND[0].toFixed(1)},${NEAR_BAND[1].toFixed(1)},vTreeLodDistance);
        float treeMidOut=1.0-smoothstep(${FAR_BAND[0].toFixed(1)},${FAR_BAND[1].toFixed(1)},vTreeLodDistance);
        float treeLodNoise=fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))));
        ${level===0?'if(treeLodNoise>=treeNearOut)discard;':level===1?'if(treeLodNoise<treeNearOut||treeLodNoise>=treeMidOut)discard;':'if(treeLodNoise<treeMidOut)discard;'}
      `);
  };
  material.customProgramCacheKey=()=>`${cacheKey}:tree-crossfade-v3-${level}-${debugColors?'debug-tint':'depth'}`;return material;
}
