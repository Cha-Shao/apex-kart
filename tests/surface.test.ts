import test from 'node:test';
import assert from 'node:assert/strict';
import {TerrainField} from '../src/terrain.ts';
import {buildTrack,curbGeometry,DEFAULT_SETTINGS,PRESETS} from '../src/track.ts';
import {surfaceTrack} from '../src/surface-track.ts';

test('terrain refinement preserves editable nodes, does not overshoot, and invalidates after a brush stroke',()=>{
  const field=new TerrainField();field.paint({x:0,z:0},50,8,1,'raise');const source=field.heights.slice(),refined=field.refined();
  assert.equal(refined.resolution,257);assert.deepEqual(field.heights,source);assert.equal(field.refined(),refined);
  for(let z=0;z<field.resolution;z++)for(let x=0;x<field.resolution;x++)assert.equal(refined.heights[z*2*257+x*2],field.heights[z*field.resolution+x]);
  assert.ok(refined.max<=field.max+1e-6);assert.ok(refined.min>=field.min-1e-6);
  field.paint({x:0,z:0},25,2,1,'lower');assert.notEqual(field.refined(),refined);
});

test('dense surface curves close smoothly without increasing timing samples or moving bridge distances',()=>{
  const track=buildTrack(PRESETS[0].points,DEFAULT_SETTINGS),count=track.samples.length,render=surfaceTrack(track);
  assert.equal(track.samples.length,count);assert.ok(render.samples.length>count*3);assert.equal(render.length,track.length);
  for(let i=0;i<render.samples.length;i++){
    const a=render.samples[i],b=render.samples[(i+1)%render.samples.length];assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<1.23);assert.ok(Math.abs(Math.hypot(a.nx,a.nz)-1)<1e-5);
  }
});

test('painted kerbs never sink into sloping terrain between vertices or across the closing seam',()=>{
  const track=surfaceTrack(buildTrack(PRESETS[0].points,DEFAULT_SETTINGS)),field=new TerrainField();
  field.paint({x:120,z:45},55,8,2,'raise');field.paint({x:-100,z:-50},45,7,2,'lower');const refined=field.refined(),mesh=curbGeometry(track,(x,z)=>refined.sample(x,z),refined);
  assert.ok(mesh.vertices.length>1000);assert.equal(mesh.colors.length,mesh.vertices.length);
  for(let i=0;i<mesh.indices.length;i+=3){
    const [a,b,c]=mesh.indices.slice(i,i+3).map(index=>mesh.vertices.slice(index*3,index*3+3));
    const x=(a[0]+b[0]+c[0])/3,z=(a[2]+b[2]+c[2])/3,y=(a[1]+b[1]+c[1])/3;
    assert.ok(Math.abs(y-refined.sample(x,z)-.026)<1e-5,'triangle must conform to the exact collision surface');
    assert.ok((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])>0,'upward winding');
  }
});
