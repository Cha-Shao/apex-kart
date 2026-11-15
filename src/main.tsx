import './style.css';
import './broadcast.css';
import './start-signal.css';
import './gamepad.css';
import './editor-cards.css';
import {GamepadController} from './gamepad';
import {gamepadGuide} from './gamepad-guide';
import './reference-image.css';
import {ReferenceImageLayer} from './reference-image';
import {SectorTiming} from './timing';
import {mountLapTimes} from './components/LapTimes';
import {mountVehiclePicker} from './components/VehiclePicker';
import {type VehicleId} from './vehicles';
import { createIcons, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, ArrowDownToLine, ArrowUpFromLine, Gamepad2, Check, ChevronDown, CircleHelp, Focus, Fullscreen, Gauge, Grip, Maximize2, MousePointer2, Pause, Pencil, Play, Redo2, RotateCcw, Save, Settings2, Sparkles, Sun, Trash2, Undo2, Volume2, VolumeX, X } from 'lucide';
import { bridgeHeight, buildTrack, DEFAULT_SETTINGS, nearestOnTrack, parseTrackFile, type RouteMetadata, type TrackData, type TrackFile, type TrackSettings } from './track';
import { TrackEditor } from './editor';
import { KartPhysics } from './physics';
import { GameScene, type CameraMode } from './scene';
import {START_LIGHT_COUNT,StartSequence} from './start-signal';
import { EngineAudio } from './audio';
import { TerrainField, TerrainPainter, parseTerrain, type BrushMode } from './terrain';
import { PedalHistory } from './telemetry';
import { CIRCUIT_LIBRARY, F1_CALENDAR_NOTE } from './circuit-library';
import {circuitTerrain} from './preset-terrain';

const iconSet={ArrowUp,ArrowDown,ArrowLeft,ArrowRight,ArrowUpRight,ArrowDownToLine,ArrowUpFromLine,Gamepad2,Check,ChevronDown,CircleHelp,Focus,Fullscreen,Gauge,Grip,Maximize2,MousePointer2,Pause,Pencil,Play,Redo2,RotateCcw,Save,Settings2,Sparkles,Sun,Trash2,Undo2,Volume2,VolumeX,X};
const icons=()=>createIcons({icons:iconSet,attrs:{'stroke-width':1.6}});
const $=<T extends HTMLElement=HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
const formatTime=(seconds:number)=>{if(!Number.isFinite(seconds))return '—:——.———';const m=Math.floor(seconds/60),s=Math.floor(seconds%60),cs=Math.floor(seconds%1*1000);return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(3,'0')}`;};
const safeStorage={get(key:string){try{return localStorage.getItem(key);}catch{return null;}},set(key:string,value:string){try{localStorage.setItem(key,value);return true;}catch{return false;}}};
const defaultCircuit=CIRCUIT_LIBRARY.find(c=>c.id==='shanghai')!;

$('#app').innerHTML=`
<header class="topbar">
  <a class="brand" href="#" aria-label="APEX 首页"><span class="brand-mark"><svg viewBox="0 0 36 36"><path d="M4 29 16 6h6l11 23h-8l-6-15-4 8h7l3 7Z"/></svg></span><span class="wordmark">APEX<span class="brand-separator">/</span><span class="brand-sub">卡丁车实验室</span></span></a>
  <nav class="main-nav" aria-label="工作模式"><button class="nav-button" id="drive-tab"><i data-lucide="gauge"></i>自由试驾</button><button class="nav-button active" id="editor-tab"><i data-lucide="pencil"></i>赛道工坊<span class="new-tag">BETA</span></button></nav>
  <div class="header-actions"><button type="button" id="gamepad-status" class="icon-button gamepad-status" data-state="waiting" aria-label="手柄：按任意键识别，点击查看操作说明" title="手柄：按任意键识别；点击查看操作说明"><i data-lucide="gamepad-2"></i><span class="gamepad-label">手柄</span></button><button class="icon-button" id="sound-button" aria-label="开启引擎声音" title="引擎声音"><i data-lucide="volume-x"></i></button><button class="icon-button" id="help-button" aria-label="操作说明" title="操作说明"><i data-lucide="circle-help"></i></button><span class="divider"></span><button class="save-button" id="save-button"><i data-lucide="save"></i><span>保存赛道</span></button></div>
</header>
<main class="workspace">
  <section class="viewport" aria-label="赛道 3D 视图">
    <div id="scene-container"></div>
    <div class="view-vignette"></div>
    <div class="viewport-top"><div class="weather"><i data-lucide="sun"></i><span>晴 · 24°C</span><span class="weather-line"></span><span>干燥路面</span></div></div>
    <div class="session-top" id="session-top" hidden><div class="session-chip"><span class="live-dot"></span>自由练习<span class="session-divider">/</span><span id="race-track-name">${defaultCircuit.name}</span></div></div>
    <div class="lap-history" id="lap-history" hidden></div><div class="sector-bars" id="sector-bars" hidden><div class="timing-driver"><b>DRIVER</b><div><span>07</span><strong>YOU</strong></div></div><div class="sector-bar pending" data-sector="0"><b>SECTOR 1</b><div class="sector-value"><i></i><small>00.000</small></div></div><div class="sector-bar pending" data-sector="1"><b>SECTOR 2</b><div class="sector-value"><i></i><small>00.000</small></div></div><div class="sector-bar pending" data-sector="2"><b>SECTOR 3</b><div class="sector-value"><i></i><small>00.000</small></div></div><div class="timing-total"><b>LAP TIME</b><strong id="broadcast-lap">0:00.000</strong></div></div><div class="center-message" id="center-message" hidden></div>
    <div class="start-signal" id="start-signal" role="status" aria-live="polite" aria-atomic="true" hidden><div class="start-signal__rail" aria-hidden="true">${Array.from({length:START_LIGHT_COUNT},()=>'<span class="start-signal__lamp"></span>').join('')}</div><span id="start-signal-label" class="start-signal__label">等待红灯 · 熄灭起步</span></div>
    <div class="session-card" id="session-card"><div class="session-number">01<span>/ CIRCUIT</span></div><div class="session-info"><div class="session-title-row"><h2 id="track-name">${defaultCircuit.name}</h2><span class="difficulty-dot"></span><span class="difficulty-label" id="difficulty-label">技术型</span></div><p><span id="track-length-label">— m</span><span>·</span><span id="track-corners-label">— 个弯道</span><span>·</span><span>单人计时</span></p></div><button class="drive-button" id="start-button"><span>上车试驾</span><i data-lucide="arrow-up-right"></i></button></div>
    <div class="kart-spec" id="kart-spec"><span class="spec-label" id="vehicle-size">YOUR KART · 1.35 × 1.80 m</span><div class="kart-title"><strong id="vehicle-name">APX–07</strong> <span id="vehicle-engine">4-STROKE</span></div><div class="kart-details"><span id="vehicle-weight">165 <small>kg</small></span><span id="vehicle-capacity">200 <small>cc</small></span><div class="color-options" aria-label="车身颜色"><button class="color-swatch selected" data-color="#c4ed4c" style="--swatch:#c4ed4c" aria-label="青柠色车身"></button><button class="color-swatch" data-color="#e88161" style="--swatch:#e88161" aria-label="珊瑚色车身"></button><button class="color-swatch" data-color="#75c9cc" style="--swatch:#75c9cc" aria-label="冰蓝色车身"></button></div><a id="vehicle-source" href="/vehicle-credits.html" target="_blank" rel="noopener" hidden>公开规格 ↗</a></div></div>
    <div class="driving-hud" id="driving-hud" hidden><div class="g-meter"><span>轮胎抓地</span><div class="g-circle"><div class="g-horizontal"></div><div class="g-vertical"></div><b id="g-dot"></b></div><span id="grip-label">正常抓地</span></div><div class="speedometer"><div class="rpm-bars" id="rpm-bars">${Array.from({length:22},(_,i)=>`<span style="--bar:${i}"></span>`).join('')}</div><div class="speed-value"><strong id="speed">0</strong><div><b id="gear">N</b><span>KM/H</span></div></div><div class="speed-meta"><span><span class="status-dot"></span><span id="surface-label">干燥沥青</span></span><span id="rpm-label">1,600 RPM</span></div></div></div>
    <div class="race-actions" id="race-actions" hidden><button id="pause-button" class="round-action" aria-label="暂停"><i data-lucide="pause"></i></button><button id="reset-button" class="round-action" title="复位车辆 (R)" aria-label="复位车辆"><i data-lucide="rotate-ccw"></i></button><button id="exit-button" class="exit-button"><i data-lucide="pencil"></i><span>返回工坊</span></button></div>
    <div class="pedal-panel" id="pedal-panel" hidden><div class="pedal-heading"><span>驾驶输入 <small>最近 10 秒</small></span><div><span class="throttle-key">油门 <b id="throttle-percent">0%</b></span><span class="brake-key">实际刹车 <b id="brake-percent">0%</b></span></div></div><div class="pedal-assist-row"><span class="brake-demand-key">踏板 <b id="brake-demand-percent">0%</b><small>虚线 · 阴影为削减量</small></span><b id="abs-status" role="status">ABS 待命</b></div><canvas id="pedal-chart" width="300" height="105" aria-label="最近十秒油门、刹车踏板虚线与ABS实际刹车实线，阴影显示刹车削减量"></canvas></div>
    <div class="controls-hint" id="controls-hint"><span><kbd>拖动</kbd> 旋转视角</span><span><kbd>滚轮</kbd> 缩放</span><span class="hint-extra"><i data-lucide="mouse-pointer-2"></i>探索你的赛道</span></div>
    <div class="mobile-controls" id="mobile-controls" role="group" aria-label="触屏方向键驾驶控制" hidden>
      <button type="button" data-control="throttle" class="gas-pedal" aria-label="油门" title="油门"><i data-lucide="arrow-up" aria-hidden="true"></i></button>
      <button type="button" data-control="left" aria-label="左转" title="左转"><i data-lucide="arrow-left" aria-hidden="true"></i></button>
      <button type="button" data-control="brake" class="brake-pedal" aria-label="刹车，停稳后倒车" title="刹车 · 停稳后倒车"><i data-lucide="arrow-down" aria-hidden="true"></i></button>
      <button type="button" data-control="right" aria-label="右转" title="右转"><i data-lucide="arrow-right" aria-hidden="true"></i></button>
    </div>
    <div class="viewport-footer"><div class="render-status"><span class="status-dot"></span><span id="render-status">3D 实时预览</span><span class="status-slash">/</span><span id="fps">60 FPS</span><a class="asset-credits" href="/asset-credits.html" target="_blank" rel="noopener">CC0 素材 ↗</a></div><div class="camera-switch" role="group" aria-label="视角"><button class="selected" data-camera="orbit" title="环绕视角">环绕</button><button data-camera="chase" title="跟随视角 (C)">跟随</button><button data-camera="top" title="俯视视角">俯视</button><button data-camera="cockpit" title="驾驶员视角">座舱</button><span></span><button id="fullscreen-button" aria-label="全屏" title="全屏"><i data-lucide="maximize-2"></i></button></div></div>
    <div class="loading-screen" id="loading-screen"><div class="loading-mark">A<span>PEX</span></div><div class="loading-line"></div><p>正在准备你的赛道…</p></div>
  </section>
  <aside class="editor-panel" id="editor-panel">
    <div class="panel-scroll">
      <section class="workshop-card garage-card" aria-label="车型与驾驶辅助">
        <div id="vehicle-picker"></div>
        <div class="assist-row"><label for="abs-toggle"><strong>ABS</strong><small>防抱死驾驶辅助</small></label><input class="switch" id="abs-toggle" type="checkbox" checked/></div>
      </section>
      <section class="workshop-card track-card" aria-label="赛道选择与编辑">
        <div class="workshop-card-title"><h2>赛道与编辑</h2><button type="button" id="new-button" title="新建手绘赛道"><i data-lucide="pencil"></i>新建</button></div>
      <div class="library-block"><div class="section-label"><span>真实赛道库</span><span class="library-badge">2026 / DAYTONA</span></div><div class="library-select-row"><select id="circuit-select" aria-label="选择真实赛道"><option value="">选择 F1 赛道或戴托纳…</option>${(['current-2026','original-2026','bonus'] as const).map((status,i)=>`<optgroup label="${['2026 当前赛历','2026 原定布局（调整前）','耐力经典'][i]}">${CIRCUIT_LIBRARY.filter(c=>c.calendarStatus===status).map(c=>`<option value="${c.id}">${c.round?`${String(c.round).padStart(2,'0')} · `:''}${c.name}</option>`).join('')}</optgroup>`).join('')}</select></div><div class="library-load-row"><div id="circuit-scale" class="circuit-scale-tabs" role="tablist" aria-label="赛道尺寸"><button type="button" class="circuit-scale-tab" role="tab" data-scale="native" aria-selected="true" tabindex="0" aria-controls="library-info">原尺寸 · 1:1</button><button type="button" class="circuit-scale-tab" role="tab" data-scale="compact" aria-selected="false" tabindex="-1" aria-controls="library-info">卡丁车缩放版</button></div></div><p id="library-info">${CIRCUIT_LIBRARY.filter(c=>c.calendarStatus==='current-2026').length} 条现行 F1 布局 + 原定布局 + 戴托纳。<br>含 DEM 近似高程，载入后可用高度笔刷调整。</p><a class="library-credit" href="/circuit-credits.html" target="_blank" rel="noopener">赛历来源与数据许可 ↗</a></div>
      <div class="editor-section"><div class="section-label"><span><b>01</b> 绘制布局</span><div class="canvas-tools"><button class="tool" data-tool="draw" title="画笔：一笔画出闭合环线" aria-label="画笔工具"><i data-lucide="pencil"></i></button><button class="tool selected" data-tool="edit" title="拖动控制点调整路线" aria-label="控制点工具"><i data-lucide="mouse-pointer-2"></i></button><span></span><button class="tool" id="undo-button" title="撤销" aria-label="撤销"><i data-lucide="undo-2"></i></button><button class="tool" id="clear-button" title="清空画布" aria-label="清空画布"><i data-lucide="trash-2"></i></button></div></div>
      <div class="layer-tabs"><button class="selected" data-layer="route">路线控制点</button><button data-layer="height">地形高度层</button><label><input id="height-visible" type="checkbox" checked/>显示高度</label></div>
      <div id="reference-controls"></div><div class="canvas-wrap"><canvas id="reference-canvas" width="800" height="600" aria-hidden="true"></canvas><canvas id="track-canvas" aria-label="赛道绘制画布。使用画笔绘制，左键拖动控制点，右键删除控制点。" tabindex="0"></canvas><canvas id="height-canvas" aria-label="地形高度覆盖层。羽化笔刷绘制，Shift 或右键反向。"></canvas><span class="canvas-badge" id="layer-badge"><i data-lucide="sparkles"></i> 自动平滑</span><span class="canvas-corner">N ↑</span></div>
      <div class="terrain-tools" id="terrain-tools" hidden><div class="brush-modes"><button class="selected" data-brush="raise">抬高 ＋</button><button data-brush="lower">压低 −</button><button data-brush="smooth">平滑</button><button data-brush="flatten">归零</button></div><label class="range-label" for="brush-radius"><span>羽化半径</span><output id="brush-radius-output">24 m</output></label><input id="brush-radius" type="range" min="12" max="70" value="24"/><label class="range-label" for="brush-strength"><span>高度速率</span><output id="brush-strength-output">4 m/s</output></label><input id="brush-strength" type="range" min="1" max="12" value="4"/><div class="terrain-actions"><button id="undo-height"><i data-lucide="undo-2"></i>撤销高度</button><span id="height-range">0.0 — 0.0 m</span><button id="clear-height">清空高度</button></div><p>按住涂抹，边缘自动羽化。Shift / 右键反向；修改后自动同步路面与碰撞。</p></div>
      <div class="canvas-legend"><span><b class="legend-dot straight"></b>直道</span><span><b class="legend-dot curve"></b>缓弯</span><span><b class="legend-dot hairpin"></b>急弯</span><span class="auto-close"><i data-lucide="check"></i>自动闭合</span></div>
      <p class="editor-status" id="editor-status">拖动控制点，微调你的走线。</p></div>
      <div class="editor-section settings-section"><div class="section-label"><span><b>02</b> 赛道设定</span><i data-lucide="settings-2"></i></div>
      <label class="range-label" for="width-range"><span>赛道宽度</span><output id="width-output">10 <small>m</small></output></label><input id="width-range" type="range" min="6" max="18" step="1" value="10"/><div class="range-extents"><span>窄 · 技术型</span><span>宽 · 高速型</span></div>
      <label class="range-label smooth-label" for="smooth-range"><span>曲线平滑度</span><output id="smooth-output">60<small>%</small></output></label><input id="smooth-range" type="range" min="0" max="100" step="5" value="60"/>
      </div>
      <div class="file-actions"><button id="export-button"><i data-lucide="arrow-down-to-line"></i>导出 JSON</button><span></span><button id="import-button"><i data-lucide="arrow-up-from-line"></i>导入赛道</button></div>
      </section>
      <section class="workshop-card analysis-card" aria-label="赛道分析">
      <div class="editor-section analysis-section"><div class="section-label"><span><b>03</b> 赛道分析</span><span class="analysis-badge"><span class="status-dot"></span>实时识别</span></div><div class="analysis-grid"><div><span>赛道全长</span><strong id="stat-length">— <small>m</small></strong></div><div><span>弯道数量</span><strong id="stat-corners">— <small>个</small></strong></div><div><span>急弯数量</span><strong id="stat-hairpins">— <small>个</small></strong></div><div><span>直道占比</span><strong id="stat-straights">— <small>%</small></strong></div></div></div>
      </section>

    </div>
    <div class="panel-footer"><button type="button" id="panel-drive-button" class="primary-drive-button"><span>试驾</span><i data-lucide="arrow-up-right"></i></button></div>
  </aside>
</main>
<div id="toast" class="toast" role="status" aria-live="polite"></div>
<input type="file" id="file-input" accept="application/json,.json" hidden/>
<dialog id="help-dialog" data-help-view="gamepad" aria-labelledby="help-title"><div class="dialog-head"><div><span class="eyebrow">CONTROLS / 操作指南</span><h2 id="help-title">熟悉操作，即刻上场。</h2></div><button class="icon-button close-help" aria-label="关闭说明"><i data-lucide="x"></i></button></div><div class="help-tabs" role="tablist" aria-label="操作说明分类"><button type="button" id="help-gamepad-tab" role="tab" data-help-tab="gamepad" aria-selected="true" aria-controls="help-gamepad-panel">手柄控制</button><button type="button" id="help-keyboard-tab" role="tab" data-help-tab="keyboard" aria-selected="false" aria-controls="help-keyboard-panel" tabindex="-1">键盘与工坊</button></div><div id="help-gamepad-panel" role="tabpanel" aria-labelledby="help-gamepad-tab">${gamepadGuide}</div><div id="help-keyboard-panel" role="tabpanel" aria-labelledby="help-keyboard-tab" hidden><div class="help-columns"><div><h3>驾驶控制</h3><p><kbd>W</kbd><kbd>↑</kbd><span>加速</span></p><p><kbd>S</kbd><kbd>↓</kbd><span>刹车 · 停稳后倒车</span></p><p><kbd>A</kbd><kbd>D</kbd><span>左 / 右转向</span></p><p><kbd>Space</kbd><span>手刹漂移</span></p><p><kbd>R</kbd><span>回起点并重计当前圈</span></p><p><kbd>C</kbd><span>切换驾驶视角</span></p><p><kbd>Esc</kbd><span>暂停 / 继续</span></p></div><div><h3>赛道工坊</h3><p class="help-text">选择画笔，在画布上一笔画出不交叉的环线。松手后自动闭合和平滑；选择控制点工具可以左键拖动、右键删点。可导入底图描线，用高度层绘制地形。</p><p class="help-text">浅青色表示直道，绿色表示缓弯，青柠色表示急弯。修改后自动同步到 3D 世界。</p><p class="help-text">保存会保留在当前浏览器；导出 JSON 可以备份或分享。手机和平板可用屏幕踏板驾驶。</p></div></div><div class="physics-note"><i data-lucide="grip"></i><span>真实刚体碰撞 + 四轮射线悬挂，包含轮胎滑移、后轮驱动与空气阻力。属于可玩的物理原型，参数尚未经实车标定。</span></div></div><button class="generate-button close-help">知道了，去跑一圈 <i data-lucide="arrow-up-right"></i></button></dialog>
<div class="error-overlay" id="error-overlay" hidden><h2>3D 场景暂时无法启动</h2><p id="error-message"></p><button onclick="location.reload()">重新加载</button></div>
`;
icons();
let toastTimer:number;
function toast(message:string){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=window.setTimeout(()=>$('#toast').classList.remove('visible'),3300);}
let settings:TrackSettings={...DEFAULT_SETTINGS,width:12};
let currentName=defaultCircuit.name,appliedPoints=defaultCircuit.nativePoints.map(p=>({...p})),appliedSettings={...settings};
let draftRoute:RouteMetadata|undefined={circuitId:defaultCircuit.id,scale:'native'},appliedRoute:RouteMetadata|undefined=draftRoute,savedTerrain:TerrainField|undefined;
let restoredTrack=false;
const saved=safeStorage.get('apex-track-v1');if(saved)try{const file=parseTrackFile(saved);if(file.route?.circuitId==='nordschleife'){const replacement=CIRCUIT_LIBRARY.find(c=>c.id==='daytona-road')!;file.name=replacement.name;file.points=file.route.scale==='native'?replacement.nativePoints:replacement.compactPoints;file.route.circuitId=replacement.id;file.terrain=undefined;}currentName=file.name;settings={...file.settings,barriers:false};appliedPoints=file.points;appliedSettings={...settings};draftRoute=file.route;appliedRoute=file.route;savedTerrain=file.terrain?parseTerrain(file.terrain):undefined;restoredTrack=true;}catch{/* A corrupt browser save must not prevent the default circuit from loading. */}
let appliedTerrain=savedTerrain??TerrainField.around(appliedPoints);
let currentTrack=buildTrack(appliedPoints,settings,appliedRoute?{preserveLayout:true,allowCrossings:true}:{});
const editor=new TrackEditor($('#track-canvas'),settings);
const reference=new ReferenceImageLayer($('#reference-canvas'),$('#reference-controls'));reference.onchange=has=>{editor.hasReference=has;editor.draw();};
editor.options=appliedRoute?{preserveLayout:true,allowCrossings:true}:{};
let draftTrack:TrackData|null=currentTrack,draftName=currentName,dirty=false;
let terrainPainter:TerrainPainter|undefined;
let game:GameScene|null=null;
let loadingElevation=false,elevationLoad=0;
let circuitScale:'native'|'compact'=appliedRoute?.scale??'native';
let previewTimer:number|undefined;
let editorSignature='';
const physics=new KartPhysics();
physics.vehicle.absEnabled=safeStorage.get('apex-abs-v1')!=='off';
$<HTMLInputElement>('#abs-toggle').checked=physics.vehicle.absEnabled;
const savedVehicle=safeStorage.get('apex-vehicle-v1');if(savedVehicle==='rb20')physics.setVehicle('rb20');
const audio=new EngineAudio();
audio.setVehicle(physics.profile.id);
const pedals=new PedalHistory();
const timing=new SectorTiming();
const lapCard=mountLapTimes($('#lap-history'));
function renderLapCard(){lapCard.update({currentTime:timing.time,currentLap:timing.lap,currentInvalid:timing.invalid,history:timing.history.slice()});}
let soundTouched=false;
const startSequence=new StartSequence(),startSignal=$('#start-signal'),startLamps=[...document.querySelectorAll<HTMLElement>('.start-signal__lamp')];
let running=false,paused=false,lightsOutDisplay=0,displayedStartLights=-1,lapTime=0,lapNumber=1,bestTime=Infinity,checkpoint=0,lapStarted=false;
const previousLapPosition={x:0,y:0,z:0};
let lastTime=performance.now(),hudElapsed=0,fpsAccum=0,fpsFrames=0;
const keys=new Set<string>(),touchKeys=new Set<string>();
const controller=new GamepadController();
let previousPadStatus='waiting';
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
function syncSettings(){const w=$<HTMLInputElement>('#width-range'),s=$<HTMLInputElement>('#smooth-range');w.value=String(settings.width);s.value=String(settings.smoothness);w.style.setProperty('--progress',`${(settings.width-6)/12*100}%`);s.style.setProperty('--progress',`${settings.smoothness}%`);$('#width-output').innerHTML=`${settings.width} <small>m</small>`;$('#smooth-output').innerHTML=`${settings.smoothness}<small>%</small>`;}
function scheduleDraft(){
  if(!game||running||loadingElevation||!draftTrack||previewTimer!==undefined)return;
  previewTimer=window.setTimeout(()=>{previewTimer=undefined;if(dirty&&!running&&!loadingElevation&&draftTrack)applyDraft(true);},180);
}
editor.onChange=(points,track,error)=>{
  const signature=JSON.stringify([points,settings,editor.options]);if(signature===editorSignature)return;editorSignature=signature;
  if(loadingElevation){elevationLoad++;loadingElevation=false;}
  draftTrack=track;dirty=true;updateStats(track);terrainPainter?.draw();
  setStatus(error||(!points.length?'选择画笔，一笔画出你的闭合赛道。':'正在自动更新预览…'),!!error);
  if(track)scheduleDraft();
};
editor.setPoints(appliedPoints,false);dirty=false;setStatus('拖动控制点，微调你的走线。');syncSettings();updateTrackLabels();
terrainPainter=new TerrainPainter($('#height-canvas'),appliedTerrain.clone(),p=>editor.project(p),(x,y)=>editor.unproject(x,y));
let observedField=terrainPainter.field,observedRevision=observedField.revision;
terrainPainter.onChange=()=>{
  const field=terrainPainter!.field;if(field===observedField&&field.revision===observedRevision)return;
  observedField=field;observedRevision=field.revision;if(loadingElevation){elevationLoad++;loadingElevation=false;}dirty=true;updateTerrainControls();setStatus('正在同步地形高度…');scheduleDraft();
};terrainPainter.setActive(false);updateTerrainControls();
function updateTrackLabels(){
  $('#track-name').textContent=currentName;$('#race-track-name').textContent=currentName;$('#track-length-label').textContent=`${Math.round(currentTrack.length)} m`;$('#track-corners-label').textContent=`${currentTrack.corners} 个弯道`;$('#difficulty-label').textContent=currentTrack.hairpins>3?'技术型':currentTrack.straightPercent>48?'高速型':'流畅型';
}
function setEditorVisible(visible:boolean){document.body.classList.toggle('drive-mode',!visible);$('#editor-tab').classList.toggle('active',visible);$('#drive-tab').classList.toggle('active',!visible);}
function setCamera(mode:CameraMode){game?.setCamera(mode);document.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach(b=>b.classList.toggle('selected',b.dataset.camera===mode));}
function applyDraft(automatic=false){
  if(!draftTrack||!game||loadingElevation)return;
  if(previewTimer!==undefined){clearTimeout(previewTimer);previewTimer=undefined;}
  currentTrack=draftTrack;appliedPoints=editor.points.map(p=>({...p}));appliedSettings={...settings,barriers:false};currentName=draftName;appliedRoute=draftRoute;appliedTerrain=terrainPainter!.field.clone();
  physics.setTrack(currentTrack,appliedSettings,appliedTerrain);game.setTrack(currentTrack,appliedSettings,appliedTerrain,!automatic);bestTime=Infinity;dirty=false;
  updateTrackLabels();setStatus('已实时更新，可以直接试驾。');
}
function bestKey(){let h=2166136261;for(const c of JSON.stringify({points:appliedPoints,settings:appliedSettings,terrain:appliedTerrain.toJSON()})){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return `apex-best-valid-v2-${(h>>>0).toString(16)}${physics.profile.id==='kart'?'':'-rb20'}`;}
function renderSectorTiming(progress=0){
 document.querySelectorAll<HTMLElement>('[data-sector]').forEach((bar,i)=>{bar.className='sector-bar '+(!lapStarted?'pending':i<timing.sector?timing.colors[i]:i===timing.sector?'active':'pending');bar.querySelector<HTMLElement>('i')!.style.width=(lapStarted?Math.max(0,Math.min(1,progress*3-i))*100:0)+'%';bar.querySelector('small')!.textContent=(timing.splits[i]??(i===timing.sector?timing.time-timing.start:0)).toFixed(3).padStart(6,'0');});
}
function waitForStartLine(){lapStarted=false;Object.assign(previousLapPosition,physics.body.position);renderSectorTiming();}
function renderStartSignal(){
  const lit=startSequence.litCount;
  startSignal.hidden=paused;
  if(lit===displayedStartLights)return;
  displayedStartLights=lit;game?.setStartLights(lit);
  startLamps.forEach((lamp,i)=>lamp.classList.toggle('is-lit',i<lit));
  $('#start-signal-label').textContent=startSequence.active?'等待红灯 · 熄灭起步':'红灯熄灭 · 起步';
  startSignal.setAttribute('aria-label',startSequence.active?`已亮起 ${lit} 盏红灯，等待全部熄灭后起步。`:'红灯已全部熄灭，可以起步。');
}
function startDrive(){
  if(loadingElevation){toast('正在载入赛道高度，请稍候。');return;}
  if(!game)return;if(dirty&&draftTrack)applyDraft();
  if(!currentTrack)return;
  pedals.reset();timing.reset();renderLapCard();if(!soundTouched){soundTouched=true;void audio.setEnabled(true).then(updateSoundButton).catch(()=>toast('点击顶栏声音按钮启用引擎音效。'));}
  physics.reset();controller.suspend();keys.clear();touchKeys.clear();running=true;paused=false;startSequence.start();lightsOutDisplay=0;displayedStartLights=-1;physics.setStaged(true);lapTime=0;lapNumber=1;checkpoint=0;waitForStartLine();
  bestTime=Number(safeStorage.get(bestKey()))||Infinity;
  document.body.classList.add('is-driving');setEditorVisible(false);setCamera('cockpit');
  for(const id of ['session-top','driving-hud','race-actions','mobile-controls','pedal-panel','sector-bars','lap-history'])$(`#${id}`).hidden=false;
  for(const id of ['session-card','kart-spec'])$(`#${id}`).hidden=true;
  $('#center-message').hidden=true;renderStartSignal();
  $('#controls-hint').innerHTML=`<span><kbd>W A S D</kbd> 驾驶</span><span>${physics.profile.id==='rb20'?'8-SPEED AUTO':'<kbd>Space</kbd> 手刹'}</span><span><kbd>R</kbd> 复位</span><span class="hint-extra"><kbd>C</kbd> 视角 <kbd>Esc</kbd> 暂停</span>`;
  $('#render-status').textContent='物理模拟运行中';$('#pause-button').innerHTML='<i data-lucide="pause"></i>';icons();
}
function exitDrive(){
  controller.suspend();running=false;paused=false;startSequence.clear();lightsOutDisplay=0;displayedStartLights=-1;game?.setStartLights(0);physics.setStaged(false);keys.clear();touchKeys.clear();physics.input={throttle:0,brake:0,steer:0,handbrake:false,reverse:false};
  document.body.classList.remove('is-driving');setEditorVisible(true);setCamera('orbit');
  for(const id of ['session-top','driving-hud','race-actions','mobile-controls','center-message','start-signal','pedal-panel','sector-bars','lap-history'])$(`#${id}`).hidden=true;
  for(const id of ['session-card','kart-spec'])$(`#${id}`).hidden=false;
  $('#controls-hint').innerHTML='<span><kbd>拖动</kbd> 旋转视角</span><span><kbd>滚轮</kbd> 缩放</span><span class="hint-extra">探索你的赛道</span>';$('#render-status').textContent='3D 实时预览';
}
function pause(){if(!running)return;controller.suspend();paused=!paused;keys.clear();touchKeys.clear();startSignal.hidden=paused||(!startSequence.active&&lightsOutDisplay<=0);$('#center-message').hidden=!paused;$('#center-message').innerHTML=paused?'<span class="pause-title">休息一拍。</span><small>按 Esc 或点击暂停键继续</small>':'';$('#pause-button').innerHTML=`<i data-lucide="${paused?'play':'pause'}"></i>`;$('#pause-button').setAttribute('aria-label',paused?'继续':'暂停');icons();}
function resetKart(){
  if(!running)return;controller.suspend();physics.reset();lightsOutDisplay=0;
  if(startSequence.active){startSequence.start();physics.setStaged(true);displayedStartLights=-1;renderStartSignal();}else startSignal.hidden=true;
  keys.clear();touchKeys.clear();pedals.reset();timing.restartLap();lapTime=0;checkpoint=0;waitForStartLine();
  game?.setCamera(game.mode);renderLapCard();updateHUD();toast('已回到第一格，过起跑线后重新计时。');
}

document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(b=>b.addEventListener('click',()=>{editor.setTool(b.dataset.tool as any);document.querySelectorAll('[data-tool]').forEach(x=>x.classList.toggle('selected',x===b));setStatus(b.dataset.tool==='draw'?'按住鼠标或手指，一笔画出不交叉的环线。':'拖动圆点，路线会自动更新。');}));
$('#new-button').addEventListener('click',()=>{$<HTMLSelectElement>('#circuit-select').value='';draftRoute=undefined;editor.options={};editor.clear();terrainPainter!.setField(new TerrainField());updateTerrainControls();draftName='我的手绘赛道';document.querySelectorAll('[data-tool]').forEach(x=>x.classList.toggle('selected',(x as HTMLElement).dataset.tool==='draw'));$('#track-canvas').focus();});
$('#clear-button').addEventListener('click',()=>$('#new-button').click());$('#undo-button').addEventListener('click',()=>editor.undo());
$('#width-range').addEventListener('input',e=>{settings.width=Number((e.target as HTMLInputElement).value);syncSettings();editor.updateSettings(settings);});
$('#smooth-range').addEventListener('input',e=>{settings.smoothness=Number((e.target as HTMLInputElement).value);syncSettings();editor.updateSettings(settings);});
function updateTerrainControls(){if(!terrainPainter)return;terrainPainter.radius=terrainPainter.field.size*Number($<HTMLInputElement>('#brush-radius').value)/500;terrainPainter.strength=Number($<HTMLInputElement>('#brush-strength').value);$('#brush-radius-output').textContent=`${Math.round(terrainPainter.radius)} m`;$('#brush-strength-output').textContent=`${terrainPainter.strength} m/s`;$('#height-range').textContent=`${terrainPainter.field.min.toFixed(1)} — ${terrainPainter.field.max.toFixed(1)} m`;}
document.querySelectorAll<HTMLButtonElement>('[data-layer]').forEach(b=>b.addEventListener('click',()=>{const height=b.dataset.layer==='height';terrainPainter!.setActive(height);$('#terrain-tools').hidden=!height;document.querySelectorAll('[data-layer]').forEach(x=>x.classList.toggle('selected',x===b));$('#layer-badge').textContent=height?'羽化高度笔刷':'自动平滑';}));
document.querySelectorAll<HTMLButtonElement>('[data-brush]').forEach(b=>b.addEventListener('click',()=>{terrainPainter!.mode=b.dataset.brush as BrushMode;document.querySelectorAll('[data-brush]').forEach(x=>x.classList.toggle('selected',x===b));}));
function syncRangeFill(input:HTMLInputElement){
  const minimum=Number(input.min||0),maximum=Number(input.max||100),value=Number(input.value);
  input.style.setProperty('--progress',Math.max(0,Math.min(100,(value-minimum)/Math.max(.00001,maximum-minimum)*100))+'%');
}
document.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(input=>{syncRangeFill(input);input.addEventListener('input',()=>syncRangeFill(input));});
for(const id of ['brush-radius','brush-strength'])$<HTMLInputElement>('#'+id).addEventListener('input',updateTerrainControls);
$('#height-visible').addEventListener('change',e=>{terrainPainter!.visible=(e.target as HTMLInputElement).checked;terrainPainter!.draw();});$('#undo-height').addEventListener('click',()=>terrainPainter!.undo());$('#clear-height').addEventListener('click',()=>terrainPainter!.clear());
async function loadSelectedCircuit(){
  const c=CIRCUIT_LIBRARY.find(c=>c.id===$<HTMLSelectElement>('#circuit-select').value);if(!c){elevationLoad++;loadingElevation=false;return;}
  const scale=circuitScale,request=++elevationLoad;
  loadingElevation=true;if(previewTimer!==undefined){clearTimeout(previewTimer);previewTimer=undefined;}setStatus('正在载入赛道与地形高度…');
  try{
    const terrain=await circuitTerrain(c,scale);if(request!==elevationLoad)return;loadingElevation=false;
    draftRoute={circuitId:c.id,scale};draftName=c.name;editor.options={preserveLayout:true,allowCrossings:true};settings.width=scale==='native'?12:6;editor.settings={...settings};
    const points=scale==='native'?c.nativePoints:c.compactPoints;editor.setPoints(points);terrainPainter!.setField(terrain);syncSettings();updateTerrainControls();
    const heights=points.map(p=>terrain.sample(p.x,p.z)),relief=Math.max(...heights)-Math.min(...heights);
    $('#library-info').textContent=c.country+' · '+(scale==='native'?'原尺寸':'等比缩放')+' · 路线高差约 '+relief.toFixed(1)+' m。含 DEM 近似地形，可用高度笔刷调整。';applyDraft();
  }catch(error){if(request===elevationLoad){toast((error as Error).message);setStatus('高度加载失败，当前赛道已保留。',true);}}
  finally{if(request===elevationLoad)loadingElevation=false;}
}
$('#circuit-select').addEventListener('change',()=>void loadSelectedCircuit());
function syncCircuitScale(){
  document.querySelectorAll<HTMLButtonElement>('[data-scale]').forEach(button=>{const selected=button.dataset.scale===circuitScale;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;});
}
document.querySelectorAll<HTMLButtonElement>('[data-scale]').forEach(button=>button.addEventListener('click',()=>{
  const scale=button.dataset.scale as 'native'|'compact';if(scale===circuitScale)return;circuitScale=scale;syncCircuitScale();void loadSelectedCircuit();
}));
$('#circuit-scale').addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
  const scale=event.key==='Home'?'native':event.key==='End'?'compact':circuitScale==='native'?'compact':'native';
  const button=$<HTMLButtonElement>('[data-scale="'+scale+'"]');button.focus();button.click();
});
syncCircuitScale();
$('#circuit-select').title=F1_CALENDAR_NOTE;
if(appliedRoute){$<HTMLSelectElement>('#circuit-select').value=appliedRoute.circuitId;circuitScale=appliedRoute.scale;syncCircuitScale();}
$('#panel-drive-button').addEventListener('click',startDrive);
$('#abs-toggle').addEventListener('change',()=>{const enabled=$<HTMLInputElement>('#abs-toggle').checked;physics.vehicle.absEnabled=enabled;physics.vehicle.resetABS();physics.telemetry.absActive=false;safeStorage.set('apex-abs-v1',enabled?'on':'off');});
$('#start-button').addEventListener('click',startDrive);$('#drive-tab').addEventListener('click',()=>running?setEditorVisible(false):startDrive());$('#editor-tab').addEventListener('click',()=>{if(running)exitDrive();else setEditorVisible(true);});$('#exit-button').addEventListener('click',exitDrive);$('#pause-button').addEventListener('click',pause);$('#reset-button').addEventListener('click',resetKart);
document.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach(b=>b.addEventListener('click',()=>setCamera(b.dataset.camera as CameraMode)));
document.querySelectorAll<HTMLButtonElement>('[data-color]').forEach(b=>b.addEventListener('click',()=>{game?.setColor(b.dataset.color!);document.querySelectorAll('[data-color]').forEach(x=>x.classList.toggle('selected',x===b));}));
function updateSoundButton(){const enabled=audio.enabled;$('#sound-button').innerHTML=`<i data-lucide="${enabled?'volume-2':'volume-x'}"></i>`;$('#sound-button').setAttribute('aria-label',enabled?'关闭引擎声音':'开启引擎声音');icons();}
$('#sound-button').addEventListener('click',async()=>{soundTouched=true;try{await audio.toggle();updateSoundButton();toast(audio.enabled?(physics.profile.id==='rb20'?'V6 涡轮混动合成音效已开启':'200cc 单缸四冲程合成音效已开启'):'引擎声音已关闭');}catch{toast('当前浏览器暂时无法启动音频。');}});
async function importedTerrain(data:TrackFile){
  if(data.terrain)return parseTerrain(data.terrain);
  const circuit=CIRCUIT_LIBRARY.find(c=>c.id===data.route?.circuitId);
  return circuit&&data.route?circuitTerrain(circuit,data.route.scale):TerrainField.around(data.points);
}
function trackFile():TrackFile{return {version:2,name:draftName,points:editor.points,settings:{...settings,barriers:false},terrain:terrainPainter!.field.toJSON(),route:draftRoute};}
$('#save-button').addEventListener('click',()=>{if(!draftTrack){toast('请先画出一条有效赛道。');return;}toast(safeStorage.set('apex-track-v1',JSON.stringify(trackFile()))?'赛道已保存到此浏览器，下次打开会自动恢复。':'浏览器存储不可用，请使用「导出 JSON」备份。');});
$('#export-button').addEventListener('click',()=>{if(!draftTrack){toast('请先画出一条有效赛道。');return;}const blob=new Blob([JSON.stringify(trackFile(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`apex-${draftName}.json`;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),2000);toast('赛道 JSON 已导出。');});
$('#import-button').addEventListener('click',()=>$<HTMLInputElement>('#file-input').click());
$('#file-input').addEventListener('change',async e=>{const input=e.target as HTMLInputElement,file=input.files?.[0];if(!file)return;try{if(file.size>3e6)throw new Error('文件太大，请使用小于 3 MB 的赛道 JSON。');const data=parseTrackFile(await file.text()),terrain=await importedTerrain(data);settings={...data.settings};draftName=data.name;draftRoute=data.route;editor.options=data.route?{preserveLayout:true,allowCrossings:true}:{};editor.settings={...settings};syncSettings();editor.setPoints(data.points);terrainPainter!.setField(terrain);updateTerrainControls();dirty=true;applyDraft();toast('赛道已导入并应用。');}catch(error){toast((error as Error).message);}input.value='';});
type HelpView='gamepad'|'keyboard';
function selectHelpView(view:HelpView){
  const dialog=$<HTMLDialogElement>('#help-dialog');dialog.dataset.helpView=view;
  document.querySelectorAll<HTMLButtonElement>('[data-help-tab]').forEach(tab=>{const selected=tab.dataset.helpTab===view;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;});
  $('#help-gamepad-panel').hidden=view!=='gamepad';$('#help-keyboard-panel').hidden=view!=='keyboard';dialog.scrollTop=0;
}
function openHelp(view:HelpView){
  if(running&&!paused)pause();selectHelpView(view);$<HTMLDialogElement>('#help-dialog').showModal();
}
document.querySelectorAll<HTMLButtonElement>('[data-help-tab]').forEach(tab=>{
  tab.addEventListener('click',()=>selectHelpView(tab.dataset.helpTab as HelpView));
  tab.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const view=e.key==='Home'?'gamepad':e.key==='End'?'keyboard':tab.dataset.helpTab==='gamepad'?'keyboard':'gamepad';selectHelpView(view);$<HTMLButtonElement>('#help-'+view+'-tab').focus();});
});
$('#help-button').addEventListener('click',()=>openHelp('keyboard'));document.querySelectorAll('.close-help').forEach(b=>b.addEventListener('click',()=>$<HTMLDialogElement>('#help-dialog').close()));$<HTMLDialogElement>('#help-dialog').addEventListener('click',e=>{if(e.target===$('#help-dialog'))$<HTMLDialogElement>('#help-dialog').close();});
$('#fullscreen-button').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('.viewport').requestFullscreen();}catch{toast('当前浏览器不支持全屏，可以缩放页面查看。');}});
window.addEventListener('keydown',e=>{
  const target=e.target as HTMLElement;if(target.matches('input,textarea,select'))return;
  if($<HTMLDialogElement>('#help-dialog').open)return;
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)&&running)e.preventDefault();
  if(e.repeat){keys.add(e.code);return;}
  if(e.code==='Escape'){if(running)pause();return;}if(e.code==='KeyR'){resetKart();return;}
  if(e.code==='KeyC'&&running){cycleCamera();return;}
  if((e.ctrlKey||e.metaKey)&&e.code==='KeyZ'&&!running){e.preventDefault();if(terrainPainter?.active)terrainPainter.undo();else editor.undo();return;}
  keys.add(e.code);
});window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{keys.clear();touchKeys.clear();if(running&&!paused)pause();});document.addEventListener('visibilitychange',()=>{if(document.hidden&&running&&!paused)pause();});
document.querySelectorAll<HTMLButtonElement>('[data-control]').forEach(b=>{const release=()=>{touchKeys.delete(b.dataset.control!);b.classList.remove('pressed');};b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);touchKeys.add(b.dataset.control!);b.classList.add('pressed');});b.addEventListener('pointerup',release);b.addEventListener('pointercancel',release);b.addEventListener('lostpointercapture',release);});

function updateLap(dt:number){
 const position=physics.body.position,near=nearestOnTrack(currentTrack,position),progress=near.index/currentTrack.samples.length;
 let timedDt=dt;
 if(!lapStarted){
   const start=currentTrack.samples[0],before=(previousLapPosition.x-start.x)*start.tx+(previousLapPosition.z-start.z)*start.tz,after=(position.x-start.x)*start.tx+(position.z-start.z)*start.tz;
   timedDt=0;
   // Cross the painted line in the driving direction, within the road width
   // and on its elevation, rather than relying on the nearest sample changing.
   if(before<0&&after>=0){
     const fraction=-before/(after-before),x=previousLapPosition.x+(position.x-previousLapPosition.x)*fraction,z=previousLapPosition.z+(position.z-previousLapPosition.z)*fraction,y=previousLapPosition.y+(position.y-previousLapPosition.y)*fraction;
     const lateral=(x-start.x)*start.nx+(z-start.z)*start.nz,height=physics.terrain.sample(x,z)+bridgeHeight(currentTrack,0)+physics.profile.rideHeight;
     if(Math.abs(lateral)<=currentTrack.width/2&&Math.abs(y-height)<2){
       lapStarted=true;timing.restartLap();timing.previousProgress=progress;physics.clearTrackLimits();
       // Only the portion of this frame after crossing belongs to the lap.
       timedDt=dt*(1-fraction);
     }
   }
 }
 Object.assign(previousLapPosition,position);
 const complete=lapStarted&&timing.update(timedDt,progress,near.distance<currentTrack.width/2+1,physics.telemetry.signedSpeed>1,physics.trackLimitsExceeded);lapTime=timing.time;lapNumber=timing.lap;
 if(complete){physics.clearTrackLimits();const lap=timing.history[0];if(!lap.invalid&&lap.time<bestTime){bestTime=lap.time;safeStorage.set(bestKey(),String(bestTime));toast('新最佳圈速 '+formatTime(bestTime));}}
 renderSectorTiming(progress);
}
function updateHUD(){const t=physics.telemetry;pedals.draw($('#pedal-chart'));$('#throttle-percent').textContent=Math.round(physics.input.throttle*100)+'%';$('#brake-percent').textContent=Math.round(t.brakeApplied*100)+'%';$('#brake-demand-percent').textContent=Math.round(physics.input.brake*100)+'%';$('#abs-status').textContent=!physics.vehicle.absEnabled?'ABS 关闭':t.absActive?'ABS 限制中':'ABS 待命';$('#abs-status').classList.toggle('active',physics.vehicle.absEnabled&&t.absActive);$('#speed').textContent=String(Math.round(t.speed));$('#gear').textContent=t.signedSpeed<-1?'R':t.speed<1?'N':physics.profile.id==='rb20'?String(t.gear||1):'D';$('#rpm-label').textContent=`${Math.round(t.rpm/100)*100} RPM`;renderLapCard();$('#broadcast-lap').textContent=formatTime(lapTime);$('#surface-label').textContent=t.offroad?'草地 · 抓地降低':t.runoff?'沥青缓冲区 · 正常抓地':'干燥沥青';$('#grip-label').textContent=t.offroad?'草地低抓地':t.grip<.65?'轮胎滑移':'正常抓地';$('#g-dot').style.transform=`translate(${Math.max(-22,Math.min(22,t.lateralG*15))}px,${Math.max(-22,Math.min(22,t.longitudinalG*15))}px)`;document.querySelectorAll<HTMLElement>('.rpm-bars span').forEach((b,i)=>b.classList.toggle('lit',i<Math.round(t.rpm/physics.profile.maxRPM*22)));}
function cycleCamera(){const modes:CameraMode[]=['chase','top','cockpit','orbit'];setCamera(modes[(modes.indexOf(game?.mode||'chase')+1)%modes.length]);}
function pollController(){
  controller.poll();
  if(controller.status!==previousPadStatus){
    const button=$('#gamepad-status');button.dataset.state=controller.status;
    const messages={waiting:'未连接：按手柄任意键识别',connected:'已连接：'+controller.name,unsupported:'已识别手柄，但浏览器未提供标准按键映射',unavailable:'当前浏览器暂不能读取手柄'};
    button.title=messages[controller.status]+'；点击查看操作说明';button.setAttribute('aria-label',button.title);
    if(controller.status==='connected')toast('手柄已连接：左摇杆转向，RT 油门，LT 刹车');
    else if(previousPadStatus==='connected'){physics.input={throttle:0,brake:0,steer:0,handbrake:false,reverse:false};if(running&&!paused)pause();toast('手柄连接已断开');}
    previousPadStatus=controller.status;
  }
  const dialog=$<HTMLDialogElement>('#help-dialog');
  if(dialog.open){if(controller.confirm||controller.start||controller.reverse){dialog.close();controller.suspend();}return;}
  if(controller.start){if(running)pause();else startDrive();return;}
  if(controller.confirm&&(!running||paused)){if(running)pause();else startDrive();return;}
  if(!running)return;
  if(controller.exit){exitDrive();return;}
  if(controller.reset)resetKart();
  if(controller.view)cycleCamera();
}
$('#gamepad-status').addEventListener('click',()=>openHelp('gamepad'));
function animate(now:number){
  const dt=Math.min((now-lastTime)/1000,.06);lastTime=now;
  if(game){
    pollController();
    if(running&&!paused){
      if(startSequence.active){const released=startSequence.advance(dt);renderStartSignal();if(released){physics.setStaged(false);lightsOutDisplay=.65;}else physics.step(dt);}
      if(!startSequence.active){
        if(lightsOutDisplay>0)lightsOutDisplay=Math.max(0,lightsOutDisplay-dt);else startSignal.hidden=true;
        const accel=keys.has('KeyW')||keys.has('ArrowUp')||touchKeys.has('throttle'),brake=keys.has('KeyS')||keys.has('ArrowDown')||touchKeys.has('brake'),left=keys.has('KeyA')||keys.has('ArrowLeft')||touchKeys.has('left'),right=keys.has('KeyD')||keys.has('ArrowRight')||touchKeys.has('right');
        const throttle=Math.max(accel?1:0,controller.throttle),signed=physics.telemetry.signedSpeed;
        const reverse=(brake||controller.reverse)&&signed<=1&&throttle<.01;
        const brakeDemand=Math.max((brake||controller.reverse)&&signed>1?1:0,controller.brake);
        const keyboardSteer=(left?1:0)-(right?1:0);
        physics.input={throttle,brake:reverse?0:brakeDemand,reverse,steer:keyboardSteer||controller.steer,handbrake:keys.has('Space')||controller.handbrake};physics.step(dt);pedals.record(dt,physics.input.throttle,physics.telemetry.brakeApplied,physics.input.brake);updateLap(dt);
        if(!Number.isFinite(physics.body.position.y)||physics.body.position.y<physics.killY)resetKart();
      }
    }else if(!running){physics.input={throttle:0,brake:.4,steer:0,handbrake:false,reverse:false};physics.step(dt);}
    game.update(dt,running&&!paused);audio.update(physics.telemetry.rpm,physics.input.throttle,running&&!paused&&!startSequence.active,physics.telemetry.speed,physics.telemetry.kerbLeft,physics.telemetry.kerbRight,game.tyreSquealLeft,game.tyreSquealRight,physics.telemetry.grassLeft,physics.telemetry.grassRight);
    hudElapsed+=dt;if(hudElapsed>.05){if(running)updateHUD();hudElapsed=0;}
  }
  fpsAccum+=dt;fpsFrames++;if(fpsAccum>1){$('#fps').textContent=`${Math.round(fpsFrames/fpsAccum)} FPS`;fpsAccum=0;fpsFrames=0;}
  requestAnimationFrame(animate);
}
async function initializeScene(){
  try{
    game=new GameScene($('#scene-container'),physics);physics.setTrack(currentTrack,settings,appliedTerrain);game.setTrack(currentTrack,settings,appliedTerrain);
    game.onContextLost=()=>{if(running&&!paused)pause();toast('图形上下文中断，请重新加载页面恢复 3D。');};
    if(appliedRoute&&!restoredTrack)await loadSelectedCircuit();
    $('#loading-screen').classList.add('loaded');window.setTimeout(()=>$('#loading-screen').remove(),700);requestAnimationFrame(animate);
  }catch(error){$('#loading-screen').remove();$('#error-overlay').hidden=false;$('#error-message').textContent=`请使用支持 WebGL 2 的浏览器并开启硬件加速。${(error as Error).message}`;}
}
void initializeScene();

// Read-only state for reproducible browser QA and integrations.
Object.defineProperty(window,'apex',{get:()=>({track:currentTrack,physics,editor,game,running,paused,countingDown:startSequence.active,lapStarted,lapTime,lapNumber,checkpoint,dirty,terrainPainter,pedals,timing,audio,reference,controller})});

