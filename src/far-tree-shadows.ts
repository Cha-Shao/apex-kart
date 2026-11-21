import * as THREE from 'three';
import type {TerrainField} from './terrain';
import type {VegetationPoint,DetailLayer} from './track-environment';
import {drapeTriangles} from './terrain-mesh';

/** Far tree canopy shadows, independent of the two vertical cross cards.
 * A real cross-card depth shadow makes an X on the floor; three-cascade
 * sunlight also ends at 420m, so far scenery needs cheap projected occlusion.
 * Every shadow shares an existing tree's position and fades in with FAR LOD.
 */
export function addFarTreeShadows(
  parent:THREE.Group,
  terrain:TerrainField,
  trees:readonly VegetationPoint[],
  sun:THREE.Vector3,
  cameraPosition:THREE.Vector3,
):DetailLayer[]{
  if(!trees.length)return [];
  const grouped=new Map<string,VegetationPoint[]>();
  for(const tree of trees){
    const key=Math.floor(tree.x/70)+','+Math.floor(tree.z/70);
    const group=grouped.get(key)??[];group.push(tree);grouped.set(key,group);
  }
  const vertical=Math.max(.35,sun.y);
  const dx=-sun.x/vertical,dz=-sun.z/vertical;
  const rotation=Math.atan2(dz,dx),cr=Math.cos(rotation),sr=Math.sin(rotation);
  const heights=[11,10.5,12.5],layers:DetailLayer[]=[];
  const material=new THREE.MeshBasicMaterial({
    name:'far-tree-draped-canopy-shadow',
    color:0x18251d,vertexColors:true,transparent:true,
    depthTest:true,depthWrite:false,toneMapped:false,
    polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1,
    side:THREE.DoubleSide,
  });
  // The material is shared by all cells in this scene, but owned by this
  // particular build. disposeSceneGroup will dispose it on track changes.
  // Fade on individual tree roots rather than on whole instance batches.
  // Near and mid continue to use their actual geometry shadow passes.
  material.onBeforeCompile=shader=>{
    shader.uniforms.treeShadowCamera={value:cameraPosition};
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nattribute vec3 treeShadowRoot;\nuniform vec3 treeShadowCamera;\nvarying float vTreeShadowDistance;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvTreeShadowDistance=distance(treeShadowRoot,treeShadowCamera);');
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>','#include <common>\nvarying float vTreeShadowDistance;')
      .replace('#include <color_fragment>','#include <color_fragment>\nif(vTreeShadowDistance<145.0)discard;\ndiffuseColor.a*=smoothstep(145.0,210.0,vTreeShadowDistance);');
  };
  material.customProgramCacheKey=()=>'far-tree-draped-shadow-v1';

  for(const [key,cell] of grouped){
    const coords:number[]=[],opacity:number[]=[],roots:number[]=[],indices:number[]=[];
    for(const tree of cell){
      const treeY=terrain.sample(tree.x,tree.z)-.04;
      const height=heights[tree.variant]*tree.scale*tree.stretch;
      const width=(tree.variant===2?2.65:3.15)*tree.scale;
      // Two soft overlapping canopy patches preserve the sun direction while
      // avoiding perfectly round dark disks. Trunk contact is drawn elsewhere.
      for(const [fraction,weight,radius] of [[.67,.38,1],[.43,.22,.77]]){
        const x=tree.x+dx*height*fraction,z=tree.z+dz*height*fraction;
        const ra=width*radius,rb=width*(tree.variant===2?.70:.81)*radius;
        if(x-ra<terrain.originX||x+ra>terrain.originX+terrain.size||
           z-ra<terrain.originZ||z+ra>terrain.originZ+terrain.size)continue;
        const step=2*Math.PI/12,triangles:{x:number;z:number}[][]=[];
        const center={x,z};
        const point=(r:number,angle:number)=>{
          const xx=Math.cos(angle)*r*ra,zz=Math.sin(angle)*r*rb;
          return {x:x+cr*xx-sr*zz,z:z+sr*xx+cr*zz};
        };
        for(let k=0;k<12;k++){
          const a=k*step,b=(k+1)*step;
          const ai=point(.52,a),bi=point(.52,b),ao=point(1,a),bo=point(1,b);
          triangles.push([center,ai,bi],[ai,ao,bi],[bi,ao,bo]);
        }
        const draped=drapeTriangles(triangles,(px,pz)=>terrain.sample(px,pz)-.010,terrain);
        const start=coords.length/3;
        for(let k=0;k<draped.vertices.length;k+=3){
          const px=draped.vertices[k],py=draped.vertices[k+1],pz=draped.vertices[k+2];
          const ox=px-x,oz=pz-z,lx=(cr*ox+sr*oz)/ra,lz=(-sr*ox+cr*oz)/rb;
          const radial=Math.hypot(lx,lz),falloff=1-THREE.MathUtils.smoothstep(radial,.31,1);
          coords.push(px,py,pz);
          opacity.push(1,1,1,weight*falloff);
          roots.push(tree.x,treeY,tree.z);
        }
        for(const index of draped.indices)indices.push(start+index);
      }
    }
    if(!coords.length)continue;
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(coords,3));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(opacity,4));
    geometry.setAttribute('treeShadowRoot',new THREE.Float32BufferAttribute(roots,3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,material);
    mesh.name='far-tree-canopy-shadows-'+key;mesh.renderOrder=2;
    parent.add(mesh);
    layers.push({object:mesh,center:geometry.boundingSphere!.center.clone(),distance:Math.max(1400,terrain.size*2)});
  }
  return layers;
}
