import * as THREE from 'three';

/** Prepare one anchor per connected leaf card, once per shared source mesh.
 * Baked canopy access is consistent across the three authored tree LODs. */
export function prepareTreeWind(geometry:THREE.BufferGeometry){
  if(geometry.getAttribute('treeLeafWind'))return;
  const position=geometry.getAttribute('position'),index=geometry.getIndex(),access=geometry.getAttribute('canopyOcclusion');
  const parent=Int32Array.from({length:position.count},(_,i)=>i);
  const root=(vertex:number):number=>{
    while(parent[vertex]!==vertex){parent[vertex]=parent[parent[vertex]];vertex=parent[vertex];}
    return vertex;
  };
  const count=index?.count??position.count;
  for(let i=0;i<count;i+=3){
    const a=root(index?index.getX(i):i);
    parent[root(index?index.getX(i+1):i+1)]=a;parent[root(index?index.getX(i+2):i+2)]=a;
  }
  const cards=new Map<number,{x:number;y:number;z:number;access:number;count:number}>();
  for(let i=0;i<position.count;i++){
    const key=root(i),card=cards.get(key)??{x:0,y:0,z:0,access:0,count:0};
    card.x+=position.getX(i);card.y+=position.getY(i);card.z+=position.getZ(i);card.access+=access?.getX(i)??0;card.count++;
    cards.set(key,card);
  }
  geometry.computeBoundingBox();
  const box=geometry.boundingBox!,center=box.getCenter(new THREE.Vector3()),extent=box.getSize(new THREE.Vector3()).multiplyScalar(.5).max(new THREE.Vector3(.1,.1,.1));
  for(const card of cards.values()){
    card.x/=card.count;card.y/=card.count;card.z/=card.count;
    const reach=Math.hypot((card.x-center.x)/extent.x,(card.y-center.y)/extent.y,(card.z-center.z)/extent.z);
    // Interior leaves stay still; the exposed tips carry the ripple.
    card.access=access?THREE.MathUtils.smoothstep(card.access/card.count,.76,.94):THREE.MathUtils.smoothstep(reach,.5,.95);
  }
  const wind=new Float32Array(position.count*4);
  for(let i=0;i<position.count;i++){
    const card=cards.get(root(i))!;wind.set([card.x,card.y,card.z,card.access],i*4);
  }
  geometry.setAttribute('treeLeafWind',new THREE.BufferAttribute(wind,4));
  // The world-space displacement remains under five centimetres. Reserve
  // bounds for the smallest tree instance as well as the unscaled source.
  box.expandByScalar(.08);geometry.computeBoundingSphere();geometry.boundingSphere!.radius+=.08;
}

/** Shared by the colour and shadow-depth passes; all trees sample one wind
 * field in world space, while each terminal leaf cluster has its own phase. */
export function treeWind(material:THREE.Material,time:{value:number}){
  if(material.userData.treeWind)return material;
  const compile=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.onBeforeCompile=(shader,renderer)=>{
    compile.call(material,shader,renderer);shader.uniforms.treeWindTime=time;
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>',`#include <common>
        uniform float treeWindTime;attribute vec4 treeLeafWind;
        vec3 terminalLeafWave(vec3 world,float time,float flexibility){
          float gust=sin(dot(world.xz,vec2(.17,.11))+time*.9);
          float ripple=sin(dot(world,vec3(1.31,.47,.83))-time*2.4);
          float flutter=sin(dot(world,vec3(3.7,1.1,-2.3))+time*4.1);
          float sway=gust*.024+ripple*.009+flutter*.004;
          return vec3(sway,flutter*.0025,sway*.38+ripple*.004)*flexibility;
        }
        vec3 treeWindLocal(vec3 offset,mat3 basis){
          return vec3(dot(offset,basis[0])/dot(basis[0],basis[0]),dot(offset,basis[1])/dot(basis[1],basis[1]),dot(offset,basis[2])/dot(basis[2],basis[2]));
        }
      `)
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        mat4 treeWindTransform=modelMatrix;
        #ifdef USE_INSTANCING
        treeWindTransform=treeWindTransform*instanceMatrix;
        #endif
        vec3 treeWindWorld=(treeWindTransform*vec4(treeLeafWind.xyz,1.0)).xyz;
        vec3 leafOffset=terminalLeafWave(treeWindWorld,treeWindTime,treeLeafWind.w);
        transformed+=treeWindLocal(leafOffset,mat3(treeWindTransform));
        #ifdef TEMPORAL_MOTION
        vec3 previousLeafOffset=terminalLeafWave(treeWindWorld,temporalPreviousTime,treeLeafWind.w);
        temporalPreviousOffset+=treeWindLocal(previousLeafOffset-leafOffset,mat3(treeWindTransform));
        #endif
      `);
  };
  material.userData.treeWind=true;material.customProgramCacheKey=()=>`${key}:terminal-leaf-wave-v1`;
  return material;
}
