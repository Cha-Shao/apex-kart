import * as THREE from 'three';

/** Motion is written alongside HDR colour, with the very same alpha test,
 * LOD cutout and vertex deformation. No solid-card override depth pass. */
export class TemporalMaterials {
  readonly previousViewProjection={value:new THREE.Matrix4()};
  readonly previousTime={value:0};
  readonly texel={value:new THREE.Vector2(1,1)};
  private patched=new WeakSet<THREE.Material>();
  private moving=new WeakMap<THREE.Mesh,{previous:THREE.Matrix4}>();
  private frameMoving:{mesh:THREE.Mesh;previous:THREE.Matrix4}[]=[];

  prepare(scene:THREE.Scene,dynamicRoots:THREE.Object3D[],multisampled=true){
    const dynamic=new Set<THREE.Mesh>();
    dynamicRoots.forEach(root=>root.traverse(o=>{if(o instanceof THREE.Mesh)dynamic.add(o);}));
    this.frameMoving=[];
    scene.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return;
      let state=this.moving.get(object);
      if(dynamic.has(object)&&!state){
        state={previous:object.matrixWorld.clone()};this.moving.set(object,state);
        const clone=(source:THREE.Material)=>{
          const result=source.clone();result.onBeforeCompile=source.onBeforeCompile;result.customProgramCacheKey=source.customProgramCacheKey.bind(source);
          // Keep live paint/emissive controls bound to the same colour values
          // while giving each moving mesh its own previous transform uniform.
          for(const [name,value] of Object.entries(source))if(value instanceof THREE.Color)(result as unknown as Record<string,unknown>)[name]=value;
          result.userData.sharedCC0=false;return result;
        };
        object.material=Array.isArray(object.material)?object.material.map(clone):clone(object.material);
      }
      if(state)this.frameMoving.push({mesh:object,previous:state.previous});
      for(const material of Array.isArray(object.material)?object.material:[object.material]){
        if(!multisampled&&material.alphaToCoverage){material.alphaToCoverage=false;material.needsUpdate=true;}
        if(this.patched.has(material))continue;
        this.patched.add(material);
        const compile=material.onBeforeCompile,key=material.customProgramCacheKey(),previous=state?.previous;
        const reactive=material.transparent||(material as THREE.MeshPhysicalMaterial).transmission>0;
        material.onBeforeCompile=(shader:Parameters<THREE.Material['onBeforeCompile']>[0],renderer:THREE.WebGLRenderer)=>{
          compile.call(material,shader,renderer);
          // Custom particle shaders without project_vertex have no reliable
          // surface correspondence. Mark them reactive rather than ghosting.
          const projected=shader.vertexShader.includes('#include <project_vertex>');
          shader.fragmentShader=`layout(location=1) out highp vec4 temporalMotion;\n${shader.fragmentShader}`;
          if(projected&&!reactive){
            shader.uniforms.temporalPreviousVP=this.previousViewProjection;
            shader.uniforms.temporalTexel=this.texel;shader.uniforms.temporalPreviousTime=this.previousTime;
            if(previous)shader.uniforms.temporalPreviousModel={value:previous};
            shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
              #define TEMPORAL_MOTION
              uniform mat4 temporalPreviousVP;uniform float temporalPreviousTime;
              ${previous?'uniform mat4 temporalPreviousModel;':''}
              varying vec4 vTemporalClip;vec3 temporalPreviousOffset=vec3(0.0);
            `).replace('#include <project_vertex>',`#include <project_vertex>
              vec4 temporalLocal=vec4(transformed+temporalPreviousOffset,1.0);
              #ifdef USE_BATCHING
              temporalLocal=batchingMatrix*temporalLocal;
              #endif
              #ifdef USE_INSTANCING
              temporalLocal=instanceMatrix*temporalLocal;
              #endif
              vTemporalClip=temporalPreviousVP*${previous?'temporalPreviousModel':'modelMatrix'}*temporalLocal;
            `);
            shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
              uniform vec2 temporalTexel;varying vec4 vTemporalClip;
            `).replace(/}\s*$/,`
              vec2 previousUV=vTemporalClip.xy/max(vTemporalClip.w,.00001)*.5+.5;
              // W also records sample coverage on MSAA edges. Recover the
              // motion/depth after resolve instead of averaging with the sky.
              temporalMotion=vec4(gl_FragCoord.xy*temporalTexel-previousUV,log2(1.0+max(vTemporalClip.w,0.0)),vTemporalClip.w>0.0?1.0:4.0);
            }`);
          }else shader.fragmentShader=shader.fragmentShader.replace(/}\s*$/,'temporalMotion=vec4(0.0,0.0,0.0,4.0);\n}');
        };
        material.customProgramCacheKey=()=>`${key}:motion-mrt-v1-${!!previous}-${!!reactive}`;material.needsUpdate=true;
      }
    });
  }
  commit(viewProjection:THREE.Matrix4,time:number){
    this.previousViewProjection.value.copy(viewProjection);this.previousTime.value=time;
    this.frameMoving.forEach(({mesh,previous})=>previous.copy(mesh.matrixWorld));
  }
}
