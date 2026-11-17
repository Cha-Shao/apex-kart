import * as THREE from 'three';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';
import type {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {fullscreenVertex} from './daylight-post-shaders';

const visibilityFragment=`
varying vec2 vUv;
uniform sampler2D sceneDepth,previousVisibility;
uniform vec2 sunUV,discRadius,response;
uniform float historyReady;
void main(){
  float visible=0.0,weight=0.0;
  // Resolve the solar disc once per frame, using the scene's actual cutout
  // foliage and MSAA depth instead of CPU raycasts or another scene render.
  for(int y=-2;y<=2;y++)for(int x=-2;x<=2;x++){
    vec2 offset=vec2(float(x),float(y))*.42;
    float w=max(0.0,1.0-dot(offset,offset));
    vec2 uv=sunUV+offset*discRadius;
    float sky=step(.999999,texture2D(sceneDepth,clamp(uv,0.0,1.0)).r);
    if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0))))sky=0.0;
    visible+=sky*w;weight+=w;
  }
  visible/=weight;
  if(historyReady>.5){
    float previous=texture2D(previousVisibility,vec2(.5)).r;
    visible=mix(previous,visible,visible<previous?response.y:response.x);
  }
  gl_FragColor=vec4(vec3(visible),1.0);
}`;

const optics=`
uniform sampler2D flareVisibility;
uniform vec2 flareSun;
uniform float flareAspect,flarePixelSize,flareStrength;
vec3 lensGhost(vec2 p,vec2 centre,float radius,vec3 tint){
  vec2 q=(p-centre)/radius;float r2=dot(q,q);
  float disc=1.0-smoothstep(0.0,1.0,r2);
  float rim=smoothstep(.44,.64,r2)*(1.0-smoothstep(.70,1.0,r2));
  return tint*(disc*disc*.65+rim*.22);
}
vec3 solarLensFlare(vec2 uv){
  if(flareStrength<=0.0)return vec3(0.0);
  float visibility=texture2D(flareVisibility,vec2(.5)).r*flareStrength;
  if(visibility<.001)return vec3(0.0);
  // Height-based coordinates keep the optics circular on every aspect ratio.
  vec2 p=(uv-.5)*vec2(flareAspect,1.0),sun=(flareSun-.5)*vec2(flareAspect,1.0);
  vec2 delta=p-sun;
  vec2 q=mat2(.9801,-.1987,.1987,.9801)*delta;
  float r=length(delta),width=max(.0008,flarePixelSize*.7);
  float core=3.8*exp(-r*r/.000024);
  float glow=.12*exp(-r*23.0);
  float rays=.8*(exp(-abs(q.y)/width-abs(q.x)*16.0)+exp(-abs(q.x)/width-abs(q.y)*16.0));
  vec2 diagonal=vec2(q.x+q.y,q.x-q.y)*.7071;
  rays+=.28*(exp(-abs(diagonal.x)/width-abs(diagonal.y)*24.0)+exp(-abs(diagonal.y)/width-abs(diagonal.x)*24.0));
  vec3 light=vec3(1.0,.91,.76)*(core+glow+rays);
  // Internal reflections lie along the source / optical-centre axis.
  vec3 ghosts=lensGhost(p,sun*.62,.018,vec3(.32,.46,1.0)*.19);
  ghosts+=lensGhost(p,sun*.37,.027,vec3(.65,.25,1.0)*.20);
  ghosts+=lensGhost(p,sun*.08,.043,vec3(1.0,.32,.47)*.15);
  ghosts+=lensGhost(p,sun*-.24,.047,vec3(1.0,.36,.68)*.17);
  ghosts+=lensGhost(p,sun*-.51,.025,vec3(.53,.35,1.0)*.23);
  ghosts+=lensGhost(p,sun*-.78,.058,vec3(.32,.52,1.0)*.19);
  ghosts+=lensGhost(p,sun*-1.08,.075,vec3(.34,.69,1.0)*.12);
  ghosts+=lensGhost(p,sun*-1.36,.044,vec3(1.0,.58,.28)*.13);
  float separation=smoothstep(.015,.28,length(sun));
  light+=ghosts*separation;
  vec2 axis=sun/max(length(sun),.0001),fromCentre=p+sun*.12;
  vec2 ellipse=vec2(dot(fromCentre,axis),dot(fromCentre,vec2(-axis.y,axis.x)))/vec2(.63,.29);
  float ring=length(ellipse);
  float amber=1.0-smoothstep(.003,.014,abs(ring-1.0));
  float blue=1.0-smoothstep(.004,.016,abs(ring-.979));
  light+=(vec3(1.0,.43,.14)*amber*.025+vec3(.22,.38,1.0)*blue*.014)*separation;
  return light*visibility;
}`;

/** Camera optics are added after TAA, before the existing HDR tone mapping.
 * Only two one-pixel visibility targets are needed; no image readback. */
export class SunLensFlare {
  private targets=[0,1].map(()=>new THREE.WebGLRenderTarget(1,1,{
    type:THREE.HalfFloatType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,
  }));
  private visibility:THREE.ShaderMaterial;
  private quad:FullScreenQuad;
  private direction=new THREE.Vector3();
  private projected=new THREE.Vector4();
  private write=0;
  private ready=false;
  private previousTime=0;
  private uniforms={
    flareVisibility:{value:this.targets[0].texture},flareSun:{value:new THREE.Vector2()},
    flareAspect:{value:1},flarePixelSize:{value:1},flareStrength:{value:0},
  };

  constructor(depth:THREE.DepthTexture,output:OutputPass){
    this.visibility=new THREE.ShaderMaterial({
      vertexShader:fullscreenVertex,fragmentShader:visibilityFragment,
      uniforms:{sceneDepth:{value:depth},previousVisibility:{value:this.targets[1].texture},
        sunUV:{value:new THREE.Vector2()},discRadius:{value:new THREE.Vector2()},
        response:{value:new THREE.Vector2()},historyReady:{value:0}},
      depthTest:false,depthWrite:false,blending:THREE.NoBlending,toneMapped:false,
    });
    this.quad=new FullScreenQuad(this.visibility);
    Object.assign(output.uniforms,this.uniforms);
    output.material.fragmentShader=output.material.fragmentShader
      .replace('void main() {',`${optics}\nvoid main() {`)
      .replace('// tone mapping','gl_FragColor.rgb+=solarLensFlare(vUv);\n// tone mapping');
  }

  reset(){this.ready=false;this.uniforms.flareStrength.value=0;}

  render(renderer:THREE.WebGLRenderer,camera:THREE.PerspectiveCamera,projection:THREE.Matrix4,sun:THREE.Vector3,time:number,width:number,height:number,intensity:number){
    this.direction.copy(sun).transformDirection(camera.matrixWorldInverse);
    if(intensity<=0||sun.y<=0||this.direction.z>=-.001){this.reset();return;}
    this.projected.set(this.direction.x,this.direction.y,this.direction.z,0).applyMatrix4(projection);
    const x=this.projected.x/this.projected.w*.5+.5,y=this.projected.y/this.projected.w*.5+.5;
    const edge=Math.min(x,1-x,y,1-y);
    if(edge<=0){this.reset();return;}
    this.uniforms.flareSun.value.set(x,y);this.uniforms.flareAspect.value=width/height;this.uniforms.flarePixelSize.value=1/height;
    this.uniforms.flareStrength.value=THREE.MathUtils.smoothstep(edge,0,.065)*THREE.MathUtils.smoothstep(sun.y,0,.12)*intensity;
    const uniforms=this.visibility.uniforms;
    // The optics use the stable projection; depth sampling follows TAA jitter.
    uniforms.sunUV.value.set(x+(projection.elements[8]-camera.projectionMatrix.elements[8])*.5,y+(projection.elements[9]-camera.projectionMatrix.elements[9])*.5);
    const radius=Math.tan(THREE.MathUtils.degToRad(.3))*.5*projection.elements[5];
    uniforms.discRadius.value.set(Math.max(radius*height/width,1/width),Math.max(radius,1/height));
    const dt=THREE.MathUtils.clamp(time-this.previousTime,0,.1);
    uniforms.response.value.set(1-Math.exp(-dt*18),1-Math.exp(-dt*55));
    uniforms.historyReady.value=this.ready?1:0;uniforms.previousVisibility.value=this.targets[1-this.write].texture;
    renderer.setRenderTarget(this.targets[this.write]);this.quad.render(renderer);
    this.uniforms.flareVisibility.value=this.targets[this.write].texture;
    this.write=1-this.write;this.ready=true;this.previousTime=time;
  }

  dispose(){this.targets.forEach(t=>t.dispose());this.visibility.dispose();this.quad.dispose();}
}
