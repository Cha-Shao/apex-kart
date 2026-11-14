import './style.css';
import './broadcast.css';
import './reference-image.css';
import {ReferenceImageLayer} from './reference-image';
import {SectorTiming} from './timing';
import {mountLapTimes} from './components/LapTimes';
import {mountVehiclePicker} from './components/VehiclePicker';
import {type VehicleId} from './vehicles';
import { createIcons, ArrowUpRight, ArrowDownToLine, ArrowUpFromLine, Check, ChevronDown, CircleHelp, Flag, Focus, Fullscreen, Gauge, Grip, Maximize2, MousePointer2, Pause, Pencil, Play, Redo2, RotateCcw, Save, Settings2, Shield, Sparkles, Sun, Trash2, Undo2, Volume2, VolumeX, X } from 'lucide';
import { buildTrack, DEFAULT_SETTINGS, nearestOnTrack, parseTrackFile, PRESETS, type Point, type RouteMetadata, type TrackData, type TrackFile, type TrackSettings } from './track';
import { TrackEditor } from './editor';
import { KartPhysics } from './physics';
import { GameScene, type CameraMode } from './scene';
import { EngineAudio } from './audio';
import { TerrainField, TerrainPainter, parseTerrain, type BrushMode } from './terrain';
import { PedalHistory } from './telemetry';
import { CIRCUIT_LIBRARY, F1_CALENDAR_NOTE } from './circuit-library';

const iconSet={ArrowUpRight,ArrowDownToLine,ArrowUpFromLine,Check,ChevronDown,CircleHelp,Flag,Focus,Fullscreen,Gauge,Grip,Maximize2,MousePointer2,Pause,Pencil,Play,Redo2,RotateCcw,Save,Settings2,Shield,Sparkles,Sun,Trash2,Undo2,Volume2,VolumeX,X};
const icons=()=>createIcons({icons:iconSet,attrs:{'stroke-width':1.6}});
const $=<T extends HTMLElement=HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
const formatTime=(seconds:number)=>{if(!Number.isFinite(seconds))return '—:——.———';const m=Math.floor(seconds/60),s=Math.floor(seconds%60),cs=Math.floor(seconds%1*1000);return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(3,'0')}`;};
const safeStorage={get(key:string){try{return localStorage.getItem(key);}catch{return null;}},set(key:string,value:string){try{localStorage.setItem(key,value);return true;}catch{return false;}}};
function miniSvg(points:Point[]){const xs=points.map(p=>p.x),zs=points.map(p=>p.z),minx=Math.min(...xs),minz=Math.min(...zs),w=Math.max(...xs)-minx,h=Math.max(...zs)-minz,scale=Math.min(66/w,41/h);return `<svg viewBox="0 0 90 60" aria-hidden="true"><path d="${points.map((p,i)=>`${i?'L':'M'}${12+(p.x-minx)*scale},${8+(p.z-minz)*scale}`).join(' ')} Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg>`;}

$('#app').innerHTML=`
<header class="topbar">
  <a class="brand" href="#" aria-label="APEX 首页"><span class="brand-mark"><svg viewBox="0 0 36 36"><path d="M4 29 16 6h6l11 23h-8l-6-15-4 8h7l3 7Z"/></svg></span><span class="wordmark">APEX<span class="brand-separator">/</span><span class="brand-sub">卡丁车实验室</span></span></a>
  <nav class="main-nav" aria-label="工作模式"><button class="nav-button" id="drive-tab"><i data-lucide="gauge"></i>自由试驾</button><button class="nav-button active" id="editor-tab"><i data-lucide="pencil"></i>赛道工坊<span class="new-tag">BETA</span></button></nav>
  <div class="header-actions"><button class="icon-button" id="sound-button" aria-label="开启引擎声音" title="引擎声音"><i data-lucide="volume-x"></i></button><button class="icon-button" id="help-button" aria-label="操作说明" title="操作说明"><i data-lucide="circle-help"></i></button><span class="divider"></span><button class="save-button" id="save-button"><i data-lucide="save"></i><span>保存赛道</span></button></div>
</header>
<main class="workspace">
  <section class="viewport" aria-label="赛道 3D 视图">
    <div id="scene-container"></div>
    <div class="view-vignette"></div>
    <div class="viewport-top"><div class="weather"><i data-lucide="sun"></i><span>晴 · 24°C</span><span class="weather-line"></span><span>干燥路面</span></div></div>
    <div class="session-top" id="session-top" hidden><div class="session-chip"><span class="live-dot"></span>自由练习<span class="session-divider">/</span><span id="race-track-name">海岸俱乐部</span></div></div>
    <div class="lap-history" id="lap-history" hidden></div><div class="sector-bars" id="sector-bars" hidden><div class="timing-driver"><b>DRIVER</b><div><span>07</span><strong>YOU</strong></div></div><div class="sector-bar pending" data-sector="0"><b>SECTOR 1</b><div class="sector-value"><i></i><small>00.000</small></div></div><div class="sector-bar pending" data-sector="1"><b>SECTOR 2</b><div class="sector-value"><i></i><small>00.000</small></div></div><div class="sector-bar pending" data-sector="2"><b>SECTOR 3</b><div class="sector-value"><i></i><small>00.000</small></div></div><div class="timing-total"><b>LAP TIME</b><strong id="broadcast-lap">0:00.000</strong></div></div><div class="center-message" id="center-message" hidden></div>
    <div class="session-card" id="session-card"><div class="session-number">01<span>/ CIRCUIT</span></div><div class="session-info"><div class="session-title-row"><h2 id="track-name">海岸俱乐部</h2><span class="difficulty-dot"></span><span class="difficulty-label" id="difficulty-label">技术型</span></div><p><span id="track-length-label">— m</span><span>·</span><span id="track-corners-label">— 个弯道</span><span>·</span><span>单人计时</span></p></div><button class="drive-button" id="start-button"><span>上车试驾</span><i data-lucide="arrow-up-right"></i></button></div>
    <div class="kart-spec" id="kart-spec"><span class="spec-label" id="vehicle-size">YOUR KART · 1.35 × 1.80 m</span><div class="kart-title"><strong id="vehicle-name">APX–07</strong> <span id="vehicle-engine">4-STROKE</span></div><div class="kart-details"><span id="vehicle-weight">165 <small>kg</small></span><span id="vehicle-capacity">200 <small>cc</small></span><div class="color-options" aria-label="车身颜色"><button class="color-swatch selected" data-color="#c4ed4c" style="--swatch:#c4ed4c" aria-label="青柠色车身"></button><button class="color-swatch" data-color="#e88161" style="--swatch:#e88161" aria-label="珊瑚色车身"></button><button class="color-swatch" data-color="#75c9cc" style="--swatch:#75c9cc" aria-label="冰蓝色车身"></button></div><a id="vehicle-source" href="/vehicle-credits.html" target="_blank" rel="noopener" hidden>公开规格 ↗</a></div></div>
    <div class="driving-hud" id="driving-hud" hidden><div class="g-meter"><span>轮胎抓地</span><div class="g-circle"><div class="g-horizontal"></div><div class="g-vertical"></div><b id="g-dot"></b></div><span id="grip-label">正常抓地</span></div><div class="speedometer"><div class="rpm-bars" id="rpm-bars">${Array.from({length:22},(_,i)=>`<span style="--bar:${i}"></span>`).join('')}</div><div class="speed-value"><strong id="speed">0</strong><div><b id="gear">N</b><span>KM/H</span></div></div><div class="speed-meta"><span><span class="status-dot"></span><span id="surface-label">干燥沥青</span></span><span id="rpm-label">1,600 RPM</span></div></div></div>
    <div class="race-actions" id="race-actions" hidden><button id="pause-button" class="round-action" aria-label="暂停"><i data-lucide="pause"></i></button><button id="reset-button" class="round-action" title="复位车辆 (R)" aria-label="复位车辆"><i data-lucide="rotate-ccw"></i></button><button id="exit-button" class="exit-button"><i data-lucide="pencil"></i><span>返回工坊</span></button></div>
    <div class="pedal-panel" id="pedal-panel" hidden><div class="pedal-heading"><span>驾驶输入 <small>最近 10 秒</small></span><div><span class="throttle-key">油门 <b id="throttle-percent">0%</b></span><span class="brake-key">实际刹车 <b id="brake-percent">0%</b></span></div></div><div class="pedal-assist-row"><span class="brake-demand-key">踏板 <b id="brake-demand-percent">0%</b><small>虚线 · 阴影为削减量</small></span><b id="abs-status" role="status">ABS 待命</b></div><canvas id="pedal-chart" width="300" height="105" aria-label="最近十秒油门、刹车踏板虚线与ABS实际刹车实线，阴影显示刹车削减量"></canvas></div>
    <div class="controls-hint" id="controls-hint"><span><kbd>拖动</kbd> 旋转视角</span><span><kbd>滚轮</kbd> 缩放</span><span class="hint-extra"><i data-lucide="mouse-pointer-2"></i>探索你的赛道</span></div>
    <div class="mobile-controls" id="mobile-controls" hidden><div><button data-control="left" aria-label="左转">◀</button><button data-control="right" aria-label="右转">▶</button></div><div><button data-control="brake" class="brake-pedal">刹车</button><button data-control="throttle" class="gas-pedal">油门</button></div></div>
    <div class="viewport-footer"><div class="render-status"><span class="status-dot"></span><span id="render-status">3D 实时预览</span><span class="status-slash">/</span><span id="fps">60 FPS</span></div><div class="camera-switch" role="group" aria-label="视角"><button class="selected" data-camera="orbit" title="环绕视角">环绕</button><button data-camera="chase" title="跟随视角 (C)">跟随</button><button data-camera="top" title="俯视视角">俯视</button><button data-camera="cockpit" title="驾驶员视角">座舱</button><span></span><button id="fullscreen-button" aria-label="全屏" title="全屏"><i data-lucide="maximize-2"></i></button></div></div>
    <div class="loading-screen" id="loading-screen"><div class="loading-mark">A<span>PEX</span></div><div class="loading-line"></div><p>正在准备你的赛道…</p></div>
  </section>
  <aside class="editor-panel" id="editor-panel">
    <div class="panel-heading"><div class="panel-eyebrow"><span class="live-dot"></span> TRACK BUILDER <span>01 — 03</span></div><div class="panel-title"><h2>好赛道，始于一笔。</h2><button class="icon-button" id="new-button" title="新建手绘赛道" aria-label="新建手绘赛道"><i data-lucide="pencil"></i></button></div><p>画出路线，我们来打磨每一个弯。</p></div>
    <div class="panel-scroll">
      <div id="vehicle-picker"></div>
      <div class="library-block"><div class="section-label"><span>真实赛道库</span><span class="library-badge">2026 / DAYTONA</span></div><div class="library-select-row"><select id="circuit-select" aria-label="选择真实赛道"><option value="">选择 F1 赛道或戴托纳…</option>${(['current-2026','original-2026','bonus'] as const).map((status,i)=>`<optgroup label="${['2026 当前赛历','2026 原定布局（调整前）','耐力经典'][i]}">${CIRCUIT_LIBRARY.filter(c=>c.calendarStatus===status).map(c=>`<option value="${c.id}">${c.round?`${String(c.round).padStart(2,'0')} · `:''}${c.name}</option>`).join('')}</optgroup>`).join('')}</select></div><div class="library-load-row"><select id="circuit-scale" aria-label="赛道尺寸"><option value="native">原尺寸 · 1:1 米制</option><option value="compact">卡丁车缩放版</option></select><button id="load-circuit">载入赛道 <i data-lucide="arrow-up-right"></i></button></div><p id="library-info">${CIRCUIT_LIBRARY.filter(c=>c.calendarStatus==='current-2026').length} 条现行 F1 布局 + 原定布局 + 戴托纳。<br>真实路线近似，地形高度可自由绘制。</p><a class="library-credit" href="/circuit-credits.html" target="_blank" rel="noopener">赛历来源与数据许可 ↗</a></div>
      <div class="section-label preset-label"><span>从灵感出发</span><span>或直接在下方绘制 <i data-lucide="arrow-up-right"></i></span></div>
      <div class="presets">${PRESETS.map((p,i)=>`<button class="preset ${i===0?'selected':''}" data-preset="${p.id}">${miniSvg(p.points)}<span>${p.name}</span></button>`).join('')}</div>
      <div class="editor-section"><div class="section-label"><span><b>01</b> 绘制布局</span><div class="canvas-tools"><button class="tool" data-tool="draw" title="画笔：一笔画出闭合环线" aria-label="画笔工具"><i data-lucide="pencil"></i></button><button class="tool selected" data-tool="edit" title="拖动控制点调整路线" aria-label="控制点工具"><i data-lucide="mouse-pointer-2"></i></button><span></span><button class="tool" id="undo-button" title="撤销" aria-label="撤销"><i data-lucide="undo-2"></i></button><button class="tool" id="clear-button" title="清空画布" aria-label="清空画布"><i data-lucide="trash-2"></i></button></div></div>
      <div class="layer-tabs"><button class="selected" data-layer="route">路线控制点</button><button data-layer="height">地形高度层</button><label><input id="height-visible" type="checkbox" checked/>显示高度</label></div>
      <div id="reference-controls"></div><div class="canvas-wrap"><canvas id="reference-canvas" width="800" height="600" aria-hidden="true"></canvas><canvas id="track-canvas" aria-label="赛道绘制画布。使用画笔绘制，左键拖动控制点，右键删除控制点。" tabindex="0"></canvas><canvas id="height-canvas" aria-label="地形高度覆盖层。羽化笔刷绘制，Shift 或右键反向。"></canvas><span class="canvas-badge" id="layer-badge"><i data-lucide="sparkles"></i> 自动平滑</span><span class="canvas-corner">N ↑</span></div>
      <div class="terrain-tools" id="terrain-tools" hidden><div class="brush-modes"><button class="selected" data-brush="raise">抬高 ＋</button><button data-brush="lower">压低 −</button><button data-brush="smooth">平滑</button><button data-brush="flatten">归零</button></div><label class="range-label" for="brush-radius"><span>羽化半径</span><output id="brush-radius-output">24 m</output></label><input id="brush-radius" type="range" min="12" max="70" value="24"/><label class="range-label" for="brush-strength"><span>高度速率</span><output id="brush-strength-output">4 m/s</output></label><input id="brush-strength" type="range" min="1" max="12" value="4"/><div class="terrain-actions"><button id="undo-height"><i data-lucide="undo-2"></i>撤销高度</button><span id="height-range">0.0 — 0.0 m</span><button id="clear-height">清空高度</button></div><p>按住涂抹，边缘自动羽化。Shift / 右键反向；生成后同步到路面与碰撞。</p></div>
      <div class="canvas-legend"><span><b class="legend-dot straight"></b>直道</span><span><b class="legend-dot curve"></b>缓弯</span><span><b class="legend-dot hairpin"></b>急弯</span><span class="auto-close"><i data-lucide="check"></i>自动闭合</span></div>
      <p class="editor-status" id="editor-status">拖动控制点，微调你的走线。</p></div>
      <div class="editor-section settings-section"><div class="section-label"><span><b>02</b> 赛道设定</span><i data-lucide="settings-2"></i></div>
      <label class="range-label" for="width-range"><span>赛道宽度</span><output id="width-output">10 <small>m</small></output></label><input id="width-range" type="range" min="6" max="18" step="1" value="10"/><div class="range-extents"><span>窄 · 技术型</span><span>宽 · 高速型</span></div>
      <label class="range-label smooth-label" for="smooth-range"><span>曲线平滑度</span><output id="smooth-output">60<small>%</small></output></label><input id="smooth-range" type="range" min="0" max="100" step="5" value="60"/>
      <div class="toggle-row"><label for="curbs-toggle"><i data-lucide="flag"></i><span>弯道路肩<small>根据弯道曲率自动生成</small></span></label><input class="switch" type="checkbox" id="curbs-toggle" checked/></div>
      <div class="free-boundary"><i data-lucide="shield"></i><span>开放边界<small>已移除护栏与空气墙，可自由驶出赛道。</small></span></div>
      </div>
      <div class="editor-section analysis-section"><div class="section-label"><span><b>03</b> 赛道分析</span><span class="analysis-badge"><span class="status-dot"></span>实时识别</span></div><div class="analysis-grid"><div><span>赛道全长</span><strong id="stat-length">— <small>m</small></strong></div><div><span>弯道数量</span><strong id="stat-corners">— <small>个</small></strong></div><div><span>急弯数量</span><strong id="stat-hairpins">— <small>个</small></strong></div><div><span>直道占比</span><strong id="stat-straights">— <small>%</small></strong></div></div></div>
      <div class="file-actions"><button id="export-button"><i data-lucide="arrow-down-to-line"></i>导出 JSON</button><span></span><button id="import-button"><i data-lucide="arrow-up-from-line"></i>导入赛道</button></div>
    </div>
    <div class="panel-footer"><button class="generate-button" id="generate-button"><span><i data-lucide="sparkles"></i>生成赛道</span><i data-lucide="arrow-up-right"></i></button><p><span class="status-dot"></span>平滑曲线 · 智能路肩 · 实时物理</p></div>
  </aside>
</main>
<div id="toast" class="toast" role="status" aria-live="polite"></div>
<input type="file" id="file-input" accept="application/json,.json" hidden/>
<dialog id="help-dialog"><div class="dialog-head"><div><span class="eyebrow">A QUICK PIT STOP</span><h2>准备好，向弯心出发。</h2></div><button class="icon-button close-help" aria-label="关闭说明"><i data-lucide="x"></i></button></div><div class="help-columns"><div><h3>驾驶控制</h3><p><kbd>W</kbd><kbd>↑</kbd><span>加速</span></p><p><kbd>S</kbd><kbd>↓</kbd><span>刹车 · 停稳后倒车</span></p><p><kbd>A</kbd><kbd>D</kbd><span>左 / 右转向</span></p><p><kbd>Space</kbd><span>手刹漂移</span></p><p><kbd>R</kbd><span>在最近路段复位</span></p><p><kbd>C</kbd><span>切换驾驶视角</span></p><p><kbd>Esc</kbd><span>暂停 / 继续</span></p></div><div><h3>赛道工坊</h3><p class="help-text">选择画笔，在画布上一笔画出不交叉的环线。松手后自动闭合和平滑；选择控制点工具可以左键拖动、右键删点。可导入底图描线，用高度层绘制地形。</p><p class="help-text">浅青色表示直道，绿色表示缓弯，青柠色表示急弯。点击「生成赛道」将布局送入 3D 世界。</p><p class="help-text">保存会保留在当前浏览器；导出 JSON 可以备份或分享。手机和平板可用屏幕踏板驾驶。</p></div></div><div class="physics-note"><i data-lucide="grip"></i><span>真实刚体碰撞 + 四轮射线悬挂，包含轮胎滑移、后轮驱动与空气阻力。属于可玩的物理原型，参数尚未经实车标定。</span></div><button class="generate-button close-help">知道了，去跑一圈 <i data-lucide="arrow-up-right"></i></button></dialog>
<div class="error-overlay" id="error-overlay" hidden><h2>3D 场景暂时无法启动</h2><p id="error-message"></p><button onclick="location.reload()">重新加载</button></div>
`;
icons();
let toastTimer:number;
function toast(message:string){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=window.setTimeout(()=>$('#toast').classList.remove('visible'),3300);}
let settings:TrackSettings={...DEFAULT_SETTINGS};
let currentName=PRESETS[0].name,appliedPoints=PRESETS[0].points.map(p=>({...p})),appliedSettings={...settings};
let draftRoute:RouteMetadata|undefined,appliedRoute:RouteMetadata|undefined,savedTerrain:TerrainField|undefined;
const saved=safeStorage.get('apex-track-v1');if(saved)try{const file=parseTrackFile(saved);if(file.route?.circuitId==='nordschleife'){const replacement=CIRCUIT_LIBRARY.find(c=>c.id==='daytona-road')!;file.name=replacement.name;file.points=file.route.scale==='native'?replacement.nativePoints:replacement.compactPoints;file.route.circuitId=replacement.id;file.terrain=undefined;}currentName=file.name;settings={...file.settings,barriers:false};appliedPoints=file.points;appliedSettings={...settings};draftRoute=file.route;appliedRoute=file.route;savedTerrain=file.terrain?parseTerrain(file.terrain):undefined;}catch{/* A corrupt browser save must not prevent the default circuit from loading. */}
let appliedTerrain=savedTerrain??TerrainField.around(appliedPoints);
let currentTrack=buildTrack(appliedPoints,settings,appliedRoute?{preserveLayout:true,allowCrossings:true}:{});
const editor=new TrackEditor($('#track-canvas'),settings);
const reference=new ReferenceImageLayer($('#reference-canvas'),$('#reference-controls'));reference.onchange=has=>{editor.hasReference=has;editor.draw();};
editor.options=appliedRoute?{preserveLayout:true,allowCrossings:true}:{};
let draftTrack:TrackData|null=currentTrack,draftName=currentName,dirty=false;
let terrainPainter:TerrainPainter|undefined;
let game:GameScene|null=null;
const physics=new KartPhysics();
const savedVehicle=safeStorage.get('apex-vehicle-v1');if(savedVehicle==='rb20')physics.setVehicle('rb20');
const audio=new EngineAudio();
audio.setVehicle(physics.profile.id);
const pedals=new PedalHistory();
const timing=new SectorTiming();
const lapCard=mountLapTimes($('#lap-history'));
function renderLapCard(){lapCard.update({currentTime:timing.time,currentLap:timing.lap,currentInvalid:timing.invalid,history:timing.history.slice()});}
let soundTouched=false;
let running=false,paused=false,countingDown=false,countdown=0,goDisplay=0,lapTime=0,lapNumber=1,bestTime=Infinity,checkpoint=0,lapStarted=false;
let lastProgress=0,lastTime=performance.now(),hudElapsed=0,fpsAccum=0,fpsFrames=0;
const keys=new Set<string>(),touchKeys=new Set<string>();
const vehiclePicker=mountVehiclePicker($('#vehicle-picker'),selectVehicle);vehiclePicker.update(physics.profile.id);updateVehicleLabels();

function updateVehicleLabels(){
  const spec=physics.profile,f1=spec.id==='rb20';
  $('#vehicle-size').textContent=f1?'2024 WORLD CHAMPION · ≈ 2.00 × 5.60 m':'YOUR KART · 1.35 × 1.80 m';
  $('#vehicle-name').textContent=spec.name;$('#vehicle-engine').textContent=f1?'V6 TURBO HYBRID':'4-STROKE';
  $('#vehicle-weight').innerHTML=`${spec.mass} <small>kg${f1?' MIN.':''}</small>`;$('#vehicle-capacity').innerHTML=`${f1?'1600':'200'} <small>cc</small>`;
  $('.color-options').hidden=f1;$('#vehicle-source').hidden=!f1;$('.timing-driver>div>span').textContent=spec.number;
}
function selectVehicle(id:VehicleId){
  if(physics.profile.id===id)return;if(running)exitDrive();
  physics.setVehicle(id);game?.setVehicle();audio.setVehicle(id);vehiclePicker.update(id);safeStorage.set('apex-vehicle-v1',id);
  if(id==='kart')game?.setColor($<HTMLButtonElement>('.color-swatch.selected').dataset.color!);
  timing.reset();pedals.reset();renderLapCard();bestTime=Infinity;updateVehicleLabels();toast(id==='rb20'?'已选择 2024 RB20 · V6 混动 / 自动八挡 / Halo':'已选择 200cc 卡丁车');
}

function setStatus(message:string,error=false){$('#editor-status').textContent=message;$('#editor-status').classList.toggle('error',error);}
function updateStats(track:TrackData|null){for(const [id,value,unit] of [['length',track?Math.round(track.length):'—','m'],['corners',track?.corners??'—','个'],['hairpins',track?.hairpins??'—','个'],['straights',track?.straightPercent??'—','%']] as const)$(`#stat-${id}`).innerHTML=`${value} <small>${unit}</small>`;}
function syncSettings(){const w=$<HTMLInputElement>('#width-range'),s=$<HTMLInputElement>('#smooth-range');w.value=String(settings.width);s.value=String(settings.smoothness);w.style.setProperty('--progress',`${(settings.width-6)/12*100}%`);s.style.setProperty('--progress',`${settings.smoothness}%`);$('#width-output').innerHTML=`${settings.width} <small>m</small>`;$('#smooth-output').innerHTML=`${settings.smoothness}<small>%</small>`;$<HTMLInputElement>('#curbs-toggle').checked=settings.curbs;}
editor.onChange=(points,track,error)=>{draftTrack=track;dirty=true;updateStats(track);terrainPainter?.draw();$<HTMLButtonElement>('#generate-button').disabled=!track;setStatus(error||(!points.length?'选择画笔，一笔画出你的闭合赛道。':'布局已更新，点击「生成赛道」应用到 3D。'),!!error);};
editor.setPoints(appliedPoints,false);dirty=false;setStatus('拖动控制点，微调你的走线。');syncSettings();updateTrackLabels();
terrainPainter=new TerrainPainter($('#height-canvas'),appliedTerrain.clone(),p=>editor.project(p),(x,y)=>editor.unproject(x,y));
terrainPainter.onChange=()=>{dirty=true;updateTerrainControls();setStatus('高度已更新，点击「生成赛道」同步 3D 与物理碰撞。');};terrainPainter.setActive(false);updateTerrainControls();
document.querySelectorAll<HTMLElement>('[data-preset]').forEach(b=>b.classList.toggle('selected',PRESETS.find(p=>p.id===b.dataset.preset)?.name===currentName));
function updateTrackLabels(){
  $('#track-name').textContent=currentName;$('#race-track-name').textContent=currentName;$('#track-length-label').textContent=`${Math.round(currentTrack.length)} m`;$('#track-corners-label').textContent=`${currentTrack.corners} 个弯道`;$('#difficulty-label').textContent=currentTrack.hairpins>3?'技术型':currentTrack.straightPercent>48?'高速型':'流畅型';
}
function setEditorVisible(visible:boolean){document.body.classList.toggle('drive-mode',!visible);$('#editor-tab').classList.toggle('active',visible);$('#drive-tab').classList.toggle('active',!visible);}
function setCamera(mode:CameraMode){game?.setCamera(mode);document.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach(b=>b.classList.toggle('selected',b.dataset.camera===mode));}
function applyDraft(){
  if(!draftTrack||!game)return;
  currentTrack=draftTrack;appliedPoints=editor.points.map(p=>({...p}));appliedSettings={...settings,barriers:false};currentName=draftName;appliedRoute=draftRoute;appliedTerrain=terrainPainter!.field.clone();
  physics.setTrack(currentTrack,appliedSettings,appliedTerrain);game.setTrack(currentTrack,appliedSettings,appliedTerrain);bestTime=Infinity;dirty=false;
  updateTrackLabels();setStatus('赛道已就绪，去找你的最佳走线。');toast('赛道生成完成，所有弯道已重新分析。');
}
function bestKey(){let h=2166136261;for(const c of JSON.stringify({points:appliedPoints,settings:appliedSettings,terrain:appliedTerrain.toJSON()})){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return `apex-best-${(h>>>0).toString(16)}${physics.profile.id==='kart'?'':'-rb20'}`;}
function startDrive(){
  if(!game)return;if(dirty&&draftTrack)applyDraft();
  if(!currentTrack)return;
  pedals.reset();timing.reset();renderLapCard();if(!soundTouched){soundTouched=true;void audio.setEnabled(true).then(updateSoundButton).catch(()=>toast('点击顶栏声音按钮启用引擎音效。'));}
  physics.reset();keys.clear();touchKeys.clear();running=true;paused=false;countingDown=true;countdown=3;goDisplay=0;physics.setStaged(true);lapTime=0;lapNumber=1;checkpoint=0;lapStarted=false;lastProgress=0;
  bestTime=Number(safeStorage.get(bestKey()))||Infinity;
  document.body.classList.add('is-driving');setEditorVisible(false);setCamera('chase');
  for(const id of ['session-top','driving-hud','race-actions','mobile-controls','pedal-panel','sector-bars','lap-history'])$(`#${id}`).hidden=false;
  for(const id of ['session-card','kart-spec'])$(`#${id}`).hidden=true;
  $('#controls-hint').innerHTML=`<span><kbd>W A S D</kbd> 驾驶</span><span>${physics.profile.id==='rb20'?'8-SPEED AUTO':'<kbd>Space</kbd> 手刹'}</span><span><kbd>R</kbd> 复位</span><span class="hint-extra"><kbd>C</kbd> 视角 <kbd>Esc</kbd> 暂停</span>`;
  $('#render-status').textContent='物理模拟运行中';$('#pause-button').innerHTML='<i data-lucide="pause"></i>';icons();
}
function exitDrive(){
  running=false;paused=false;countingDown=false;physics.setStaged(false);keys.clear();touchKeys.clear();physics.input={throttle:0,brake:0,steer:0,handbrake:false,reverse:false};
  document.body.classList.remove('is-driving');setEditorVisible(true);setCamera('orbit');
  for(const id of ['session-top','driving-hud','race-actions','mobile-controls','center-message','pedal-panel','sector-bars','lap-history'])$(`#${id}`).hidden=true;
  for(const id of ['session-card','kart-spec'])$(`#${id}`).hidden=false;
  $('#controls-hint').innerHTML='<span><kbd>拖动</kbd> 旋转视角</span><span><kbd>滚轮</kbd> 缩放</span><span class="hint-extra">探索你的赛道</span>';$('#render-status').textContent='3D 实时预览';
}
function pause(){if(!running)return;paused=!paused;keys.clear();touchKeys.clear();$('#center-message').hidden=!paused;$('#center-message').innerHTML=paused?'<span class="pause-title">休息一拍。</span><small>按 Esc 或点击暂停键继续</small>':'';$('#pause-button').innerHTML=`<i data-lucide="${paused?'play':'pause'}"></i>`;$('#pause-button').setAttribute('aria-label',paused?'继续':'暂停');icons();}
function resetKart(){if(!running)return;const near=nearestOnTrack(currentTrack,physics.body.position);physics.reset(near.index);if(countingDown)physics.setStaged(true);keys.clear();touchKeys.clear();pedals.reset();timing.time=0;timing.start=0;timing.sector=0;timing.splits=[];timing.invalid=false;timing.previousProgress=near.index/currentTrack.samples.length;lapTime=0;lapStarted=false;checkpoint=0;lastProgress=near.index/currentTrack.samples.length;toast('已在最近路段复位，本圈计时已重置。');}

document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(b=>b.addEventListener('click',()=>{editor.setTool(b.dataset.tool as any);document.querySelectorAll('[data-tool]').forEach(x=>x.classList.toggle('selected',x===b));setStatus(b.dataset.tool==='draw'?'按住鼠标或手指，一笔画出不交叉的环线。':'拖动圆点，调整路线；点击生成应用。');}));
document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(b=>b.addEventListener('click',()=>{const p=PRESETS.find(p=>p.id===b.dataset.preset)!;draftRoute=undefined;editor.options={};draftName=p.name;editor.setPoints(p.points);terrainPainter!.setField(TerrainField.around(p.points));updateTerrainControls();editor.setTool('edit');document.querySelectorAll('[data-tool]').forEach(x=>x.classList.toggle('selected',(x as HTMLElement).dataset.tool==='edit'));document.querySelectorAll('[data-preset]').forEach(x=>x.classList.toggle('selected',x===b));}));
$('#new-button').addEventListener('click',()=>{draftRoute=undefined;editor.options={};editor.clear();terrainPainter!.setField(new TerrainField());updateTerrainControls();draftName='我的手绘赛道';document.querySelectorAll('[data-preset]').forEach(x=>x.classList.remove('selected'));document.querySelectorAll('[data-tool]').forEach(x=>x.classList.toggle('selected',(x as HTMLElement).dataset.tool==='draw'));$('#track-canvas').focus();});
$('#clear-button').addEventListener('click',()=>$('#new-button').click());$('#undo-button').addEventListener('click',()=>editor.undo());
$('#width-range').addEventListener('input',e=>{settings.width=Number((e.target as HTMLInputElement).value);syncSettings();editor.updateSettings(settings);});
$('#smooth-range').addEventListener('input',e=>{settings.smoothness=Number((e.target as HTMLInputElement).value);syncSettings();editor.updateSettings(settings);});
$('#curbs-toggle').addEventListener('change',e=>{settings.curbs=(e.target as HTMLInputElement).checked;editor.updateSettings(settings);});
function updateTerrainControls(){if(!terrainPainter)return;terrainPainter.radius=terrainPainter.field.size*Number($<HTMLInputElement>('#brush-radius').value)/500;terrainPainter.strength=Number($<HTMLInputElement>('#brush-strength').value);$('#brush-radius-output').textContent=`${Math.round(terrainPainter.radius)} m`;$('#brush-strength-output').textContent=`${terrainPainter.strength} m/s`;$('#height-range').textContent=`${terrainPainter.field.min.toFixed(1)} — ${terrainPainter.field.max.toFixed(1)} m`;}
document.querySelectorAll<HTMLButtonElement>('[data-layer]').forEach(b=>b.addEventListener('click',()=>{const height=b.dataset.layer==='height';terrainPainter!.setActive(height);$('#terrain-tools').hidden=!height;document.querySelectorAll('[data-layer]').forEach(x=>x.classList.toggle('selected',x===b));$('#layer-badge').textContent=height?'羽化高度笔刷':'自动平滑';}));
document.querySelectorAll<HTMLButtonElement>('[data-brush]').forEach(b=>b.addEventListener('click',()=>{terrainPainter!.mode=b.dataset.brush as BrushMode;document.querySelectorAll('[data-brush]').forEach(x=>x.classList.toggle('selected',x===b));}));
for(const id of ['brush-radius','brush-strength'])$(`#${id}`).addEventListener('input',updateTerrainControls);
$('#height-visible').addEventListener('change',e=>{terrainPainter!.visible=(e.target as HTMLInputElement).checked;terrainPainter!.draw();});$('#undo-height').addEventListener('click',()=>terrainPainter!.undo());$('#clear-height').addEventListener('click',()=>terrainPainter!.clear());
$('#load-circuit').addEventListener('click',()=>{const c=CIRCUIT_LIBRARY.find(c=>c.id===$<HTMLSelectElement>('#circuit-select').value);if(!c){toast('先选择一条赛道。');return;}const scale=$<HTMLSelectElement>('#circuit-scale').value as 'native'|'compact';draftRoute={circuitId:c.id,scale};draftName=c.name;editor.options={preserveLayout:true,allowCrossings:true};settings.width=scale==='native'?12:6;editor.settings={...settings};const points=scale==='native'?c.nativePoints:c.compactPoints;editor.setPoints(points);terrainPainter!.setField(TerrainField.around(points));syncSettings();updateTerrainControls();$('#library-info').textContent=`${c.country} · 实际 ${(c.officialLengthM/1000).toFixed(3)} km · ${scale==='native'?'原尺寸':'等比缩放'}。线形近似，无实测高程。${c.calendarStatus==='original-2026'?'原定赛历布局。':''}`;applyDraft();});
$('#circuit-select').title=F1_CALENDAR_NOTE;
$('#generate-button').addEventListener('click',applyDraft);$('#start-button').addEventListener('click',startDrive);$('#drive-tab').addEventListener('click',()=>running?setEditorVisible(false):startDrive());$('#editor-tab').addEventListener('click',()=>{if(running)exitDrive();else setEditorVisible(true);});$('#exit-button').addEventListener('click',exitDrive);$('#pause-button').addEventListener('click',pause);$('#reset-button').addEventListener('click',resetKart);
document.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach(b=>b.addEventListener('click',()=>setCamera(b.dataset.camera as CameraMode)));
document.querySelectorAll<HTMLButtonElement>('[data-color]').forEach(b=>b.addEventListener('click',()=>{game?.setColor(b.dataset.color!);document.querySelectorAll('[data-color]').forEach(x=>x.classList.toggle('selected',x===b));}));
function updateSoundButton(){const enabled=audio.enabled;$('#sound-button').innerHTML=`<i data-lucide="${enabled?'volume-2':'volume-x'}"></i>`;$('#sound-button').setAttribute('aria-label',enabled?'关闭引擎声音':'开启引擎声音');icons();}
$('#sound-button').addEventListener('click',async()=>{soundTouched=true;try{await audio.toggle();updateSoundButton();toast(audio.enabled?(physics.profile.id==='rb20'?'V6 涡轮混动合成音效已开启':'200cc 单缸四冲程合成音效已开启'):'引擎声音已关闭');}catch{toast('当前浏览器暂时无法启动音频。');}});
function trackFile():TrackFile{return {version:2,name:draftName,points:editor.points,settings:{...settings,barriers:false},terrain:terrainPainter!.field.toJSON(),route:draftRoute};}
$('#save-button').addEventListener('click',()=>{if(!draftTrack){toast('请先画出一条有效赛道。');return;}toast(safeStorage.set('apex-track-v1',JSON.stringify(trackFile()))?'赛道已保存到此浏览器，下次打开会自动恢复。':'浏览器存储不可用，请使用「导出 JSON」备份。');});
$('#export-button').addEventListener('click',()=>{if(!draftTrack){toast('请先画出一条有效赛道。');return;}const blob=new Blob([JSON.stringify(trackFile(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`apex-${draftName}.json`;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),2000);toast('赛道 JSON 已导出。');});
$('#import-button').addEventListener('click',()=>$<HTMLInputElement>('#file-input').click());
$('#file-input').addEventListener('change',async e=>{const input=e.target as HTMLInputElement,file=input.files?.[0];if(!file)return;try{if(file.size>3e6)throw new Error('文件太大，请使用小于 3 MB 的赛道 JSON。');const data=parseTrackFile(await file.text());settings={...data.settings};draftName=data.name;draftRoute=data.route;editor.options=data.route?{preserveLayout:true,allowCrossings:true}:{};editor.settings={...settings};syncSettings();editor.setPoints(data.points);terrainPainter!.setField(data.terrain?parseTerrain(data.terrain):TerrainField.around(data.points));updateTerrainControls();document.querySelectorAll('[data-preset]').forEach(x=>x.classList.remove('selected'));toast('赛道已导入，点击「生成赛道」预览。');}catch(error){toast((error as Error).message);}input.value='';});
$('#help-button').addEventListener('click',()=>{if(running&&!paused)pause();$<HTMLDialogElement>('#help-dialog').showModal();});document.querySelectorAll('.close-help').forEach(b=>b.addEventListener('click',()=>$<HTMLDialogElement>('#help-dialog').close()));$<HTMLDialogElement>('#help-dialog').addEventListener('click',e=>{if(e.target===$('#help-dialog'))$<HTMLDialogElement>('#help-dialog').close();});
$('#fullscreen-button').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('.viewport').requestFullscreen();}catch{toast('当前浏览器不支持全屏，可以缩放页面查看。');}});
window.addEventListener('keydown',e=>{
  const target=e.target as HTMLElement;if(target.matches('input,textarea,select'))return;
  if($<HTMLDialogElement>('#help-dialog').open)return;
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)&&running)e.preventDefault();
  if(e.repeat){keys.add(e.code);return;}
  if(e.code==='Escape'){if(running)pause();return;}if(e.code==='KeyR'){resetKart();return;}
  if(e.code==='KeyC'&&running){const modes:CameraMode[]=['chase','top','cockpit','orbit'];setCamera(modes[(modes.indexOf(game?.mode||'chase')+1)%modes.length]);return;}
  if((e.ctrlKey||e.metaKey)&&e.code==='KeyZ'&&!running){e.preventDefault();if(terrainPainter?.active)terrainPainter.undo();else editor.undo();return;}
  keys.add(e.code);
});window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{keys.clear();touchKeys.clear();if(running&&!paused)pause();});document.addEventListener('visibilitychange',()=>{if(document.hidden&&running&&!paused)pause();});
document.querySelectorAll<HTMLButtonElement>('[data-control]').forEach(b=>{const release=()=>{touchKeys.delete(b.dataset.control!);b.classList.remove('pressed');};b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);touchKeys.add(b.dataset.control!);b.classList.add('pressed');});b.addEventListener('pointerup',release);b.addEventListener('pointercancel',release);b.addEventListener('lostpointercapture',release);});

function updateLap(dt:number){
 const near=nearestOnTrack(currentTrack,physics.body.position),progress=near.index/currentTrack.samples.length;
 const complete=timing.update(dt,progress,near.distance<currentTrack.width/2+1,physics.telemetry.signedSpeed>1,physics.trackLimitsExceeded);lapTime=timing.time;lapNumber=timing.lap;
 if(complete){physics.clearTrackLimits();const lap=timing.history[0];if(lap.time<bestTime){bestTime=lap.time;safeStorage.set(bestKey(),String(bestTime));toast('新最佳圈速 '+formatTime(bestTime));}}
 document.querySelectorAll<HTMLElement>('[data-sector]').forEach((bar,i)=>{bar.className='sector-bar '+(i<timing.sector?timing.colors[i]:i===timing.sector?'active':'pending');bar.querySelector<HTMLElement>('i')!.style.width=Math.max(0,Math.min(1,progress*3-i))*100+'%';bar.querySelector('small')!.textContent=(timing.splits[i]??(i===timing.sector?timing.time-timing.start:0)).toFixed(3).padStart(6,'0');});
}
function updateHUD(){const t=physics.telemetry;pedals.draw($('#pedal-chart'));$('#throttle-percent').textContent=Math.round(physics.input.throttle*100)+'%';$('#brake-percent').textContent=Math.round(t.brakeApplied*100)+'%';$('#brake-demand-percent').textContent=Math.round(physics.input.brake*100)+'%';$('#abs-status').textContent=t.absActive?'ABS 限制中':'ABS 待命';$('#abs-status').classList.toggle('active',t.absActive);$('#speed').textContent=String(Math.round(t.speed));$('#gear').textContent=t.signedSpeed<-1?'R':t.speed<1?'N':physics.profile.id==='rb20'?String(t.gear||1):'D';$('#rpm-label').textContent=`${Math.round(t.rpm/100)*100} RPM`;renderLapCard();$('#broadcast-lap').textContent=formatTime(lapTime);$('#surface-label').textContent=t.offroad?'草地 · 抓地降低':t.runoff?'沥青缓冲区 · 正常抓地':'干燥沥青';$('#grip-label').textContent=t.offroad?'草地低抓地':t.grip<.65?'轮胎滑移':'正常抓地';$('#g-dot').style.transform=`translate(${Math.max(-22,Math.min(22,t.lateralG*15))}px,${Math.max(-22,Math.min(22,t.longitudinalG*15))}px)`;document.querySelectorAll<HTMLElement>('.rpm-bars span').forEach((b,i)=>b.classList.toggle('lit',i<Math.round(t.rpm/physics.profile.maxRPM*22)));}
function animate(now:number){
  const dt=Math.min((now-lastTime)/1000,.06);lastTime=now;
  if(game){
    if(running&&!paused){
      if(countingDown){countdown=Math.max(0,countdown-dt);if(countdown===0){countingDown=false;physics.setStaged(false);goDisplay=.8;}else{physics.step(dt);$('#center-message').hidden=false;$('#center-message').innerHTML=`<span class="countdown-number">${Math.ceil(countdown)}</span><small>找到节奏，瞄准弯心。</small>`;}}
      if(!countingDown){
        if(goDisplay>0){goDisplay-=dt;$('#center-message').hidden=false;$('#center-message').innerHTML='<span class="countdown-go">GO.</span>';}else $('#center-message').hidden=true;
        const accel=keys.has('KeyW')||keys.has('ArrowUp')||touchKeys.has('throttle'),brake=keys.has('KeyS')||keys.has('ArrowDown')||touchKeys.has('brake'),left=keys.has('KeyA')||keys.has('ArrowLeft')||touchKeys.has('left'),right=keys.has('KeyD')||keys.has('ArrowRight')||touchKeys.has('right');
        physics.input={throttle:accel?1:0,brake:brake&&physics.telemetry.signedSpeed>1?1:0,reverse:brake&&physics.telemetry.signedSpeed<=1&&!accel,steer:(left?1:0)-(right?1:0),handbrake:keys.has('Space')};physics.step(dt);pedals.record(dt,physics.input.throttle,physics.telemetry.brakeApplied,physics.input.brake);updateLap(dt);
        if(!Number.isFinite(physics.body.position.y)||physics.body.position.y< -90)resetKart();
      }
    }else if(!running){physics.input={throttle:0,brake:.4,steer:0,handbrake:false,reverse:false};physics.step(dt);}
    game.update(dt,running&&!paused);audio.update(physics.telemetry.rpm,physics.input.throttle,running&&!paused&&!countingDown,physics.telemetry.speed,physics.telemetry.kerbLeft,physics.telemetry.kerbRight,game.tyreSquealLeft,game.tyreSquealRight);
    hudElapsed+=dt;if(hudElapsed>.05){if(running)updateHUD();hudElapsed=0;}
  }
  fpsAccum+=dt;fpsFrames++;if(fpsAccum>1){$('#fps').textContent=`${Math.round(fpsFrames/fpsAccum)} FPS`;fpsAccum=0;fpsFrames=0;}
  requestAnimationFrame(animate);
}
try{game=new GameScene($('#scene-container'),physics);physics.setTrack(currentTrack,settings,appliedTerrain);game.setTrack(currentTrack,settings,appliedTerrain);game.onContextLost=()=>{if(running&&!paused)pause();toast('图形上下文中断，请重新加载页面恢复 3D。');};$('#loading-screen').classList.add('loaded');window.setTimeout(()=>$('#loading-screen').remove(),700);requestAnimationFrame(animate);}
catch(error){$('#loading-screen').remove();$('#error-overlay').hidden=false;$('#error-message').textContent=`请使用支持 WebGL 2 的浏览器并开启硬件加速。${(error as Error).message}`;}

// Read-only state for reproducible browser QA and integrations.
Object.defineProperty(window,'apex',{get:()=>({track:currentTrack,physics,editor,game,running,paused,countingDown,lapTime,lapNumber,checkpoint,dirty,terrainPainter,pedals,timing,audio,reference})});

