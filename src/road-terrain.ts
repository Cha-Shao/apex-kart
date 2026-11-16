import * as THREE from 'three';
import {TerrainField} from './terrain';
import {curbWidth,type Point} from './track';

const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const smoothstep=(value:number)=>{const t=clamp(value,0,1);return t*t*(3-2*t);};

/** A positive, periodic filter: the start line receives exactly the same
 * treatment as every other point, and filtering cannot create new overshoots. */
function smoothProfile(values:number[],step:number,reach:number){
  const n=values.length,radius=Math.min(Math.floor((n-1)/2),Math.ceil(reach/step));
  const weights=Array.from({length:radius*2+1},(_,i)=>Math.max(0,1-((i-radius)*step/reach)**2)**3);
  const total=weights.reduce((sum,w)=>sum+w,0);
  return values.map((_,i)=>{
    let sum=0;
    for(let k=-radius;k<=radius;k++)sum+=values[(i+k+n)%n]*weights[k+radius];
    return sum/total;
  });
}

/** Upper/lower Lipschitz envelopes remove local excessive grades without
 * letting one bad DEM pixel compress the elevation of the entire circuit. */
function limitProfileGrades(values:number[],rise:number){
  const n=values.length,lower=Array.from({length:n*3},(_,i)=>values[i%n]),upper=lower.slice();
  for(let i=1;i<lower.length;i++){
    lower[i]=Math.min(lower[i],lower[i-1]+rise);
    upper[i]=Math.max(upper[i],upper[i-1]-rise);
  }
  for(let i=lower.length-2;i>=0;i--){
    lower[i]=Math.min(lower[i],lower[i+1]+rise);
    upper[i]=Math.max(upper[i],upper[i+1]-rise);
  }
  const result=values.map((_,i)=>(lower[i+n]+upper[i+n])*.5);
  const shift=(values.reduce((sum,h)=>sum+h,0)-result.reduce((sum,h)=>sum+h,0))/n;
  return result.map(h=>h+shift);
}

function profileCurvature(values:number[],step:number){
  let curvature=0;const n=values.length;
  for(let i=0;i<n;i++)curvature=Math.max(curvature,Math.abs(values[(i+n-1)%n]-2*values[i]+values[(i+1)%n])/(step*step));
  return curvature;
}

/** Fit a driveable road corridor into the shared render/collision heightfield.
 * The surrounding DEM remains scenery, not a surveyed road surface. This runs
 * only when generating a preset, so subsequent height-brush edits stay intact. */
export function roadTerrain(source:TerrainField,points:Point[],width:number,compact:boolean){
  const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(p.x,0,p.z)),true,'centripetal');
  curve.arcLengthDivisions=Math.max(4096,points.length*4);
  const length=curve.getLength(),count=Math.min(8192,Math.max(256,Math.ceil(length/Math.max(1.5,source.cellSize*.35))));
  const samples=curve.getSpacedPoints(count).slice(0,-1),step=length/count;
  const raw=samples.map(p=>source.sample(p.x,p.z));
  const medianRadius=Math.max(1,Math.ceil(source.cellSize/step));
  let profile=raw.map((_,i)=>{
    const window=Array.from({length:medianRadius*2+1},(_,k)=>raw[(i+k-medianRadius+count)%count]).sort((a,b)=>a-b);
    return window[medianRadius];
  });
  // Filter in world metres, including the DEM's real footprint. Compact roads
  // also need transitions long enough for a full-size kart, not a scaled car.
  const reach=Math.max(width*2,compact?18:45,source.cellSize*3);
  profile=smoothProfile(smoothProfile(profile,step,reach),step,reach);
  profile=limitProfileGrades(profile,(compact ? .075 : .12)*step);
  const transition=Math.max(width*1.5,compact?12:30,source.cellSize*1.5),curvatureLimit=compact ? .002 : .00065;
  profile=smoothProfile(profile,step,transition);
  // Bound how quickly a slope changes as well as the slope itself. A modest
  // grade can still launch a car if it ends at a short, sharp crest.
  for(let pass=0;pass<6&&profileCurvature(profile,step)>curvatureLimit;pass++)profile=smoothProfile(profile,step,transition);
  const curvature=profileCurvature(profile,step);
  if(curvature>curvatureLimit){
    const mean=profile.reduce((sum,h)=>sum+h,0)/count,factor=curvatureLimit/curvature;
    profile=profile.map(h=>mean+(h-mean)*factor);
  }

  // Bake once at the resolution already consumed by both Three and Cannon.
  // Rasterising only segment bounds avoids a grid × whole-lap nearest search.
  const field=source.refined().clone(),n=field.resolution,cell=field.cellSize;
  const kerbWidth=curbWidth(width),core=width*.5+kerbWidth+Math.max(compact?6:10,cell*Math.SQRT2);
  const feather=Math.max(width*2,compact?16:32,cell*3),reachXZ=core+feather;
  const reach2=reachXZ*reachXZ,weightRadius2=(width*.5+kerbWidth)**2;
  const targets=new Float64Array(n*n),weights=new Float64Array(n*n),nearest=new Float64Array(n*n).fill(Infinity);
  for(let i=0;i<count;i++){
    const j=(i+1)%count,a=samples[i],b=samples[j],dx=b.x-a.x,dz=b.z-a.z,span2=dx*dx+dz*dz;
    if(span2<1e-10)continue;
    const span=Math.sqrt(span2),h0=profile[i],dh=profile[j]-h0;
    const x0=Math.max(0,Math.ceil((Math.min(a.x,b.x)-reachXZ-field.originX)/cell)),x1=Math.min(n-1,Math.floor((Math.max(a.x,b.x)+reachXZ-field.originX)/cell));
    const z0=Math.max(0,Math.ceil((Math.min(a.z,b.z)-reachXZ-field.originZ)/cell)),z1=Math.min(n-1,Math.floor((Math.max(a.z,b.z)+reachXZ-field.originZ)/cell));
    for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
      const px=field.originX+x*cell-a.x,pz=field.originZ+z*cell-a.z,t=clamp((px*dx+pz*dz)/span2,0,1);
      const distance2=(px-dx*t)**2+(pz-dz*t)**2;
      if(distance2>=reach2)continue;
      const index=z*n+x,w=(1-distance2/reach2)**3/(1+distance2/weightRadius2)*span;
      targets[index]+=(h0+dh*t)*w;weights[index]+=w;nearest[index]=Math.min(nearest[index],distance2);
    }
  }
  for(let i=0;i<field.heights.length;i++){
    if(!weights[i])continue;
    // Nearby legs share one smooth ground surface, including at crossings;
    // the existing bridge decks remain a separate height above this ground.
    const blend=1-smoothstep((Math.sqrt(nearest[i])-core)/feather);
    field.heights[i]+=(targets[i]/weights[i]-field.heights[i])*blend;
  }
  return field;
}
