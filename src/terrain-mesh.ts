import type {Point} from './track';
import type {TerrainField} from './terrain';
export type TerrainGrid=Pick<TerrainField,'originX'|'originZ'|'cellSize'|'resolution'>;
const cross=(a:Point,b:Point,p:Point)=>(b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x);
/** Clip into the heightfield's actual triangles, not just a denser approximation.
 * Every resulting face lies in one terrain plane, so hills cannot pierce it.
 */
export function drapeTriangles(triangles:Point[][],surface:(x:number,z:number)=>number,grid:TerrainGrid){
  const vertices:number[]=[],indices:number[]=[],cell=grid.cellSize;
  const emit=(polygon:Point[])=>{
    if(polygon.length<3)return;const base=vertices.length/3;
    polygon.forEach(p=>vertices.push(p.x,surface(p.x,p.z),p.z));
    for(let i=1;i<polygon.length-1;i++){
      const area=cross(polygon[0],polygon[i],polygon[i+1]);if(Math.abs(area)<1e-9)continue;
      if(area<0)indices.push(base,base+i,base+i+1);else indices.push(base,base+i+1,base+i);
    }
  };
  const clip=(input:Point[],triangle:Point[])=>{
    let polygon=input;const sign=Math.sign(cross(triangle[0],triangle[1],triangle[2]));
    for(let k=0;k<3&&polygon.length;k++){
      const a=triangle[k],b=triangle[(k+1)%3],next:Point[]=[];
      for(let j=0;j<polygon.length;j++){
        const p=polygon[j],q=polygon[(j+1)%polygon.length],dp=cross(a,b,p)*sign,dq=cross(a,b,q)*sign;
        if(dp>=-1e-8)next.push(p);
        if((dp>=0)!==(dq>=0)){const t=dp/(dp-dq);next.push({x:p.x+(q.x-p.x)*t,z:p.z+(q.z-p.z)*t});}
      }
      polygon=next;
    }
    return polygon;
  };
  for(const triangle of triangles){
    const x0=Math.max(0,Math.floor((Math.min(...triangle.map(p=>p.x))-grid.originX)/cell)),x1=Math.min(grid.resolution-2,Math.floor((Math.max(...triangle.map(p=>p.x))-grid.originX)/cell));
    const z0=Math.max(0,Math.floor((Math.min(...triangle.map(p=>p.z))-grid.originZ)/cell)),z1=Math.min(grid.resolution-2,Math.floor((Math.max(...triangle.map(p=>p.z))-grid.originZ)/cell));
    for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
      const a={x:grid.originX+x*cell,z:grid.originZ+z*cell},b={x:a.x+cell,z:a.z},c={x:a.x,z:a.z+cell},d={x:b.x,z:c.z};
      emit(clip(triangle,[a,c,d]));emit(clip(triangle,[a,d,b]));
    }
  }
  return {vertices,indices};
}
