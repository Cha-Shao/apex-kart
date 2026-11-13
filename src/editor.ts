import { buildTrack, distance, prepareStroke, type BuildOptions, type Point, type TrackData, type TrackSettings } from './track';
export type EditorTool='draw'|'edit';
const COLORS={straight:'#a4cac4',curve:'#70c7a6',hairpin:'#d0ec73'};
export class TrackEditor {
  points:Point[]=[];
  track:TrackData|null=null;
  tool:EditorTool='edit';
  history:Point[][]=[];
  options:BuildOptions={};
  view={cx:0,cz:0,scale:1.8};
  hasReference=false;
  settings:TrackSettings;
  onChange:(points:Point[],track:TrackData|null,error?:string)=>void=()=>{};
  private ctx:CanvasRenderingContext2D;
  private raw:Point[]=[];
  private dragging=-1;
  private down=false;
  private width=800;
  private height=600;
  constructor(public canvas:HTMLCanvasElement,settings:TrackSettings){
    this.settings={...settings};this.ctx=canvas.getContext('2d')!;
    canvas.width=800;canvas.height=600;
    canvas.addEventListener('pointerdown',e=>this.pointerDown(e));canvas.addEventListener('pointermove',e=>this.pointerMove(e));canvas.addEventListener('pointerup',e=>this.pointerUp(e));canvas.addEventListener('pointercancel',e=>this.pointerUp(e));
    canvas.addEventListener('contextmenu',e=>{e.preventDefault();if(this.tool!=='edit')return;const p=this.toWorld(e as PointerEvent);let nearest=Infinity,index=-1;this.points.forEach((q,i)=>{const d=distance(q,p)*this.view.scale;if(d<nearest){nearest=d;index=i;}});if(nearest<=15)this.deletePoint(index);});this.draw();
  }
  project(p:Point){return {x:400+(p.x-this.view.cx)*this.view.scale,y:300+(p.z-this.view.cz)*this.view.scale};}
  unproject(x:number,y:number):Point{return {x:this.view.cx+(x-400)/this.view.scale,z:this.view.cz+(y-300)/this.view.scale};}
  private toCanvas(p:Point){return this.project(p);}
  private toWorld(e:PointerEvent):Point{const r=this.canvas.getBoundingClientRect();return this.unproject(Math.max(20,Math.min(780,(e.clientX-r.left)/r.width*800)),Math.max(20,Math.min(580,(e.clientY-r.top)/r.height*600)));}
  fit(points:Point[]){if(!points.length){this.view={cx:0,cz:0,scale:1.8};return;}const xs=points.map(p=>p.x),zs=points.map(p=>p.z),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);this.view={cx:(minX+maxX)/2,cz:(minZ+maxZ)/2,scale:Math.min(1.8,700/(maxX-minX+20),500/(maxZ-minZ+20))};}
  deletePoint(index:number){if(index<0||index>=this.points.length)return false;if(this.points.length<=5){this.onChange(this.points,this.track,'至少保留 5 个控制点。');return false;}this.remember();this.points.splice(index,1);this.rebuild();return true;}
  setTool(tool:EditorTool){this.tool=tool;this.canvas.style.cursor=tool==='draw'?'crosshair':'grab';this.draw();}
  setPoints(points:Point[],remember=true){if(remember)this.remember();this.points=points.map(p=>({...p}));this.fit(points);this.rebuild();}
  private remember(){this.history.push(this.points.map(p=>({...p})));if(this.history.length>30)this.history.shift();}
  undo(){const last=this.history.pop();if(last){this.points=last;this.rebuild();}}
  clear(){this.remember();this.points=[];this.track=null;this.options={};this.fit([]);this.setTool('draw');this.draw();this.onChange([],null);}
  updateSettings(settings:TrackSettings){this.settings={...settings};this.rebuild();}
  rebuild(){
    let error:string|undefined;
    try{this.track=this.points.length?buildTrack(this.points,this.settings,this.options):null;}catch(e){this.track=null;error=(e as Error).message;}
    this.draw();this.onChange(this.points,this.track,error);
  }
  private pointerDown(e:PointerEvent){
    if(e.button!==0)return;e.preventDefault();this.canvas.setPointerCapture(e.pointerId);const p=this.toWorld(e);
    if(this.tool==='draw'){this.options={};this.remember();this.raw=[p];this.down=true;}
    else{let nearest=Infinity,index=-1;this.points.forEach((q,i)=>{const d=distance(q,p)*this.view.scale;if(d<nearest){nearest=d;index=i;}});if(nearest<15){this.remember();this.dragging=index;this.down=true;this.canvas.style.cursor='grabbing';}}
    this.draw();
  }
  private pointerMove(e:PointerEvent){
    if(!this.down)return;const p=this.toWorld(e);
    if(this.tool==='draw'){if(distance(p,this.raw.at(-1)!)>1)this.raw.push(p);this.draw();}
    else if(this.dragging>=0){this.points[this.dragging]=p;try{this.track=buildTrack(this.points,this.settings,this.options);}catch{this.track=null;}this.draw();}
  }
  private pointerUp(e:PointerEvent){
    if(!this.down)return;this.down=false;
    if(this.tool==='draw'){try{this.points=prepareStroke(this.raw);}catch{this.points=this.raw;}this.raw=[];}
    this.dragging=-1;this.canvas.style.cursor=this.tool==='draw'?'crosshair':'grab';
    if(this.canvas.hasPointerCapture(e.pointerId))this.canvas.releasePointerCapture(e.pointerId);
    this.rebuild();
  }
  draw(){
    const c=this.ctx;c.clearRect(0,0,this.width,this.height);if(!this.hasReference){c.fillStyle='#172526';c.fillRect(0,0,800,600);}
    c.fillStyle='#344443';for(let x=20;x<800;x+=30)for(let y=0;y<600;y+=30){c.beginPath();c.arc(x,y,1.35,0,Math.PI*2);c.fill();}
    c.strokeStyle='#394b44';c.lineWidth=1;c.setLineDash([5,8]);c.strokeRect(25,25,750,550);c.setLineDash([]);
    if(this.track&&!this.down||this.track&&this.tool==='edit'){
      const samples=this.track.samples;const path=()=>{c.beginPath();samples.forEach((s,i)=>{const p=this.toCanvas(s);i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y);});c.closePath();};
      c.lineJoin='round';c.lineCap='round';path();c.strokeStyle='#41524c';c.lineWidth=Math.max(7,(this.settings.width+5)*this.view.scale);c.stroke();path();c.strokeStyle='#223432';c.lineWidth=Math.max(4,this.settings.width*this.view.scale);c.stroke();
      for(let i=0;i<samples.length;i++){const a=this.toCanvas(samples[i]),b=this.toCanvas(samples[(i+1)%samples.length]);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.strokeStyle=COLORS[samples[i].kind];c.lineWidth=3.2;c.stroke();}
      if(this.tool==='edit')for(let i=0;i<this.points.length;i++){const p=this.toCanvas(this.points[i]);c.beginPath();c.arc(p.x,p.y,i===this.dragging?7:4.8,0,Math.PI*2);c.fillStyle=i===this.dragging?'#d0ec73':'#172526';c.fill();c.strokeStyle='#c2d5c1';c.lineWidth=1.6;c.stroke();}
      const start=this.toCanvas(samples[0]);c.fillStyle='#d1ed79';c.beginPath();c.arc(start.x,start.y,8,0,Math.PI*2);c.fill();c.strokeStyle='#152727';c.lineWidth=2;c.beginPath();c.moveTo(start.x-3,start.y-4);c.lineTo(start.x+4,start.y);c.lineTo(start.x-3,start.y+4);c.stroke();
      c.fillStyle='#a9b9ad';c.font='15px monospace';c.textAlign='right';c.fillText(`${Math.round(90/this.view.scale)} m`,756,554);c.strokeStyle='#82978a';c.beginPath();c.moveTo(666,565);c.lineTo(756,565);c.stroke();
    }else if(!this.raw.length&&!this.points.length){
      c.textAlign='center';c.fillStyle='#ccdacd';c.font='500 26px sans-serif';c.fillText('在这里画出你的赛道',400,282);c.fillStyle='#7e958b';c.font='20px sans-serif';c.fillText('一笔画个环，松手后自动平滑闭合',400,322);
    }
    const raw=this.raw.length?this.raw:!this.track?this.points:[];
    if(raw.length){c.strokeStyle='#d0ec73';c.lineWidth=4;c.lineCap='round';c.lineJoin='round';c.beginPath();raw.forEach((s,i)=>{const p=this.toCanvas(s);i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y);});c.stroke();if(raw.length>3){const a=this.toCanvas(raw[0]),b=this.toCanvas(raw.at(-1)!);c.setLineDash([8,8]);c.strokeStyle='#6a8c5b';c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();c.setLineDash([]);}}
  }
}
