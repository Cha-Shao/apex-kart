import test from 'node:test';
import assert from 'node:assert/strict';
import { CIRCUIT_LIBRARY } from '../src/circuit-library.ts';
const loopLength=(points:{x:number;z:number}[])=>points.reduce((sum,p,i)=>{const n=points[(i+1)%points.length];return sum+Math.hypot(n.x-p.x,n.z-p.z);},0);
test('library covers every current 2026 F1 round, both original cancelled layouts, and the full Nordschleife',()=>{
  const current=CIRCUIT_LIBRARY.filter(t=>t.calendarStatus==='current-2026');
  assert.equal(current.length,23);assert.deepEqual(current.map(t=>t.round),Array.from({length:23},(_,i)=>i+1));
  assert.equal(current.find(t=>t.round===16)?.id,'sepang');
  assert.deepEqual(CIRCUIT_LIBRARY.filter(t=>t.calendarStatus==='original-2026').map(t=>t.id),['sakhir','jeddah']);
  assert.equal(CIRCUIT_LIBRARY.find(t=>t.id==='nordschleife')?.officialLengthM,20832);
  assert.equal(new Set(CIRCUIT_LIBRARY.map(t=>t.id)).size,CIRCUIT_LIBRARY.length);
});
test('geographic linework is finite, metres are calibrated to reference length, and compact mode preserves uniform scale',()=>{
  for(const t of CIRCUIT_LIBRARY){
    assert.ok(t.nativePoints.length>50,t.id);assert.ok(t.nativePoints.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.z)),t.id);
    assert.ok(Math.abs(loopLength(t.nativePoints)-t.officialLengthM)<.02,t.id);
    assert.ok(t.compactBounds.minX>=-190.001&&t.compactBounds.maxX<=190.001&&t.compactBounds.minZ>=-130.001&&t.compactBounds.maxZ<=130.001,t.id);
    assert.ok(Math.abs(loopLength(t.compactPoints)/loopLength(t.nativePoints)-t.compactScale)<1e-5,t.id);
    assert.ok(t.sourceUrl.startsWith('https://')&&t.verifiedAt==='2026-11-14',t.id);
    const area=t.nativePoints.reduce((a,p,i)=>{const q=t.nativePoints[(i+1)%t.nativePoints.length];return a+p.x*q.z-q.x*p.z;},0);
    assert.ok(area*(t.direction==='clockwise'?1:-1)>0,t.id+' race direction');
  }
});
test('Suzuka supplies the true figure-eight crossing and Nordschleife distinguishes ordinary-road bridges',()=>{
  const suzuka=CIRCUIT_LIBRARY.find(t=>t.id==='suzuka')!,nord=CIRCUIT_LIBRARY.find(t=>t.id==='nordschleife')!;
  assert.equal(suzuka.crossings.length,1);assert.ok(Math.abs(suzuka.crossings[0].upperProgress-.80784)<.001);
  assert.equal(nord.crossings.length,0);assert.equal(nord.bridgeSpans?.length,5);
  assert.ok(nord.bridgeSpans!.every(s=>s.startIndex<nord.nativePoints.length&&s.endIndex<nord.nativePoints.length&&s.startProgress>=0&&s.endProgress<=1));
});
