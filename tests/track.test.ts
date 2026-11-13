import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrack, DEFAULT_SETTINGS, nearestOnTrack, parseTrackFile, PRESETS } from '../src/track.ts';

for(const preset of PRESETS)test(`preset ${preset.id} is closed, smooth and driveable`,()=>{
  const t=buildTrack(preset.points,DEFAULT_SETTINGS);
  assert.ok(t.length>500&&t.length<1700);
  assert.ok(t.corners>3);assert.ok(t.straightPercent>8);
  const first=t.samples[0],last=t.samples.at(-1)!;
  assert.ok(Math.hypot(first.x-last.x,first.z-last.z)<2);
  assert.ok(t.samples.every(s=>Number.isFinite(s.curvature)&&Math.abs(Math.hypot(s.tx,s.tz)-1)<.0001));
  assert.ok(t.samples.some(s=>s.kind==='straight'));assert.ok(t.samples.some(s=>s.kind==='curve'));
});
test('hand drawn uneven noisy loop is smoothed without losing straight and corner classifications',()=>{
  const pts: {x:number;z:number}[]=[];
  const corners=[[-120,75],[120,75],[145,45],[145,-60],[110,-85],[-115,-85],[-145,-55],[-145,45]];
  for(let i=0;i<corners.length;i++){const a=corners[i],b=corners[(i+1)%corners.length];for(let j=0;j<40;j++)pts.push({x:a[0]+(b[0]-a[0])*j/40+Math.sin(j*2.7)*.7,z:a[1]+(b[1]-a[1])*j/40+Math.cos(j*2.1)*.7});}
  const t=buildTrack(pts,DEFAULT_SETTINGS);assert.ok(t.controls.length<pts.length/3);assert.ok(t.straightPercent>40);assert.ok(t.corners>=4);
});
test('self intersections are rejected with a usable message',()=>{
  assert.throws(()=>buildTrack([{x:-120,z:-80},{x:0,z:0},{x:120,z:80},{x:120,z:-80},{x:0,z:0},{x:-120,z:80}],DEFAULT_SETTINGS),/交叉|靠得太近/);
});
test('nearest road lookup distinguishes asphalt from the infield',()=>{const t=buildTrack(PRESETS[0].points,DEFAULT_SETTINGS),p=t.samples[40];assert.ok(nearestOnTrack(t,p).distance<.001);assert.ok(nearestOnTrack(t,{x:0,z:0}).distance>10);});
test('import/export preserves the track and rejects malformed geometry',()=>{
  const file={version:1,name:'我的赛道',points:PRESETS[0].points,settings:DEFAULT_SETTINGS};
  const parsed=parseTrackFile(JSON.stringify(file));assert.equal(parsed.name,file.name);assert.equal(buildTrack(parsed.points,parsed.settings).length,buildTrack(file.points,file.settings).length);
  assert.equal(parseTrackFile(JSON.stringify({...file,settings:{...DEFAULT_SETTINGS,smoothness:0}})).settings.smoothness,0);
  assert.throws(()=>parseTrackFile('{"version":2,"points":[]}'),/不支持/);
  assert.throws(()=>parseTrackFile(JSON.stringify({...file,points:[...file.points,{x:9000,z:0}]})),/超出/);
});
