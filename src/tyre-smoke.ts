import * as THREE from 'three';

const CAPACITY=320;
type Particle={position:THREE.Vector3;velocity:THREE.Vector3;age:number;life:number;radius:number;growth:number;opacity:number;angle:number;spin:number;shade:number};

/** World-space smoke in one draw call; stopped tyres leave their smoke to disperse. */
export class TyreSmoke {
  readonly mesh:THREE.Mesh<THREE.InstancedBufferGeometry,THREE.ShaderMaterial>;
  private centers=new Float32Array(CAPACITY*3);
  private parameters=new Float32Array(CAPACITY*4);
  private particles:Particle[]=Array.from({length:CAPACITY},()=>({position:new THREE.Vector3(),velocity:new THREE.Vector3(),age:0,life:0,radius:0,growth:0,opacity:0,angle:0,spin:0,shade:1}));
  private emitters=Array.from({length:2},()=>({active:false,carry:0,position:new THREE.Vector3()}));
  private cursor=0;

  constructor(){
    const plane=new THREE.PlaneGeometry(1,1),geometry=new THREE.InstancedBufferGeometry();
    geometry.setIndex(plane.index!.clone());
    geometry.setAttribute('position',plane.getAttribute('position').clone());
    geometry.setAttribute('uv',plane.getAttribute('uv').clone());plane.dispose();
    geometry.setAttribute('smokeCenter',new THREE.InstancedBufferAttribute(this.centers,3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('smokeParams',new THREE.InstancedBufferAttribute(this.parameters,4).setUsage(THREE.DynamicDrawUsage));
    geometry.instanceCount=0;
    const material=new THREE.ShaderMaterial({
      uniforms:{...THREE.UniformsUtils.clone(THREE.UniformsLib.fog)},
      transparent:true,depthTest:true,depthWrite:false,fog:true,
      vertexShader:`
        attribute vec3 smokeCenter;
        attribute vec4 smokeParams;
        varying vec2 vUv;
        varying float vOpacity;
        varying float vShade;
        #include <fog_pars_vertex>
        void main(){
          vUv=uv;vOpacity=smokeParams.y;vShade=smokeParams.w;
          float c=cos(smokeParams.z),s=sin(smokeParams.z);
          vec2 corner=mat2(c,-s,s,c)*position.xy*smokeParams.x;
          vec4 mvPosition=modelViewMatrix*vec4(smokeCenter,1.0);
          mvPosition.xy+=corner;
          gl_Position=projectionMatrix*mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader:`
        varying vec2 vUv;
        varying float vOpacity;
        varying float vShade;
        #include <fog_pars_fragment>
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){
          vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0)),f.x),f.y);
        }
        void main(){
          vec2 p=vUv*2.0-1.0;
          float cloud=noise(vUv*6.0)*0.65+noise(vUv*13.0)*0.35;
          float edge=1.0-smoothstep(0.35,1.0,length(p)+(cloud-0.5)*0.18);
          float alpha=edge*edge*(0.55+cloud*0.45)*vOpacity;
          if(alpha<0.003)discard;
          vec3 color=mix(vec3(0.62,0.65,0.65),vec3(0.88,0.90,0.89),cloud)*vShade;
          gl_FragColor=vec4(color,alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`
    });
    this.mesh=new THREE.Mesh(geometry,material);this.mesh.name='tyre-smoke';
    // Ground decals write no depth. Composite smoke after them so its alpha
    // attenuates marks beneath the cloud, while solid cars/terrain still occlude it.
    this.mesh.renderOrder=10;this.mesh.frustumCulled=false;this.mesh.visible=false;
  }

  emit(wheel:number,position:THREE.Vector3,normal:THREE.Vector3,velocity:{x:number;y:number;z:number},intensity:number,width:number,dt:number){
    const emitter=this.emitters[wheel],strength=THREE.MathUtils.clamp(intensity,0,1),step=Math.min(.06,Math.max(0,dt));
    if(step===0)return;
    // Interpolate emissions between contact points so the trail stays continuous at low FPS.
    if(emitter.position.distanceToSquared(position)>Math.max(4,(velocity.x**2+velocity.y**2+velocity.z**2)*step*step*4))emitter.active=false;
    if(!emitter.active){emitter.position.copy(position);emitter.carry=1;emitter.active=true;}
    const rate=24+strength*40+Math.min(26,Math.hypot(velocity.x,velocity.z)*.35),carry=emitter.carry,total=carry+step*rate;
    for(let i=1;i<=Math.floor(total);i++){
      const fraction=THREE.MathUtils.clamp((i-carry)/(step*rate),0,1),p=this.particles[this.cursor];
      this.cursor=(this.cursor+1)%CAPACITY;
      p.radius=(width*.65+.04)*(.85+Math.random()*.3);
      p.position.lerpVectors(emitter.position,position,fraction).addScaledVector(normal,p.radius*.7);
      p.velocity.set(velocity.x*.045+(Math.random()-.5)*.9,Math.max(0,velocity.y)*.025+.45+Math.random()*.35,velocity.z*.045+(Math.random()-.5)*.9).addScaledVector(normal,.25);
      p.age=0;p.life=1.15+Math.random()*.6;p.growth=.65+strength*.7;
      p.opacity=.22+strength*.34;p.angle=Math.random()*Math.PI*2;p.spin=(Math.random()-.5)*.65;p.shade=.94+Math.random()*.12;
    }
    emitter.carry=total-Math.floor(total);emitter.position.copy(position);
  }

  stop(wheel:number){this.emitters[wheel].active=false;this.emitters[wheel].carry=0;}

  update(dt:number){
    const step=Math.min(.06,Math.max(0,dt)),drag=Math.exp(-step*1.5);
    let count=0;
    for(const p of this.particles){
      if(p.age>=p.life)continue;
      p.age+=step;if(p.age>=p.life)continue;
      p.position.addScaledVector(p.velocity,step);p.velocity.x*=drag;p.velocity.z*=drag;p.velocity.y+=step*.12;
      p.angle+=p.spin*step;
      const life=p.age/p.life,offset=count*4;
      p.position.toArray(this.centers,count*3);
      this.parameters[offset]=(p.radius+p.growth*p.age)*2;
      this.parameters[offset+1]=p.opacity*Math.min(1,p.age/.07)*(1-life)*(1-life);
      this.parameters[offset+2]=p.angle;this.parameters[offset+3]=p.shade;count++;
    }
    this.mesh.visible=count>0;this.mesh.geometry.instanceCount=count;
    if(count){this.mesh.geometry.getAttribute('smokeCenter').needsUpdate=true;this.mesh.geometry.getAttribute('smokeParams').needsUpdate=true;}
  }

  clear(){
    for(const p of this.particles)p.life=0;
    this.stop(0);this.stop(1);this.cursor=0;this.mesh.visible=false;this.mesh.geometry.instanceCount=0;
  }
}
