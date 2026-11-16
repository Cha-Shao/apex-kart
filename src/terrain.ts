import type { Point } from './track';

export interface TerrainData { resolution:number; originX:number; originZ:number; size:number; heights:number[];datumM?:number;waterLevel?:number|null;waterEnabled?:boolean }
export type BrushMode='raise'|'lower'|'smooth'|'flatten';
/** Radius in metres on a 500 m field; scale with the terrain size. */
export const BRUSH_RADIUS_RANGE={min:12,max:70,initial:24};
interface PaintBounds {minX:number;maxX:number;minZ:number;maxZ:number}
function brushFalloff(distance:number,hardness:number){
  if(distance>=1)return 0;
  if(distance<=hardness)return 1;
  // Hardness sets the solid core. Zero keeps the original soft brush profile.
  const featherDistance=(distance-hardness)/(1-hardness);
  return (1-featherDistance*featherDistance)**3;
}
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
  paint(p:Point,radius:number,strength:number,dt:number,mode:BrushMode,hardness=0){
    const n=this.resolution,step=this.cellSize,old=mode==='smooth'?this.heights.slice():this.heights;
    hardness=Math.max(0,Math.min(1,hardness));
    let changed:PaintBounds|undefined;
    const ix=Math.round((p.x-this.originX)/step),iz=Math.round((p.z-this.originZ)/step),r=Math.ceil(radius/step);
    for(let z=Math.max(1,iz-r);z<=Math.min(n-2,iz+r);z++)for(let x=Math.max(1,ix-r);x<=Math.min(n-2,ix+r);x++){
      const dist=Math.hypot(this.originX+x*step-p.x,this.originZ+z*step-p.z)/radius;if(dist>=1)continue;
      const feather=brushFalloff(dist,hardness),index=z*n+x,h=this.heights[index];
      let next=h;
      if(mode==='raise'||mode==='lower')next=h+(mode==='raise'?1:-1)*strength*dt*feather;
      else{const target=mode==='flatten'?0:(old[index-1]+old[index+1]+old[index-n]+old[index+n]+old[index]*4)/8;next=h+(target-h)*Math.min(1,strength*dt*.75)*feather;}
      const value=Math.fround(Math.max(-1000,Math.min(1000,next)));
      if(value!==h){
        this.heights[index]=value;
        if(!changed)changed={minX:x,maxX:x,minZ:z,maxZ:z};
        else{changed.minX=Math.min(changed.minX,x);changed.maxX=Math.max(changed.maxX,x);changed.minZ=Math.min(changed.minZ,z);changed.maxZ=Math.max(changed.maxZ,z);}
      }
    }
    if(changed)this.revision++;
    return changed;
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
  radius=BRUSH_RADIUS_RANGE.initial;
  strength=4;
  hardness=0;
  active=false;
  visible=true;
  onChange:()=>void=()=>{};
  onStrokeStart:()=>void=()=>{};
  onStrokeEnd:()=>void=()=>{};
  onBrushChange:()=>void=()=>{};
  history:Float32Array[]=[];
  private pointer:Point|null=null;
  private down=false;
  private strokePointer:number|null=null;
  private strokeRevision=0;
  private brushDrag:{pointerId:number;x:number;y:number;radius:number;hardness:number}|null=null;
  private frame:number|undefined;
  private reverse=false;
  private lastTime=0;
  private ctx:CanvasRenderingContext2D;
  private map=document.createElement('canvas');
  private mapField:TerrainField|null=null;
  private mapRevision=-1;
  private mapImage:ImageData|undefined;
  constructor(public canvas:HTMLCanvasElement,field:TerrainField,private project:(p:Point)=>{x:number;y:number},private unproject:(x:number,y:number)=>Point){
    this.field=field;canvas.width=800;canvas.height=600;this.ctx=canvas.getContext('2d')!;
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    canvas.addEventListener('pointerdown',e=>{
      if(!this.active||this.down||this.brushDrag||(e.button!==0&&e.button!==2))return;
      e.preventDefault();canvas.setPointerCapture(e.pointerId);this.updatePointer(e);
      if(e.button===2){this.brushDrag={pointerId:e.pointerId,x:e.clientX,y:e.clientY,radius:this.radius*500/this.field.size,hardness:this.hardness};this.draw();return;}
      this.history.push(this.field.heights.slice());this.down=true;this.strokePointer=e.pointerId;this.strokeRevision=this.field.revision;this.reverse=e.shiftKey;this.onStrokeStart();this.lastTime=performance.now();this.paintFrame(this.lastTime);
    });
    canvas.addEventListener('pointermove',e=>{
      const drag=this.brushDrag;
      if(drag){
        if(e.pointerId!==drag.pointerId)return;
        if((e.buttons&2)===0){this.stopBrushDrag();this.updatePointer(e);this.draw();return;}
        e.preventDefault();
        // Keep the preview at the right-click anchor while changing its shape.
        this.radius=Math.max(BRUSH_RADIUS_RANGE.min,Math.min(BRUSH_RADIUS_RANGE.max,Math.round(drag.radius+(e.clientX-drag.x)/4)))*this.field.size/500;
        this.hardness=Math.max(0,Math.min(1,Math.round((drag.hardness-(e.clientY-drag.y)/200)*100)/100));
        this.onBrushChange();this.draw();return;
      }
      if(this.down){if(e.pointerId!==this.strokePointer)return;if((e.buttons&1)===0||(e.buttons&2)!==0)this.finishStroke();}
      this.updatePointer(e);this.reverse=e.shiftKey;if(!this.down)this.draw();
    });
    const stop=(e:PointerEvent)=>{if(e.pointerId===this.strokePointer||e.pointerId===this.brushDrag?.pointerId)this.finishStroke();};canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);canvas.addEventListener('lostpointercapture',stop);canvas.addEventListener('pointerleave',()=>{if(!this.down&&!this.brushDrag){this.pointer=null;this.draw();}});window.addEventListener('blur',()=>this.finishStroke());this.draw();
  }
  get painting(){return this.down;}
  private stopStroke(notify=true){
    if(!this.down)return;
    this.down=false;
    if(this.frame!==undefined){cancelAnimationFrame(this.frame);this.frame=undefined;}
    const pointer=this.strokePointer;this.strokePointer=null;
    if(pointer!==null&&this.canvas.hasPointerCapture(pointer))this.canvas.releasePointerCapture(pointer);
    const changed=this.field.revision!==this.strokeRevision;
    if(!changed)this.history.pop();
    else if(this.history.length>12)this.history.shift();
    // Commit one complete stroke; animation frames only update the 2D preview.
    if(notify){this.draw();if(changed)this.onChange();this.onStrokeEnd();}
  }
  private stopBrushDrag(){
    const drag=this.brushDrag;if(!drag)return;
    this.brushDrag=null;
    if(this.canvas.hasPointerCapture(drag.pointerId))this.canvas.releasePointerCapture(drag.pointerId);
    this.draw();
  }
  finishStroke(){this.stopStroke();this.stopBrushDrag();}
  setField(field:TerrainField){this.stopStroke(false);this.stopBrushDrag();this.field=field;this.history=[];this.radius=Math.max(24,field.size*.05);this.draw();}
  setActive(active:boolean){if(!active)this.finishStroke();this.active=active;this.canvas.style.pointerEvents=active?'auto':'none';this.canvas.classList.toggle('painting',active);if(!active)this.pointer=null;this.draw();}
  private updatePointer(e:PointerEvent){const r=this.canvas.getBoundingClientRect();this.pointer=this.unproject((e.clientX-r.left)/r.width*800,(e.clientY-r.top)/r.height*600);}
  private paintFrame(now:number){if(!this.down||!this.pointer)return;const dt=Math.min(.05,Math.max(.008,(now-this.lastTime)/1000));this.lastTime=now;const mode=this.reverse?(this.mode==='raise'?'lower':this.mode==='lower'?'raise':this.mode):this.mode;const changed=this.field.paint(this.pointer,this.radius,this.strength,dt,mode,this.hardness);this.draw(changed);this.frame=requestAnimationFrame(t=>{this.frame=undefined;this.paintFrame(t);});}
  undo(){this.finishStroke();const h=this.history.pop();if(!h)return;this.field.heights.set(h);this.field.revision++;this.draw();this.onChange();}
  clear(){this.finishStroke();this.history.push(this.field.heights.slice());this.field.clear();this.draw();this.onChange();}
  draw(changed?:PaintBounds){
    const c=this.ctx;c.clearRect(0,0,800,600);if(!this.visible&&!this.active)return;
    const f=this.field,n=f.resolution;
    if(this.mapField!==f||this.mapRevision!==f.revision){
      if(this.map.width!==n||this.map.height!==n){this.map.width=n;this.map.height=n;this.mapImage=undefined;}
      const m=this.map.getContext('2d')!,img=this.mapImage??=m.createImageData(n,n),water=f.seaLevel;
      // Brush frames only recolour their changed pixels. Hover and view changes
      // reuse the image; water changes, undo and replacement refresh it all.
      const bounds=this.mapField===f&&this.mapRevision===f.revision-1&&changed?changed:{minX:0,maxX:n-1,minZ:0,maxZ:n-1};
      for(let z=bounds.minZ;z<=bounds.maxZ;z++)for(let x=bounds.minX;x<=bounds.maxX;x++){
        const i=z*n+x,h=f.heights[i],wet=water!==null&&h<water,a=wet?.35+Math.min(.4,(water-h)/12):Math.min(.9,Math.abs(h)/15*1.2);img.data[i*4]=wet?48:h>=0?235:76;img.data[i*4+1]=wet?153:h>=0?164:175;img.data[i*4+2]=wet?185:h>=0?78:225;img.data[i*4+3]=Math.round(a*255);
      }
      m.putImageData(img,0,0,bounds.minX,bounds.minZ,bounds.maxX-bounds.minX+1,bounds.maxZ-bounds.minZ+1);this.mapField=f;this.mapRevision=f.revision;
    }
    const a=this.project({x:f.originX,z:f.originZ}),b=this.project({x:f.originX+f.size,z:f.originZ+f.size});c.imageSmoothingEnabled=true;c.drawImage(this.map,a.x,a.y,b.x-a.x,b.y-a.y);
    if(this.pointer&&this.active){
      const p=this.project(this.pointer),edge=this.project({x:this.pointer.x+this.radius,z:this.pointer.z}),r=Math.abs(edge.x-p.x);
      if(this.hardness<1){
        const g=c.createRadialGradient(p.x,p.y,r*this.hardness,p.x,p.y,r);
        for(let i=0;i<=8;i++)g.addColorStop(i/8,`rgba(231,199,134,${brushFalloff(i/8,0)*.2})`);
        c.fillStyle=g;
      }else c.fillStyle='#e7c78633';
      c.beginPath();c.arc(p.x,p.y,r,0,Math.PI*2);c.fill();c.strokeStyle='#f1dfaa';c.lineWidth=1.7;c.setLineDash([6,5]);c.stroke();c.setLineDash([]);
      if(this.hardness>0&&this.hardness<1){c.beginPath();c.arc(p.x,p.y,r*this.hardness,0,Math.PI*2);c.lineWidth=1;c.strokeStyle='#f1dfaa99';c.stroke();}
      c.beginPath();c.arc(p.x,p.y,3,0,Math.PI*2);c.fillStyle='#fff2c7';c.fill();
    }
  }
}
