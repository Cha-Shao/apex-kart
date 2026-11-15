import type {Point} from './track';

export interface FootprintPolygon {points:Point[];index:number;minX:number;maxX:number;minZ:number;maxZ:number}
export const cross2=(a:Point,b:Point,p:Point)=>(b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x);
export function footprintPolygon(points:Point[],index:number):FootprintPolygon{
  return {points,index,minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minZ:Math.min(...points.map(p=>p.z)),maxZ:Math.max(...points.map(p=>p.z))};
}
export function polygonContains(points:Point[],p:Point){
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j];
    if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)inside=!inside;
  }
  return inside;
}
export function polygonDistance(points:Point[],p:Point){
  let best=Infinity;
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1)));
    best=Math.min(best,(p.x-a.x-dx*t)**2+(p.z-a.z-dz*t)**2);
  }
  return Math.sqrt(best)*(polygonContains(points,p)?-1:1);
}

/** A sparse broad phase shared by runoff clipping and the padded perimeter. */
export class FootprintIndex {
  private cells=new Map<string,FootprintPolygon[]>();
  constructor(polygons:FootprintPolygon[],private cell=24){
    for(const polygon of polygons)for(let z=Math.floor(polygon.minZ/cell);z<=Math.floor(polygon.maxZ/cell);z++)for(let x=Math.floor(polygon.minX/cell);x<=Math.floor(polygon.maxX/cell);x++){
      const key=`${x},${z}`,list=this.cells.get(key)??[];list.push(polygon);this.cells.set(key,list);
    }
  }
  query(minX:number,maxX:number,minZ:number,maxZ:number){
    const found=new Set<FootprintPolygon>();
    for(let z=Math.floor(minZ/this.cell);z<=Math.floor(maxZ/this.cell);z++)for(let x=Math.floor(minX/this.cell);x<=Math.floor(maxX/this.cell);x++){
      for(const p of this.cells.get(`${x},${z}`)??[])if(p.maxX>=minX&&p.minX<=maxX&&p.maxZ>=minZ&&p.minZ<=maxZ)found.add(p);
    }
    return found;
  }
}

export function clipHalfPlane(points:Point[],a:Point,b:Point,sign:number){
  const result:Point[]=[];
  for(let i=0;i<points.length;i++){
    const p=points[i],q=points[(i+1)%points.length],dp=cross2(a,b,p)*sign,dq=cross2(a,b,q)*sign;
    if(dp>=-1e-8)result.push(p);
    if((dp>=0)!==(dq>=0)){const t=dp/(dp-dq);result.push({x:p.x+(q.x-p.x)*t,z:p.z+(q.z-p.z)*t});}
  }
  return result;
}

export interface FootprintContour {points:Point[];length:number;area:number}
/** March the union's signed distance, rather than offsetting each road side.
 * Overlapping runoffs merge; rails cannot run through a neighbouring road.
 * The sparse scanline raster only visits the paved footprint and its margin. */
export function paddedFootprint(polygons:FootprintPolygon[],padding:number,cell=1.5){
  const values=new Map<string,number>(),reach=padding+cell*2,key=(x:number,z:number)=>`${x},${z}`;
  for(const polygon of polygons){
    const points=polygon.points;
    for(let iz=Math.floor((polygon.minZ-reach)/cell);iz<=Math.ceil((polygon.maxZ+reach)/cell);iz++){
      const z=iz*cell,low=z-reach,high=z+reach;let minX=Infinity,maxX=-Infinity;
      for(let i=0;i<points.length;i++){
        const a=points[i],b=points[(i+1)%points.length];
        if(a.z>=low&&a.z<=high){minX=Math.min(minX,a.x);maxX=Math.max(maxX,a.x);}
        if(Math.abs(b.z-a.z)<1e-9)continue;
        for(const cut of [low,high]){const t=(cut-a.z)/(b.z-a.z);if(t>=0&&t<=1){const x=a.x+(b.x-a.x)*t;minX=Math.min(minX,x);maxX=Math.max(maxX,x);}}
      }
      if(!Number.isFinite(minX))continue;
      for(let ix=Math.floor((minX-reach)/cell);ix<=Math.ceil((maxX+reach)/cell);ix++){
        const d=polygonDistance(points,{x:ix*cell,z})-padding;if(d>cell*2)continue;
        const k=key(ix,iz);if(d<(values.get(k)??Infinity))values.set(k,Math.abs(d)<1e-7?-1e-7:d);
      }
    }
  }
  const value=(x:number,z:number)=>values.get(key(x,z))??cell*2;
  const sample=(p:Point)=>{
    const x=Math.floor(p.x/cell),z=Math.floor(p.z/cell),u=p.x/cell-x,v=p.z/cell-z;
    return (value(x,z)*(1-u)+value(x+1,z)*u)*(1-v)+(value(x,z+1)*(1-u)+value(x+1,z+1)*u)*v;
  };
  const squares=new Set<string>();
  for(const [k,d] of values)if(d<0){const [x,z]=k.split(',').map(Number);for(const dx of [-1,0])for(const dz of [-1,0])squares.add(key(x+dx,z+dz));}
  const vertices=new Map<string,Point>(),links=new Map<string,string[]>();
  const connect=(a:string,b:string)=>{const la=links.get(a)??[],lb=links.get(b)??[];la.push(b);lb.push(a);links.set(a,la);links.set(b,lb);};
  for(const square of squares){
    const [x,z]=square.split(',').map(Number),corners=[[x,z],[x+1,z],[x+1,z+1],[x,z+1]],d=corners.map(([x,z])=>value(x,z)),edges:(string|null)[]=[];
    for(let i=0;i<4;i++){
      const j=(i+1)%4;if((d[i]<0)===(d[j]<0)){edges.push(null);continue;}
      const [ax,az]=corners[i],[bx,bz]=corners[j],id=az===bz?`h${Math.min(ax,bx)},${az}`:`v${ax},${Math.min(az,bz)}`,t=d[i]/(d[i]-d[j]);
      vertices.set(id,{x:(ax+(bx-ax)*t)*cell,z:(az+(bz-az)*t)*cell});edges.push(id);
    }
    const cuts=edges.filter((e):e is string=>e!==null);
    if(cuts.length===2)connect(cuts[0],cuts[1]);
    else if(cuts.length===4){
      // Resolve a saddle from its centre sign, keeping narrow islands stable.
      const centreInside=d.reduce((a,b)=>a+b,0)<0;
      for(let i=0;i<4;i++)if((d[i]<0)!==centreInside)connect(edges[(i+3)%4]!,edges[i]!);
    }
  }
  const contours:FootprintContour[]=[],visited=new Set<string>();
  for(const start of links.keys()){
    if(visited.has(start))continue;const points:Point[]=[];let current=start,previous='';
    while(!visited.has(current)){
      visited.add(current);points.push(vertices.get(current)!);const next=(links.get(current)??[]).find(p=>p!==previous);if(!next)break;previous=current;current=next;
    }
    if(current!==start||points.length<8)continue;
    // Orient every ring with pavement on its left, including grass islands.
    const a=points[0],b=points[1],dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz)||1,mid={x:(a.x+b.x)/2,z:(a.z+b.z)/2};
    if(sample({x:mid.x-dz/l*.4,z:mid.z+dx/l*.4})>sample({x:mid.x+dz/l*.4,z:mid.z-dx/l*.4}))points.reverse();
    let length=0,area=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];length+=Math.hypot(b.x-a.x,b.z-a.z);area+=a.x*b.z-b.x*a.z;}
    if(length>24)contours.push({points,length,area:area*.5});
  }
  return {contours,sample};
}
