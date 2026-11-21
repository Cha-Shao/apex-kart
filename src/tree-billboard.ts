import * as THREE from 'three';
import {foliageCutoutTexture} from './foliage-cutout';

/** Two fixed crossing cards baked from the highest-detail GLB.
 * Front (+Z) and side (+X) maintain the original root pivot. */
export interface TreeCrossBillboard {
  geometry:THREE.BufferGeometry;
  materials:[THREE.MeshBasicMaterial,THREE.MeshBasicMaterial];
}

export function makeTreeCrossBillboard(
  name:string,source:THREE.Object3D,onTextureLoaded:()=>void,
):TreeCrossBillboard{
  source.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(source);
  if(bounds.isEmpty())throw Error('Tree '+name+' has no source geometry');
  const center=bounds.getCenter(new THREE.Vector3());
  const size=bounds.getSize(new THREE.Vector3());
  const wFront=size.x*1.09,wSide=size.z*1.09,marginY=size.y*.045;
  const y0=bounds.min.y-marginY,y1=bounds.max.y+marginY;
  const frontLeft=center.x-wFront/2,frontRight=center.x+wFront/2;
  const sideLeft=center.z+wSide/2,sideRight=center.z-wSide/2;
  // Looking from +Z, screen right is +X. Looking from +X, screen right is -Z.
  const positions=new Float32Array([
    frontLeft,y0,center.z, frontRight,y0,center.z,
    frontLeft,y1,center.z, frontRight,y1,center.z,
    center.x,y0,sideLeft, center.x,y0,sideRight,
    center.x,y1,sideLeft, center.x,y1,sideRight,
  ]);
  const uv=new Float32Array([0,0,1,0,0,1,1,1,0,0,1,0,0,1,1,1]);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  geometry.setIndex([0,1,2,1,3,2,4,5,6,5,7,6]);
  geometry.addGroup(0,6,0);
  geometry.addGroup(6,6,1);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.sharedCC0=true;

  const loader=new THREE.TextureLoader();
  const makeMaterial=(view:'front'|'side')=>{
    let material:THREE.MeshBasicMaterial;
    const texture=loader.load(
      '/assets/vegetation/tree-billboards/'+name+'-'+view+'.png',
      ()=>{
        // Sprite canopy coverage must not vanish in distant mip levels.
        // The existing foliage preprocessor preserves alpha cutout coverage
        // and bleeds leaf RGB outward, preventing dark texture fringes.
        const prepared=foliageCutoutTexture(texture,.35);
        prepared.userData.sharedCC0=true;
        material.map=prepared;material.needsUpdate=true;
        if(prepared!==texture)texture.dispose();
        onTextureLoaded();
      },
      undefined,
      error=>console.error('Cannot load tree billboard '+name+'/'+view,error),
    );
    texture.name=name+'-high-poly-baked-'+view;
    texture.colorSpace=THREE.SRGBColorSpace;
    texture.minFilter=THREE.LinearMipmapLinearFilter;
    texture.magFilter=THREE.LinearFilter;
    texture.anisotropy=8;
    texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;
    texture.userData.sharedCC0=true;
    // Bake stores lighting from the original model; do not double-light it.
    material=new THREE.MeshBasicMaterial({
      name:name+'-'+view+'-high-detail-baked-cross-card',
      map:texture,color:0xffffff,side:THREE.DoubleSide,
      alphaTest:.35,alphaToCoverage:true,
      transparent:false,depthWrite:true,fog:true,
    });
    material.userData.sharedCC0=true;
    // Far trees are pre-lit baked images on MeshBasicMaterial. Unlike the
    // near/mid PBR foliage they receive no direct/ambient scene light, so the
    // yellow-green canopy can look fluorescent at distance. Select only the
    // green-dominant pixels and grade them toward a neutral grey-olive value.
    // Preserve local luminance/leaf detail, alpha, and the bark's warm colour.
    // The subsequent treeLodFade shader hook can still replace this with the
    // pure red FAR debug colour.
    const previousCompile=material.onBeforeCompile;
    material.onBeforeCompile=(shader,renderer)=>{
      previousCompile.call(material,shader,renderer);
      shader.fragmentShader=shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
          float leafGreenExcess=diffuseColor.g-max(diffuseColor.r,diffuseColor.b);
          float leafMask=smoothstep(0.006,0.036,leafGreenExcess);
          float leafLuma=dot(diffuseColor.rgb,vec3(0.2126,0.7152,0.0722));
          // Mild desaturation with a natural cool-olive bias. The final 0.84
          // factor matches the baked Basic foliage more closely to shaded
          // Mid leaves without flattening darker/lighter source clusters.
          vec3 mutedLeaf=mix(diffuseColor.rgb,leafLuma*vec3(0.97,1.03,0.91),0.46)*0.84;
          diffuseColor.rgb=mix(diffuseColor.rgb,mutedLeaf,leafMask);
        `,
      );
    };
    material.customProgramCacheKey=()=>name+'-'+view+'-muted-far-leaves-v1';
    return material;
  };
  return {geometry,materials:[makeMaterial('front'),makeMaterial('side')]};
}
