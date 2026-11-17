import * as THREE from 'three';
import {CSM} from 'three/addons/csm/CSM.js';

/** Three view-frustum cascades, shared by PBR, foliage and air scattering. */
export class CascadeSun {
  readonly csm:CSM;
  private registered=new WeakSet<THREE.Material>();
  private projection=new THREE.Matrix4();
  constructor(scene:THREE.Scene,camera:THREE.PerspectiveCamera){
    this.csm=new CSM({camera,parent:scene,cascades:3,maxFar:420,mode:'practical',shadowMapSize:2048,shadowBias:-.000025,lightDirection:new THREE.Vector3(.52,-.78,-.35).normalize(),lightIntensity:3.4,lightNear:1,lightFar:2200,lightMargin:250});
    this.csm.fade=true;this.csm.updateFrustums();
    this.csm.lights.forEach((light,i)=>{light.name=`daylight-cascade-${i}`;light.color.set(0xfff3df);light.shadow.normalBias=.018;light.shadow.radius=2;});
  }
  update(scene:THREE.Scene,direction:THREE.Vector3){
    this.csm.lightDirection.copy(direction).negate();
    if(!this.projection.equals(this.csm.camera.projectionMatrix)){
      this.projection.copy(this.csm.camera.projectionMatrix);this.csm.updateFrustums();
    }
    scene.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return;
      for(const material of Array.isArray(object.material)?object.material:[object.material]){
        if(this.registered.has(material)||!(material instanceof THREE.MeshStandardMaterial||material instanceof THREE.MeshLambertMaterial||material instanceof THREE.MeshPhongMaterial))continue;
        this.registered.add(material);
        const compile=material.onBeforeCompile,key=material.customProgramCacheKey();
        this.csm.setupMaterial(material);const csmCompile=material.onBeforeCompile;
        material.onBeforeCompile=(shader,renderer)=>{compile.call(material,shader,renderer);csmCompile.call(material,shader,renderer);};
        material.customProgramCacheKey=()=>`${key}:csm-three-fade`;material.needsUpdate=true;
        material.addEventListener('dispose',()=>this.csm.shaders.delete(material));
      }
    });
    this.csm.update();
  }
  dispose(){this.csm.remove();this.csm.lights.forEach(light=>light.shadow.dispose());this.csm.dispose();}
}
