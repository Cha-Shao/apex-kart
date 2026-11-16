import type { Point } from './track';

export interface TerrainData { resolution:number; originX:number; originZ:number; size:number; heights:number[];datumM?:number;waterLevel?:number|null;waterEnabled?:boolean }
export type BrushMode='raise'|'lower'|'smooth'|'flatten';
const refinedFields=new WeakMap<TerrainField,{revision:number;field:TerrainField}>();
export class TerrainField {
  readonly resolution:number;
  readonly originX:number;
  readonly originZ:number;
  readonly size:number;
  readonly heights:Float32Array;
  /** Start-point elevation in world metres; absent on hand-drawn terrain. */
  datumM?:number;
  /** Undefined uses the terrain default. Disabling keeps the last water level. */
  waterLevel?:number;
  waterEnabled:boolean;
  revision=0;
  constructor(data?:TerrainData){
    this.resolution=data?.resolution??129;this.size=data?.size??500;
    this.originX=data?.originX??-250;this.originZ=data?.originZ??-250;
    this.heights=data?Float32Array.from(data.heights):new Float32Array(this.resolution**2);
    this.datumM=data?.datumM;this.waterLevel=data?.waterLevel??undefined;this.waterEnabled=data?.waterEnabled??(data?.waterLevel!==null);
  }
  get cellSize(){return this.size/(this.resolution-1);}
  get defaultWaterLevel(){return this.waterLevel??(this.datumM===undefined?-1:-this.datumM);}
  get seaLevel(){return this.waterEnabled?this.defaultWaterLevel:null;}
  setWaterLevel(level:number|null){const enabled=level!==null;if(enabled===this.waterEnabled&&(level===null||level===this.waterLevel))return;this.waterEnabled=enabled;if(level!==null)this.waterLevel=level;this.revision++;}
  static around(points:Point[]){const xs=points.map(p=>p.x),zs=points.map(p=>p.z),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);const size=Math.max(500,Math.max(maxX-minX,maxZ-minZ)*1.35+150);return new TerrainField({resolution:129,size,originX:(minX+maxX-size)/2,originZ:(minZ+maxZ-size)/2,heights:new Array(129**2).fill(0)});}
  clone(){return new TerrainField(this.toJSON());}
  /** Refine the editable source without changing its stored samples. Both the
   * renderer and Cannon consume this same monotone-cubic heightfield. */
  refined(){
    const cached=refinedFields.get(this);if(cached?.revision===this.revision)return cached.field;
    if(this.resolution>=257)return this;
    const n=(this.resolution-1)*2+1,heights=new Array<number>(n*n),source=this.resolution;
    const cubic=(a:number,b:number,c:number,d:number,t:number)=>{
      const delta=c-b;if(Math.abs(delta)<1e-12)return b;
      let m0=(c-a)*.5,m1=(d-b)*.5;if(m0*delta<=0)m0=0;if(m1*delta<=0)m1=0;
      const limit=3*Math.abs(delta);m0=Math.sign(m0)*Math.min(Math.abs(m0),limit);m1=Math.sign(m1)*Math.min(Math.abs(m1),limit);
      const t2=t*t,t3=t2*t;return Math.max(Math.min(b,c),Math.min(Math.max(b,c),(2*t3-3*t2+1)*b+(t3-2*t2+t)*m0+(-2*t3+3*t2)*c+(t3-t2)*m1));
    };
    const at=(x:number,z:number)=>this.heights[Math.max(0,Math.min(source-1,z))*source+Math.max(0,Math.min(source-1,x))];
    for(let z=0;z<n;z++)for(let x=0;x<n;x++){
      const fx=x*.5,fz=z*.5,ix=Math.floor(fx),iz=Math.floor(fz),rows=[];
      for(let j=-1;j<=2;j++)rows.push(cubic(at(ix-1,iz+j),at(ix,iz+j),at(ix+1,iz+j),at(ix+2,iz+j),fx-ix));
      heights[z*n+x]=cubic(rows[0],rows[1],rows[2],rows[3],fz-iz);
    }
    const field=new TerrainField({resolution:n,size:this.size,originX:this.originX,originZ:this.originZ,heights,datumM:this.datumM,waterLevel:this.waterLevel,waterEnabled:this.waterEnabled});refinedFields.set(this,{revision:this.revision,field});return field;
  }
  toJSON():TerrainData{return {resolution:this.resolution,size:this.size,originX:this.originX,originZ:this.originZ,heights:Array.from(this.heights,h=>Math.round(h*1000)/1000),datumM:this.datumM,waterLevel:this.waterLevel,waterEnabled:this.waterEnabled};}
  get min(){let min=0;for(const h of this.heights)min=Math.min(min,h);return min;}
  get max(){let max=0;for(const h of this.heights)max=Math.max(max,h);return max;}
  sample(x:number,z:number){
    const n=this.resolution,fx=(x-this.originX)/this.cellSize,fz=(z-this.originZ)/this.cellSize;
    if(fx<0||fz<0||fx>n-1||fz>n-1)return 0;
    const ix=Math.min(n-2,Math.floor(fx)),iz=Math.min(n-2,Math.floor(fz)),tx=fx-ix,tz=fz-iz;
    const a=this.heights[iz*n+ix],b=this.heights[iz*n+ix+1],c=this.heights[(iz+1)*n+ix],d=this.heights[(iz+1)*n+ix+1];
    // The same diagonal as cannon-es Heightfield after rotating local Y into -Z.
    return tx>tz?a+(b-a)*tx+(d-b)*tz:a+(d-c)*tx+(c-a)*tz;
  }
  paint(p:Point,radius:number,strength:number,dt:number,mode:BrushMode){
    const n=this.resolution,step=this.cellSize,old=mode==='smooth'?this.heights.slice():this.heights;
    let changed=false;
    const ix=Math.round((p.x-this.originX)/step),iz=Math.round((p.z-this.originZ)/step),r=Math.ceil(radius/step);
    for(let z=Math.max(1,iz-r);z<=Math.min(n-2,iz+r);z++)for(let x=Math.max(1,ix-r);x<=Math.min(n-2,ix+r);x++){
      const dist=Math.hypot(this.originX+x*step-p.x,this.originZ+z*step-p.z)/radius;if(dist>=1)continue;
      const feather=(1-dist*dist)**3,index=z*n+x,h=this.heights[index];
      let next=h;
      if(mode==='raise'||mode==='lower')next=h+(mode==='raise'?1:-1)*strength*dt*feather;
      else{const target=mode==='flatten'?0:(old[index-1]+old[index+1]+old[index-n]+old[index+n]+old[index]*4)/8;next=h+(target-h)*Math.min(1,strength*dt*.75)*feather;}
      const value=Math.fround(Math.max(-1000,Math.min(1000,next)));
      if(value!==h){this.heights[index]=value;changed=true;}
    }
    if(changed)this.revision++;
  }
  clear(){this.heights.fill(0);this.revision++;}
}
export function parseTerrain(data:unknown):TerrainField{
  const v=data as TerrainData;
  if(!v||![65,129,257].includes(v.resolution)||!Number.isFinite(v.size)||v.size<100||v.size>50000||!Number.isFinite(v.originX)||!Number.isFinite(v.originZ)||Math.abs(v.originX)>25000||Math.abs(v.originZ)>25000||!Array.isArray(v.heights)||v.heights.length!==v.resolution**2||v.heights.some(h=>!Number.isFinite(h)||h<-1000||h>1000))throw new Error('高度图数据无效。');
  if(v.datumM!==undefined&&(!Number.isFinite(v.datumM)||Math.abs(v.datumM)>12000))throw new Error('地形高程基准无效。');
  if(v.waterLevel!==undefined&&v.waterLevel!==null&&(!Number.isFinite(v.waterLevel)||Math.abs(v.waterLevel)>12000))throw new Error('水位数据无效。');
  if(v.waterEnabled!==undefined&&typeof v.waterEnabled!=='boolean')throw new Error('水面开关数据无效。');
  return new TerrainField(v);
}

export class TerrainPainter {
  field:TerrainField;
  mode:BrushMode='raise';
  radius=24;
  strength=4;
  active=false;
  visible=true;
  onChange:()=>void=()=>{};
  history:Float32Array[]=[];
  private pointer:Point|null=null;
  private down=false;
  private reverse=false;
  private lastTime=0;
  private ctx:CanvasRenderingContext2D;
  private map=document.createElement('canvas');
  constructor(public canvas:HTMLCanvasElement,field:TerrainField,private project:(p:Point)=>{x:number;y:number},private unproject:(x:number,y:number)=>Point){
    this.field=field;canvas.width=800;canvas.height=600;this.ctx=canvas.getContext('2d')!;
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    canvas.addEventListener('pointerdown',e=>{if(!this.active||e.button>2)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);this.history.push(this.field.heights.slice());if(this.history.length>12)this.history.shift();this.down=true;this.reverse=e.button===2||e.shiftKey;this.updatePointer(e);this.lastTime=performance.now();this.paintFrame(this.lastTime);});
    canvas.addEventListener('pointermove',e=>{this.updatePointer(e);this.reverse=e.buttons===2||e.shiftKey;if(!this.down)this.draw();});
    const stop=()=>{if(!this.down)return;this.down=false;this.onChange();this.draw();};canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);canvas.addEventListener('lostpointercapture',stop);canvas.addEventListener('pointerleave',()=>{if(!this.down){this.pointer=null;this.draw();}});this.draw();
  }
  setField(field:TerrainField){this.field=field;this.history=[];this.radius=Math.max(24,field.size*.05);this.draw();}
  setActive(active:boolean){this.active=active;this.canvas.style.pointerEvents=active?'auto':'none';this.canvas.classList.toggle('painting',active);if(!active){this.down=false;this.pointer=null;}this.draw();}
  private updatePointer(e:PointerEvent){const r=this.canvas.getBoundingClientRect();this.pointer=this.unproject((e.clientX-r.left)/r.width*800,(e.clientY-r.top)/r.height*600);}
  private paintFrame(now:number){if(!this.down||!this.pointer)return;const dt=Math.min(.05,Math.max(.008,(now-this.lastTime)/1000));this.lastTime=now;const mode=this.reverse?(this.mode==='raise'?'lower':this.mode==='lower'?'raise':this.mode):this.mode;const revision=this.field.revision;this.field.paint(this.pointer,this.radius,this.strength,dt,mode);if(this.field.revision!==revision){this.draw();this.onChange();}requestAnimationFrame(t=>this.paintFrame(t));}
  undo(){const h=this.history.pop();if(!h)return;this.field.heights.set(h);this.field.revision++;this.draw();this.onChange();}
  clear(){this.history.push(this.field.heights.slice());this.field.clear();this.draw();this.onChange();}
  draw(){
    const c=this.ctx;c.clearRect(0,0,800,600);if(!this.visible&&!this.active)return;
    const f=this.field,n=f.resolution;this.map.width=n;this.map.height=n;const m=this.map.getContext('2d')!,img=m.createImageData(n,n);
    const water=f.seaLevel;
    for(let i=0;i<f.heights.length;i++){const h=f.heights[i],wet=water!==null&&h<water,a=wet?.35+Math.min(.4,(water-h)/12):Math.min(.9,Math.abs(h)/15*1.2);img.data[i*4]=wet?48:h>=0?235:76;img.data[i*4+1]=wet?153:h>=0?164:175;img.data[i*4+2]=wet?185:h>=0?78:225;img.data[i*4+3]=Math.round(a*255);}
    m.putImageData(img,0,0);const a=this.project({x:f.originX,z:f.originZ}),b=this.project({x:f.originX+f.size,z:f.originZ+f.size});c.imageSmoothingEnabled=true;c.drawImage(this.map,a.x,a.y,b.x-a.x,b.y-a.y);
    if(this.pointer&&this.active){const p=this.project(this.pointer),edge=this.project({x:this.pointer.x+this.radius,z:this.pointer.z}),r=Math.abs(edge.x-p.x),g=c.createRadialGradient(p.x,p.y,0,p.x,p.y,r);g.addColorStop(0,'#e7c78630');g.addColorStop(1,'#e7c78600');c.fillStyle=g;c.beginPath();c.arc(p.x,p.y,r,0,Math.PI*2);c.fill();c.strokeStyle='#f1dfaa';c.lineWidth=1.7;c.setLineDash([6,5]);c.stroke();c.setLineDash([]);c.beginPath();c.arc(p.x,p.y,3,0,Math.PI*2);c.fillStyle='#fff2c7';c.fill();}
  }
}
