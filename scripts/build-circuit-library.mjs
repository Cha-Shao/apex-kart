// Regenerate the local library from the retained, licensed geographic source snapshots.
// F1 source: bacinger/f1-circuits @ 8094e957b8d6aa8b9f4510c93968556cccd30e02 (MIT).
// Nordschleife source: OpenStreetMap API, retrieved 2026-11-14 (ODbL 1.0).
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,'src/circuit-data',name),'utf8'));
const source=read('f1-source.geojson');
const official=read('official-lengths-2026.json');
const osm=read('nordschleife-osm-source.json');
const records=[
 ['melbourne','au-1953','墨尔本 · 阿尔伯特公园','澳大利亚','AU',1,'australia','2026-03-08'],
 ['shanghai','cn-2004','上海国际赛车场','中国','CN',2,'china','2026-03-15'],
 ['suzuka','jp-1962','铃鹿国际赛道','日本','JP',3,'japan','2026-03-29'],
 ['miami','us-2022','迈阿密国际赛道','美国','US',4,'miami','2026-05-03'],
 ['montreal','ca-1978','蒙特利尔 · 维伦纽夫','加拿大','CA',5,'canada','2026-05-24'],
 ['monaco','mc-1929','摩纳哥街道赛道','摩纳哥','MC',6,'monaco','2026-06-07'],
 ['barcelona','es-1991','巴塞罗那 · 加泰罗尼亚','西班牙','ES',7,'barcelona-catalunya','2026-06-14'],
 ['red-bull-ring','at-1969','红牛环','奥地利','AT',8,'austria','2026-06-28'],
 ['silverstone','gb-1948','银石赛道','英国','GB',9,'great-britain','2026-07-05'],
 ['spa','be-1925','斯帕 · 弗朗科尔尚','比利时','BE',10,'belgium','2026-07-19'],
 ['hungaroring','hu-1986','亨格罗宁赛道','匈牙利','HU',11,'hungary','2026-07-26'],
 ['zandvoort','nl-1948','赞德沃特赛道','荷兰','NL',12,'netherlands','2026-08-23'],
 ['monza','it-1922','蒙扎国家赛车场','意大利','IT',13,'italy','2026-09-06'],
 ['madrid','es-2026','马德里 · MADRING','西班牙','ES',14,'spain','2026-09-13'],
 ['baku','az-2016','巴库城市赛道','阿塞拜疆','AZ',15,'azerbaijan','2026-09-26'],
 ['sepang','my-1999','雪邦国际赛道','马来西亚','MY',16,'bahrain','2026-10-04'],
 ['singapore','sg-2008','新加坡 · 滨海湾','新加坡','SG',17,'singapore','2026-10-11'],
 ['cota','us-2012','奥斯汀 · 美洲赛道','美国','US',18,'united-states','2026-10-25'],
 ['mexico','mx-1962','墨西哥城 · 罗德里格斯','墨西哥','MX',19,'mexico','2026-11-01'],
 ['interlagos','br-1940','圣保罗 · 英特拉格斯','巴西','BR',20,'brazil','2026-11-08'],
 ['las-vegas','us-2023','拉斯维加斯街道赛道','美国','US',21,'las-vegas','2026-11-21'],
 ['lusail','qa-2004','卢赛尔国际赛道','卡塔尔','QA',22,'qatar','2026-11-29'],
 ['yas-marina','ae-2009','阿布扎比 · 亚斯码头','阿联酋','AE',23,'united-arab-emirates','2026-12-06'],
 ['sakhir','bh-2002','萨基尔 · 巴林国际赛道','巴林','BH',null,null,'2026-04-12'],
 ['jeddah','sa-2021','吉达滨海赛道','沙特阿拉伯','SA',null,null,'2026-04-19'],
];
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const round=n=>Math.round(n*10000)/10000;
function bounds(p){return {minX:Math.min(...p.map(v=>v.x)),maxX:Math.max(...p.map(v=>v.x)),minZ:Math.min(...p.map(v=>v.z)),maxZ:Math.max(...p.map(v=>v.z))};}
function length(p){return p.reduce((v,a,i)=>v+dist(a,p[(i+1)%p.length]),0);}
function crossing(a,b,c,d){const rx=b.x-a.x,rz=b.z-a.z,sx=d.x-c.x,sz=d.z-c.z,den=rx*sz-rz*sx;if(Math.abs(den)<1e-9)return null;const qx=c.x-a.x,qz=c.z-a.z,t=(qx*sz-qz*sx)/den,u=(qx*rz-qz*rx)/den;if(t<=1e-5||t>=1-1e-5||u<=1e-5||u>=1-1e-5)return null;return {t,u,point:{x:a.x+rx*t,z:a.z+rz*t}};}
function normalize(lonlat,officialLengthM){
 const ll=lonlat.filter((p,i)=>!i||Math.hypot(p[0]-lonlat[i-1][0],p[1]-lonlat[i-1][1])>1e-9);if(ll.length>2&&Math.hypot(ll[0][0]-ll.at(-1)[0],ll[0][1]-ll.at(-1)[1])<1e-8)ll.pop();
 const lat=ll.reduce((v,p)=>v+p[1],0)/ll.length,lon=ll.reduce((v,p)=>v+p[0],0)/ll.length;
 let points=ll.map(([x,y])=>({x:(x-lon)*111320*Math.cos(lat*Math.PI/180),z:-(y-lat)*111320}));
 const geographicLengthM=length(points),lengthCorrection=officialLengthM/geographicLengthM;
 points=points.map(p=>({x:p.x*lengthCorrection,z:p.z*lengthCorrection}));const b=bounds(points),cx=(b.minX+b.maxX)/2,cz=(b.minZ+b.maxZ)/2;
 const nativePoints=points.map(p=>({x:round(p.x-cx),z:round(p.z-cz)})),nativeBounds=bounds(nativePoints),scale=Math.min(380/(b.maxX-b.minX),260/(b.maxZ-b.minZ));
 const compactPoints=nativePoints.map(p=>({x:round(p.x*scale),z:round(p.z*scale)}));
 const cumulative=[0];for(let i=0;i<nativePoints.length;i++)cumulative.push(cumulative.at(-1)+dist(nativePoints[i],nativePoints[(i+1)%nativePoints.length]));
 const crossings=[];for(let i=0;i<nativePoints.length;i++)for(let j=i+2;j<nativePoints.length;j++){if(i===0&&j===nativePoints.length-1)continue;const a=nativePoints[i],b=nativePoints[(i+1)%nativePoints.length],c=nativePoints[j],d=nativePoints[(j+1)%nativePoints.length],v=crossing(a,b,c,d);if(v){const progressA=(cumulative[i]+dist(a,b)*v.t)/officialLengthM,progressB=(cumulative[j]+dist(c,d)*v.u)/officialLengthM;crossings.push({aIndex:i,bIndex:j,progressA,progressB,upperProgress:progressB,lowerProgress:progressA,nativePoint:v.point,point:{x:v.point.x*scale,z:v.point.z*scale}});}}
 return {nativePoints,compactPoints,points:compactPoints,nativeBounds,compactBounds:bounds(compactPoints),scale,compactScale:scale,geographicLengthM:round(geographicLengthM),lengthCorrection,compactLengthM:round(length(compactPoints)),crossings};
}
const data=records.map(([id,sourceId,name,country,countryCode,round,slug,raceDate])=>{
 const feature=source.features.find(f=>f.properties.id===sourceId);if(!feature)throw Error(`Missing ${sourceId}`);
 const counterclockwise=new Set(['miami','baku','singapore','cota','interlagos','las-vegas','yas-marina','jeddah']);
 const direction=counterclockwise.has(id)?'counterclockwise':'clockwise';
 let coordinates=feature.geometry.coordinates.slice();if(Math.hypot(coordinates[0][0]-coordinates.at(-1)[0],coordinates[0][1]-coordinates.at(-1)[1])<1e-8)coordinates.pop();
 const area=coordinates.reduce((v,p,i)=>{const q=coordinates[(i+1)%coordinates.length];return v-p[0]*q[1]+q[0]*p[1];},0);
 if(area*(counterclockwise.has(id)?-1:1)<0)coordinates=[coordinates[0],...coordinates.slice(1).reverse()];
 const info=official.find(v=>v.slug===slug),officialLengthM=info?.verified?info.lengthM:feature.properties.length;
 const calendarStatus=round?'current-2026':'original-2026';
 const note=id==='sepang'?'2026 巴林大奖赛移至雪邦举行。':id==='sakhir'?'2026 原定萨基尔站取消；巴林大奖赛改在雪邦举办。':id==='jeddah'?'2026 原定吉达站取消，保留原定赛道供体验。':id==='madrid'?'开源线路为地图轮廓近似，非官方测绘；总长按 F1 当前 5.414 km 校正。':'';
 return {id,name,subtitle:feature.properties.Name,country,countryCode,round,calendarStatus,raceDate,direction,officialLengthM,referenceLengthM:feature.properties.length,officialUrl:info?.url??`https://www.formula1.com/en/racing/2025/${id==='sakhir'?'bahrain':'saudi-arabia'}`,sourceUrl:`https://github.com/bacinger/f1-circuits/blob/8094e957b8d6aa8b9f4510c93968556cccd30e02/circuits/${sourceId}.geojson`,sourceRevision:'8094e957b8d6aa8b9f4510c93968556cccd30e02',sourceCredit:'Tomislav Bacinger / f1-circuits',license:'MIT',verifiedAt:'2026-11-14',bypassValidation:true,notes:note,...normalize(coordinates,officialLengthM)};
});
// OSM Nordschleife sections form one degree-2 closed cycle. GP/pit/24h connectors were excluded.
const incident=new Map();for(const w of osm.ways)for(const n of [w.nodes[0],w.nodes.at(-1)]){if(!incident.has(n))incident.set(n,[]);incident.get(n).push(w);}
for(const [n,w] of incident)if(w.length!==2)throw Error(`Nordschleife node ${n} has degree ${w.length}, expected 2`);
const start=506284053,visited=new Set(),orderedNodes=[start],orderedWays=[];let current=start;
while(visited.size<osm.ways.length){const candidates=incident.get(current)?.filter(w=>!visited.has(w.id));if(!candidates?.length)throw Error('Nordschleife does not close');let way=orderedWays.length?candidates[0]:candidates.find(w=>w.id===41395670);visited.add(way.id);const nodes=way.nodes[0]===current?way.nodes:[...way.nodes].reverse();orderedNodes.push(...nodes.slice(1));orderedWays.push({way,startIndex:orderedNodes.length-nodes.length,endIndex:orderedNodes.length-1});current=orderedNodes.at(-1);}
if(current!==start)throw Error('Nordschleife not closed');
orderedNodes.pop();const nord=normalize(orderedNodes.map(id=>osm.nodes[String(id)]),20832);
const cumul=[0];for(let i=0;i<nord.nativePoints.length;i++)cumul.push(cumul.at(-1)+dist(nord.nativePoints[i],nord.nativePoints[(i+1)%nord.nativePoints.length]));
const bridgeSpans=orderedWays.filter(w=>w.way.tags.bridge==='yes').map(w=>({startIndex:w.startIndex,endIndex:w.endIndex%nord.nativePoints.length,startProgress:cumul[w.startIndex]/20832,endProgress:Math.min(1,cumul[w.endIndex]/20832),sourceWayId:w.way.id,nativeStart:nord.nativePoints[w.startIndex],nativeEnd:nord.nativePoints[w.endIndex%nord.nativePoints.length],name:w.way.name||'OSM bridge'}));
data.push({id:'nordschleife',name:'纽博格林 · 北环',subtitle:'Nürburgring Nordschleife',country:'德国',countryCode:'DE',round:null,calendarStatus:'bonus',raceDate:null,direction:'clockwise',officialLengthM:20832,referenceLengthM:20832,officialUrl:'https://www.nuerburgring.de/info/nuerburgring/race-tracks/nordschleife',sourceUrl:'https://www.openstreetmap.org/way/41395670',sourceRevision:'OSM API snapshot 2026-11-14',sourceCredit:'© OpenStreetMap contributors',license:'ODbL-1.0',verifiedAt:'2026-11-14',bypassValidation:true,notes:'20.832 km 完整北环（T13 起终点），不含 GP 赛道或 24 小时连接线；实际地形高程未包含在此平面线路数据中。',bridgeSpans,...nord});
const definitions=`/** Licensed real-world centreline approximations. Generated by scripts/build-circuit-library.mjs. */
import type { Point } from './track';
export type CircuitCalendarStatus='current-2026'|'original-2026'|'bonus';
export interface CircuitCrossing { aIndex:number;bIndex:number;progressA:number;progressB:number;upperProgress:number;lowerProgress:number;nativePoint:Point;point:Point }
export interface CircuitBridgeSpan { startIndex:number;endIndex:number;startProgress:number;endProgress:number;sourceWayId:number;nativeStart:Point;nativeEnd:Point;name:string }
export interface CircuitPreset {
 id:string;name:string;subtitle:string;country:string;countryCode:string;round:number|null;calendarStatus:CircuitCalendarStatus;raceDate:string|null;direction:'clockwise'|'counterclockwise';
 officialLengthM:number;referenceLengthM:number;officialUrl:string;sourceUrl:string;sourceRevision:string;sourceCredit:string;license:'MIT'|'ODbL-1.0';verifiedAt:string;bypassValidation:boolean;notes:string;
 /** Compact kart interpretation; shape is uniformly scaled to fit 380 × 260 metres. */
 points:Point[];compactPoints:Point[];
 /** Geographic shape projected to local metres, centred, then uniformly corrected to official lap length. */
 nativePoints:Point[];nativeBounds:{minX:number;maxX:number;minZ:number;maxZ:number};compactBounds:{minX:number;maxX:number;minZ:number;maxZ:number};
 scale:number;compactScale:number;geographicLengthM:number;lengthCorrection:number;compactLengthM:number;crossings:CircuitCrossing[];bridgeSpans?:CircuitBridgeSpan[];
}
export const CIRCUIT_LIBRARY_VERIFIED_AT='2026-11-14';
export const F1_CALENDAR_URL='https://www.formula1.com/en/racing/2026';
export const F1_CALENDAR_NOTE='2026 当前正式赛历 23 站；保留原定萨基尔、吉达两条布局，另含纽北。赛历核实于 2026-11-14。';
export const CIRCUIT_LIBRARY: CircuitPreset[] = `;
fs.writeFileSync(path.join(root,'src/circuit-library.ts'),definitions+JSON.stringify(data)+';\n');
fs.mkdirSync(path.join(root,'public/data'),{recursive:true});
fs.writeFileSync(path.join(root,'public/data/nordschleife-centreline.geojson'),JSON.stringify({type:'FeatureCollection',license:'https://opendatacommons.org/licenses/odbl/1-0/',attribution:'© OpenStreetMap contributors',source:'https://www.openstreetmap.org/copyright',retrievedAt:'2026-11-14',features:[{type:'Feature',properties:{name:'Nürburgring Nordschleife',referenceLengthM:20832,sourceWays:orderedWays.map(w=>({id:w.way.id,version:w.way.version}))},geometry:{type:'LineString',coordinates:[...orderedNodes.map(id=>osm.nodes[String(id)]),osm.nodes[String(start)]]}}]}));
console.log(data.map(t=>({id:t.id,round:t.round,length:t.officialLengthM,points:t.nativePoints.length,compact:Math.round(t.compactLengthM),crossings:t.crossings.length,bridges:t.bridgeSpans?.length??0})));
console.log('active',data.filter(t=>t.calendarStatus==='current-2026').length,'original',data.filter(t=>t.calendarStatus==='original-2026').length,'bonus',data.filter(t=>t.calendarStatus==='bonus').length);
for(const t of data)if(Math.abs(length(t.nativePoints)-t.officialLengthM)>.01||t.nativePoints.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.z))||t.compactBounds.minX< -190.001||t.compactBounds.maxZ>130.001)throw Error(`Invalid normalized track ${t.id}`);
