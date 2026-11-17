import * as THREE from 'three';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {CascadeSun} from './cascade-sun';
import {TemporalMaterials} from './temporal-materials';
import {SunLensFlare} from './sun-lens-flare';
import {fullscreenVertex,volumeFragment,combineFragment,temporalFragment} from './daylight-post-shaders';

function target(depth=false){
  return new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:depth,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});
}
function post(fragmentShader:string,uniforms:Record<string,THREE.IUniform>){
  return new THREE.ShaderMaterial({vertexShader:fullscreenVertex,fragmentShader,uniforms,depthTest:false,depthWrite:false,blending:THREE.NoBlending,toneMapped:false});
}
function halton(index:number,base:number){let value=0,weight=1;while(index>0){weight/=base;value+=weight*(index%base);index=Math.floor(index/base);}return value;}

/** Linear HDR -> GTAO + shadowed air -> motion-reprojected TAA -> sun optics -> ACES/sRGB.
 * The scene renders once, preserving water, alpha coverage and overlay order. */
export class DaylightPipeline {
  readonly sun:CascadeSun;
  readonly supported:boolean;
  private motion=new TemporalMaterials();
  private sceneTarget:THREE.WebGLRenderTarget;
  private combined=target();
  private history=[target(),target()];
  private volumeTarget=target();
  private gtao:GTAOPass;
  private output=new OutputPass();
  private flare:SunLensFlare;
  private quad=new FullScreenQuad();
  private volume:THREE.ShaderMaterial;
  private combine:THREE.ShaderMaterial;
  private temporal:THREE.ShaderMaterial;
  private frame=0;
  private ready=false;
  private width=0;
  private height=0;
  private previousPosition=new THREE.Vector3();
  private previousRotation=new THREE.Quaternion();
  private previousProjection=new THREE.Matrix4();
  private viewProjection=new THREE.Matrix4();
  private projection=new THREE.Matrix4();
  private write=0;
  private white=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);

  constructor(private renderer:THREE.WebGLRenderer,private scene:THREE.Scene,private camera:THREE.PerspectiveCamera){
    this.supported=renderer.extensions.has('EXT_color_buffer_float');
    // WebGL MRT requires an output for every active colour attachment,
    // including the renderer-owned sky, not just scene mesh materials.
    for(const shader of [THREE.ShaderLib.background,THREE.ShaderLib.backgroundCube]){
      if(!shader.fragmentShader.includes('temporalSkyMotion'))shader.fragmentShader=`layout(location=1) out highp vec4 temporalSkyMotion;\n${shader.fragmentShader}`.replace(/}\s*$/,'temporalSkyMotion=vec4(0.0);\n}');
    }
    this.sun=new CascadeSun(scene,camera);this.white.needsUpdate=true;
    const gl=renderer.getContext() as WebGL2RenderingContext;
    const supportedSamples=this.supported?Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER,gl.RGBA16F,gl.SAMPLES) as Int32Array):[];
    const samples=Math.max(0,...supportedSamples.filter(n=>n<=4));
    this.sceneTarget=new THREE.WebGLRenderTarget(1,1,{count:2,type:THREE.HalfFloatType,depthBuffer:true,samples});
    this.sceneTarget.textures[0].name='daylight-HDR-colour';this.sceneTarget.textures[1].name='daylight-motion-and-reactivity';
    this.sceneTarget.textures[1].minFilter=this.sceneTarget.textures[1].magFilter=THREE.NearestFilter;
    this.sceneTarget.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
    this.sceneTarget.depthTexture.minFilter=this.sceneTarget.depthTexture.magFilter=THREE.NearestFilter;
    this.flare=new SunLensFlare(this.sceneTarget.depthTexture,this.output);
    // Construct the addon's owned resources before switching to external
    // depth. Its r181 setGBuffer/setSize/dispose expect that owned target.
    this.gtao=new GTAOPass(scene,camera,1,1);this.gtao.setGBuffer(this.sceneTarget.depthTexture);
    this.gtao.output=GTAOPass.OUTPUT.Off;
    this.gtao.updateGtaoMaterial({radius:.65,thickness:.3,distanceFallOff:1,scale:1,samples:8});
    this.gtao.updatePdMaterial({radius:3,samples:8,depthPhi:3,normalPhi:4});
    this.volume=post(volumeFragment,{
      sceneDepth:{value:this.sceneTarget.depthTexture},shadow0:{value:this.white},shadow1:{value:this.white},shadow2:{value:this.white},
      shadowMatrix0:{value:new THREE.Matrix4()},shadowMatrix1:{value:new THREE.Matrix4()},shadowMatrix2:{value:new THREE.Matrix4()},
      inverseProjection:{value:camera.projectionMatrixInverse},cameraWorld:{value:camera.matrixWorld},worldToView:{value:camera.matrixWorldInverse},
      sunDirection:{value:new THREE.Vector3()},sunColour:{value:new THREE.Color(0xfff3df).multiplyScalar(3.4)},
      shadowSplits:{value:new THREE.Vector2()},cameraNear:{value:camera.near},cameraFar:{value:camera.far},frameIndex:{value:0},baseHeight:{value:0},
    });
    this.combine=post(combineFragment,{
      sceneColour:{value:this.sceneTarget.textures[0]},sceneDepth:{value:this.sceneTarget.depthTexture},ambientOcclusion:{value:this.gtao.gtaoMap},volume:{value:this.volumeTarget.texture},
      halfResolution:{value:new THREE.Vector2()},inverseProjection:{value:camera.projectionMatrixInverse},
    });
    this.temporal=post(temporalFragment,{
      currentColour:{value:this.combined.texture},historyColour:{value:null},sceneDepth:{value:this.sceneTarget.depthTexture},motion:{value:this.sceneTarget.textures[1]},
      texel:this.motion.texel,inverseProjection:{value:camera.projectionMatrixInverse},cameraWorld:{value:camera.matrixWorld},previousViewProjection:this.motion.previousViewProjection,historyReady:{value:0},
    });
    // History alpha stores depth, not opacity. The displayed canvas is opaque.
    this.output.material.fragmentShader=this.output.material.fragmentShader.replace(/}\s*$/,'gl_FragColor.a=1.0;\n}');
    this.output.renderToScreen=true;
  }
  reset(){this.ready=false;this.frame=0;this.flare.reset();}
  resize(){
    const size=this.renderer.getDrawingBufferSize(new THREE.Vector2()),w=size.x,h=size.y;
    if(w===this.width&&h===this.height)return;
    this.width=w;this.height=h;this.sceneTarget.setSize(w,h);this.combined.setSize(w,h);this.history.forEach(t=>t.setSize(w,h));
    const halfW=Math.max(1,Math.ceil(w/2)),halfH=Math.max(1,Math.ceil(h/2));
    this.volumeTarget.setSize(halfW,halfH);this.gtao.setSize(halfW,halfH);
    this.combine.uniforms.halfResolution.value.set(halfW,halfH);this.motion.texel.value.set(1/w,1/h);this.reset();
  }
  private draw(material:THREE.ShaderMaterial,destination:THREE.WebGLRenderTarget){
    this.renderer.setRenderTarget(destination);this.quad.material=material;this.quad.render(this.renderer);
  }
  render(time:number,sunDirection:THREE.Vector3,dynamicRoots:THREE.Object3D[],baseHeight:number){
    this.resize();this.camera.updateMatrixWorld();this.scene.updateMatrixWorld();
    if(this.previousPosition.distanceToSquared(this.camera.position)>900||Math.abs(this.previousRotation.dot(this.camera.quaternion))<.8)this.reset();
    if(!this.previousProjection.equals(this.camera.projectionMatrix)){
      // FOV may change smoothly with speed; abrupt near/far/aspect changes
      // require a reset. Smaller FOV changes remain fully reprojectable.
      const a=this.previousProjection.elements,b=this.camera.projectionMatrix.elements;
      if(Math.abs(a[14]-b[14])>.001||Math.abs(a[10]-b[10])>.001||Math.abs(a[0]/a[5]-b[0]/b[5])>.001)this.reset();
      this.previousProjection.copy(this.camera.projectionMatrix);
    }
    if(!this.supported){this.sun.update(this.scene,sunDirection);this.renderer.shadowMap.needsUpdate=true;this.renderer.render(this.scene,this.camera);return;}
    this.motion.prepare(this.scene,dynamicRoots,this.sceneTarget.samples>0);this.sun.update(this.scene,sunDirection);
    this.projection.copy(this.camera.projectionMatrix);
    const index=this.frame%8+1;
    this.camera.projectionMatrix.elements[8]+=(halton(index,2)-.5)*2/this.width;
    this.camera.projectionMatrix.elements[9]+=(halton(index,3)-.5)*2/this.height;
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.viewProjection.multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse);
    if(!this.ready){this.motion.previousViewProjection.value.copy(this.viewProjection);this.motion.previousTime.value=time;}
    const previousTarget=this.renderer.getRenderTarget();
    try{
      this.renderer.shadowMap.needsUpdate=true;
      this.renderer.setRenderTarget(this.sceneTarget);this.renderer.render(this.scene,this.camera);
      const uniforms=this.volume.uniforms,far=Math.min(this.sun.csm.maxFar,this.camera.far);
      this.sun.csm.lights.forEach((light,i)=>{uniforms[`shadow${i}`].value=light.shadow.map?.texture??this.white;uniforms[`shadowMatrix${i}`].value.copy(light.shadow.matrix);});
      uniforms.shadowSplits.value.set(this.sun.csm.breaks[0]*far,this.sun.csm.breaks[1]*far);
      uniforms.sunDirection.value.copy(sunDirection);uniforms.frameIndex.value=this.frame%8;uniforms.baseHeight.value=baseHeight;
      this.gtao.render(this.renderer,this.combined,this.sceneTarget,0,false);
      this.draw(this.volume,this.volumeTarget);this.draw(this.combine,this.combined);
      this.temporal.uniforms.historyColour.value=this.history[1-this.write].texture;
      this.temporal.uniforms.historyReady.value=this.ready?1:0;
      this.draw(this.temporal,this.history[this.write]);
      this.flare.render(this.renderer,this.camera,this.projection,sunDirection,time,this.width,this.height,this.scene.background instanceof THREE.Texture?this.scene.backgroundIntensity:0);
      this.output.render(this.renderer,this.combined,this.history[this.write],0,false);
      this.motion.commit(this.viewProjection,time);this.ready=true;this.write=1-this.write;this.frame++;
      this.previousPosition.copy(this.camera.position);this.previousRotation.copy(this.camera.quaternion);
    }finally{
      this.camera.projectionMatrix.copy(this.projection);this.camera.projectionMatrixInverse.copy(this.projection).invert();this.renderer.setRenderTarget(previousTarget);
    }
  }
  dispose(){
    this.sun.dispose();this.flare.dispose();this.sceneTarget.dispose();this.combined.dispose();this.history.forEach(t=>t.dispose());this.volumeTarget.dispose();
    this.gtao.dispose();this.gtao.gtaoMaterial.dispose();this.gtao.blendMaterial.dispose();this.output.dispose();this.volume.dispose();this.combine.dispose();this.temporal.dispose();this.white.dispose();this.quad.dispose();
  }
}
