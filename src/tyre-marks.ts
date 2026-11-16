import * as THREE from 'three';

const CAPACITY=4096;
const MIN_STEP=.06,MAX_STEP=.18,TEXTURE_LENGTH=2.4;
const START_FADE=.38,END_FADE=.32;
const smooth=(value:number)=>{const t=THREE.MathUtils.clamp(value,0,1);return t*t*(3-2*t);};
type Section={center:THREE.Vector3;side:THREE.Vector3;normal:THREE.Vector3;distance:number;strength:number;opacity:number};
type Segment={slot:number;serial:number;from:number;to:number;fromOpacity:number;toOpacity:number};
type Emitter={point:Section|null;tail:Segment[];phase:number};

/** A small, repeating coverage map for slick-tyre abrasion, not a tread stamp. */
function abrasionTexture(anisotropy:number){
  const width=128,height=512,data=new Uint8Array(width*height*4);
  const hash=(x:number,y:number,seed:number)=>{
    let n=Math.imul(x,374761393)^Math.imul(y,668265263)^seed;
    n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;
  };
  const noise=(x:number,y:number,period:number,seed:number)=>{
    const ix=Math.floor(x),iy=Math.floor(y),fx=smooth(x-ix),fy=smooth(y-iy);
    const at=(dx:number,dy:number)=>hash(ix+dx,((iy+dy)%period+period)%period,seed);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(0,0),at(1,0),fx),THREE.MathUtils.lerp(at(0,1),at(1,1),fx),fy);
  };
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const u=(x+.5)/width,v=(y+.5)/height;
    const streaks=noise(u*48,v*3,3,79),patches=noise(u*9,v*18,18,233);
    const raggedEdge=.025+.035*noise(u*6,v*12,12,419);
    const edge=smooth((Math.min(u,1-u)-raggedEdge)/.12);
    const grain=.72+.28*hash(x,y,617),pressure=.85+.15*Math.sin(u*Math.PI);
    const coverage=edge*pressure*(.58+.42*streaks)*(.58+.42*patches)*grain;
    const offset=(y*width+x)*4,value=Math.round(coverage*255);
    data[offset]=data[offset+1]=data[offset+2]=value;data[offset+3]=255;
  }
  const texture=new THREE.DataTexture(data,width,height,THREE.RGBAFormat);
  texture.name='dynamic-tyre-abrasion-coverage';texture.wrapS=THREE.ClampToEdgeWrapping;texture.wrapT=THREE.RepeatWrapping;
  texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;
  texture.anisotropy=anisotropy;texture.needsUpdate=true;return texture;
}

/** Driving marks only. Road-generated rubber stays in the asphalt material. */
export class TyreMarks {
  readonly mesh:THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>;
  private positions=new THREE.BufferAttribute(new Float32Array(CAPACITY*18),3).setUsage(THREE.DynamicDrawUsage);
  private uvs=new THREE.BufferAttribute(new Float32Array(CAPACITY*12),2).setUsage(THREE.DynamicDrawUsage);
  private colors=new THREE.BufferAttribute(new Float32Array(CAPACITY*24).fill(1),4).setUsage(THREE.DynamicDrawUsage);
  private emitters:Emitter[]=Array.from({length:2},()=>({point:null,tail:[],phase:0}));
  private serials=new Uint32Array(CAPACITY);
  private cursor=0;
  private count=0;
  private serial=0;
  private stroke=0;
  private geometryChanged=false;
  private opacityChanged=false;

  constructor(anisotropy=1){
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',this.positions);geometry.setAttribute('uv',this.uvs);geometry.setAttribute('color',this.colors);geometry.setDrawRange(0,0);
    // Black alpha coverage darkens the existing road grain and lighting rather
    // than painting over them with a flat, opaque rubber colour.
    const material=new THREE.MeshBasicMaterial({color:0x000000,alphaMap:abrasionTexture(anisotropy),vertexColors:true,transparent:true,
      side:THREE.DoubleSide,depthTest:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
    this.mesh=new THREE.Mesh(geometry,material);this.mesh.name='ground-tyre-marks';
    this.mesh.renderOrder=3;this.mesh.frustumCulled=false;this.mesh.visible=false;
  }

  emit(wheel:number,contact:THREE.Vector3,normal:THREE.Vector3,axle:THREE.Vector3,width:number,intensity:number,maxDistance:number){
    const emitter=this.emitters[wheel],center=contact.clone().addScaledVector(normal,.026);
    const strength=THREE.MathUtils.clamp(intensity,0,1),previous=emitter.point;
    if(!previous){
      emitter.phase=(++this.stroke*.61803398875+wheel*.37)%1;
      emitter.point={center,normal:normal.clone(),side:axle.clone().multiplyScalar(width*.47),distance:0,strength,opacity:0};return;
    }
    const delta=center.clone().sub(previous.center),distance=delta.length();
    // Never bridge a reset, loss of contact, or a discontinuous support plane.
    if(distance>maxDistance||normal.dot(previous.normal)<.65){this.stop(wheel);this.emit(wheel,contact,normal,axle,width,intensity,maxDistance);return;}
    if(distance<MIN_STEP)return;
    const side=new THREE.Vector3().crossVectors(normal,delta).normalize();
    if(side.lengthSq()<.5){this.stop(wheel);return;}
    if(side.dot(previous.side)<0)side.negate();
    // The swept contact patch becomes narrower during a sideways slide. Keep
    // its edges perpendicular to travel so tight spins do not fold the ribbon.
    const alignment=THREE.MathUtils.clamp(Math.abs(side.dot(axle)),0,1);
    side.multiplyScalar(width*.47*Math.sqrt(alignment*alignment+.36*(1-alignment*alignment)));
    const targetStrength=THREE.MathUtils.lerp(previous.strength,strength,1-Math.exp(-distance*6));
    const steps=Math.ceil(distance/MAX_STEP);
    let from=previous;
    for(let i=1;i<=steps;i++){
      const t=i/steps,travel=previous.distance+distance*t,sampleStrength=THREE.MathUtils.lerp(previous.strength,targetStrength,t);
      const to:Section={center:new THREE.Vector3().lerpVectors(previous.center,center,t),side:new THREE.Vector3().lerpVectors(previous.side,side,t),
        normal:new THREE.Vector3().lerpVectors(previous.normal,normal,t).normalize(),distance:travel,strength:sampleStrength,
        opacity:(.18+.4*sampleStrength)*smooth(travel/START_FADE)};
      this.append(emitter,from,to);from=to;
    }
    emitter.point=from;
    while(emitter.tail.length&&emitter.tail[0].to<=from.distance-END_FADE)emitter.tail.shift();
  }

  private append(emitter:Emitter,from:Section,to:Section){
    const slot=this.cursor,serial=++this.serial;
    this.serials[slot]=serial;
    const sections=[from,from,to,from,to,to],sides=[1,-1,1,-1,-1,1];
    for(let i=0;i<6;i++){
      const point=sections[i],sign=sides[i],vertex=slot*6+i;
      this.positions.setXYZ(vertex,point.center.x+point.side.x*sign,point.center.y+point.side.y*sign,point.center.z+point.side.z*sign);
      this.uvs.setXY(vertex,sign>0?0:1,point.distance/TEXTURE_LENGTH+emitter.phase);
      this.colors.setW(vertex,point.opacity);
    }
    this.positions.addUpdateRange(slot*18,18);this.uvs.addUpdateRange(slot*12,12);this.colors.addUpdateRange(slot*24,24);
    emitter.tail.push({slot,serial,from:from.distance,to:to.distance,fromOpacity:from.opacity,toOpacity:to.opacity});
    this.cursor=(slot+1)%CAPACITY;this.count=Math.min(CAPACITY,this.count+1);this.geometryChanged=this.opacityChanged=true;
  }

  stop(wheel:number){
    const emitter=this.emitters[wheel];
    if(emitter.point)for(const segment of emitter.tail){
      if(this.serials[segment.slot]!==segment.serial)continue;
      const from=segment.fromOpacity*smooth((emitter.point.distance-segment.from)/END_FADE);
      const to=segment.toOpacity*smooth((emitter.point.distance-segment.to)/END_FADE);
      for(let i=0;i<6;i++)this.colors.setW(segment.slot*6+i,i===0||i===1||i===3?from:to);
      this.colors.addUpdateRange(segment.slot*24,24);this.opacityChanged=true;
    }
    emitter.point=null;emitter.tail=[];
  }

  update(){
    if(this.geometryChanged){this.positions.needsUpdate=true;this.uvs.needsUpdate=true;this.mesh.geometry.setDrawRange(0,this.count*6);this.mesh.visible=this.count>0;}
    if(this.opacityChanged)this.colors.needsUpdate=true;
    this.geometryChanged=this.opacityChanged=false;
  }

  clear(){
    for(const emitter of this.emitters){emitter.point=null;emitter.tail=[];}
    this.cursor=this.count=0;this.mesh.geometry.setDrawRange(0,0);this.mesh.visible=false;
    this.positions.clearUpdateRanges();this.uvs.clearUpdateRanges();this.colors.clearUpdateRanges();this.geometryChanged=this.opacityChanged=false;
  }
}
