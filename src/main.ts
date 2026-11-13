import './style.css';
import { createIcons, ArrowUpRight, ArrowDownToLine, ArrowUpFromLine, Check, ChevronDown, CircleHelp, Flag, Focus, Fullscreen, Gauge, Grip, Maximize2, MousePointer2, Pause, Pencil, Play, Redo2, RotateCcw, Save, Settings2, Shield, Sparkles, Sun, Trash2, Undo2, Volume2, VolumeX, X } from 'lucide';
import { buildTrack, DEFAULT_SETTINGS, nearestOnTrack, parseTrackFile, PRESETS, type Point, type TrackData, type TrackFile, type TrackSettings } from './track';
import { TrackEditor } from './editor';
import { KartPhysics } from './physics';
import { GameScene, type CameraMode } from './scene';
import { EngineAudio } from './audio';

const iconSet={ArrowUpRight,ArrowDownToLine,ArrowUpFromLine,Check,ChevronDown,CircleHelp,Flag,Focus,Fullscreen,Gauge,Grip,Maximize2,MousePointer2,Pause,Pencil,Play,Redo2,RotateCcw,Save,Settings2,Shield,Sparkles,Sun,Trash2,Undo2,Volume2,VolumeX,X};
const icons=()=>createIcons({icons:iconSet,attrs:{'stroke-width':1.6}});
const $=<T extends HTMLElement=HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
const formatTime=(seconds:number)=>{if(!Number.isFinite(seconds))return '—:——.——';const m=Math.floor(seconds/60),s=Math.floor(seconds%60),cs=Math.floor(seconds%1*100);return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;};
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
    <div class="viewport-top"><div class="live-badge"><span class="live-dot"></span><span>LIVE VIEW</span><span class="badge-separator">/</span><span id="scene-label">赛道预览</span></div><div class="weather"><i data-lucide="sun"></i><span>晴 · 24°C</span><span class="weather-line"></span><span>干燥路面</span></div></div>
    <div class="hero-copy" id="hero-copy"><div class="eyebrow"><span class="tiny-line"></span> BUILD IT. DRIVE IT.</div><h1>你画赛道。<br>其余交给<span>速度</span><span class="heading-period">。</span></h1><p>从一笔灵感，到每一个弯心。</p></div>
    <div class="session-top" id="session-top" hidden><div class="session-chip"><span class="live-dot"></span>自由练习<span class="session-divider">/</span><span id="race-track-name">海岸俱乐部</span></div><div class="lap-clock"><span>当前圈速</span><strong id="lap-time">00:00.00</strong><div>圈数 <b id="lap-count">01</b><span>最佳 <b id="best-time">—:——.——</b></span></div></div></div>
    <div class="center-message" id="center-message" hidden></div>
    <div class="session-card" id="session-card"><div class="session-number">01<span>/ CIRCUIT</span></div><div class="session-info"><div class="session-title-row"><h2 id="track-name">海岸俱乐部</h2><span class="difficulty-dot"></span><span class="difficulty-label" id="difficulty-label">技术型</span></div><p><span id="track-length-label">— m</span><span>·</span><span id="track-corners-label">— 个弯道</span><span>·</span><span>单人计时</span></p></div><button class="drive-button" id="start-button"><span>上车试驾</span><i data-lucide="arrow-up-right"></i></button></div>
    <div class="kart-spec" id="kart-spec"><span class="spec-label">YOUR KART</span><div class="kart-title">APX–07 <span>RACING</span></div><div class="kart-details"><span>165 <small>kg</small></span><span>98 <small>km/h</small></span><div class="color-options" aria-label="车身颜色"><button class="color-swatch selected" data-color="#c4ed4c" style="--swatch:#c4ed4c" aria-label="青柠色车身"></button><button class="color-swatch" data-color="#e88161" style="--swatch:#e88161" aria-label="珊瑚色车身"></button><button class="color-swatch" data-color="#75c9cc" style="--swatch:#75c9cc" aria-label="冰蓝色车身"></button></div></div></div>
    <div class="driving-hud" id="driving-hud" hidden><div class="g-meter"><span>轮胎抓地</span><div class="g-circle"><div class="g-horizontal"></div><div class="g-vertical"></div><b id="g-dot"></b></div><span id="grip-label">正常抓地</span></div><div class="speedometer"><div class="rpm-bars" id="rpm-bars">${Array.from({length:22},(_,i)=>`<span style="--bar:${i}"></span>`).join('')}</div><div class="speed-value"><strong id="speed">0</strong><div><b id="gear">N</b><span>KM/H</span></div></div><div class="speed-meta"><span><span class="status-dot"></span><span id="surface-label">干燥沥青</span></span><span id="rpm-label">1,600 RPM</span></div></div><canvas id="minimap" width="260" height="190" aria-label="实时赛道小地图"></canvas></div>
    <div class="race-actions" id="race-actions" hidden><button id="pause-button" class="round-action" aria-label="暂停"><i data-lucide="pause"></i></button><button id="reset-button" class="round-action" title="复位车辆 (R)" aria-label="复位车辆"><i data-lucide="rotate-ccw"></i></button><button id="exit-button" class="exit-button"><i data-lucide="pencil"></i><span>返回工坊</span></button></div>
    <div class="controls-hint" id="controls-hint"><span><kbd>拖动</kbd> 旋转视角</span><span><kbd>滚轮</kbd> 缩放</span><span class="hint-extra"><i data-lucide="mouse-pointer-2"></i>探索你的赛道</span></div>
    <div class="mobile-controls" id="mobile-controls" hidden><div><button data-control="left" aria-label="左转">◀</button><button data-control="right" aria-label="右转">▶</button></div><div><button data-control="brake" class="brake-pedal">刹车</button><button data-control="throttle" class="gas-pedal">油门</button></div></div>
    <div class="viewport-footer"><div class="render-status"><span class="status-dot"></span><span id="render-status">3D 实时预览</span><span class="status-slash">/</span><span id="fps">60 FPS</span></div><div class="camera-switch" role="group" aria-label="视角"><button class="selected" data-camera="orbit" title="环绕视角">环绕</button><button data-camera="chase" title="跟随视角 (C)">跟随</button><button data-camera="top" title="俯视视角">俯视</button><button data-camera="cockpit" title="驾驶员视角">座舱</button><span></span><button id="fullscreen-button" aria-label="全屏" title="全屏"><i data-lucide="maximize-2"></i></button></div></div>
    <div class="loading-screen" id="loading-screen"><div class="loading-mark">A<span>PEX</span></div><div class="loading-line"></div><p>正在准备你的赛道…</p></div>
  </section>
  <aside class="editor-panel" id="editor-panel">
    <div class="panel-heading"><div class="panel-eyebrow"><span class="live-dot"></span> TRACK BUILDER <span>01 — 03</span></div><div class="panel-title"><h2>好赛道，始于一笔。</h2><button class="icon-button" id="new-button" title="新建手绘赛道" aria-label="新建手绘赛道"><i data-lucide="pencil"></i></button></div><p>画出路线，我们来打磨每一个弯。</p></div>
    <div class="panel-scroll">
      <div class="section-label preset-label"><span>从灵感出发</span><span>或直接在下方绘制 <i data-lucide="arrow-up-right"></i></span></div>
      <div class="presets">${PRESETS.map((p,i)=>`<button class="preset ${i===0?'selected':''}" data-preset="${p.id}">${miniSvg(p.points)}<span>${p.name}</span></button>`).join('')}</div>
      <div class="editor-section"><div class="section-label"><span><b>01</b> 绘制布局</span><div class="canvas-tools"><button class="tool" data-tool="draw" title="画笔：一笔画出闭合环线" aria-label="画笔工具"><i data-lucide="pencil"></i></button><button class="tool selected" data-tool="edit" title="拖动控制点调整路线" aria-label="控制点工具"><i data-lucide="mouse-pointer-2"></i></button><span></span><button class="tool" id="undo-button" title="撤销" aria-label="撤销"><i data-lucide="undo-2"></i></button><button class="tool" id="clear-button" title="清空画布" aria-label="清空画布"><i data-lucide="trash-2"></i></button></div></div>
      <div class="canvas-wrap"><canvas id="track-canvas" aria-label="赛道绘制画布。使用画笔绘制，或使用控制点工具拖动路线。" tabindex="0"></canvas><span class="canvas-badge"><i data-lucide="sparkles"></i> 自动平滑</span><span class="canvas-corner">N ↑</span></div>
      <div class="canvas-legend"><span><b class="legend-dot straight"></b>直道</span><span><b class="legend-dot curve"></b>缓弯</span><span><b class="legend-dot hairpin"></b>急弯</span><span class="auto-close"><i data-lucide="check"></i>自动闭合</span></div>
      <p class="editor-status" id="editor-status">拖动控制点，微调你的走线。</p></div>
      <div class="editor-section settings-section"><div class="section-label"><span><b>02</b> 赛道设定</span><i data-lucide="settings-2"></i></div>
      <label class="range-label" for="width-range"><span>赛道宽度</span><output id="width-output">10 <small>m</small></output></label><input id="width-range" type="range" min="6" max="18" step="1" value="10"/><div class="range-extents"><span>窄 · 技术型</span><span>宽 · 高速型</span></div>
      <label class="range-label smooth-label" for="smooth-range"><span>曲线平滑度</span><output id="smooth-output">60<small>%</small></output></label><input id="smooth-range" type="range" min="0" max="100" step="5" value="60"/>
      <div class="toggle-row"><label for="curbs-toggle"><i data-lucide="flag"></i><span>弯道路肩<small>根据弯道曲率自动生成</small></span></label><input class="switch" type="checkbox" id="curbs-toggle" checked/></div>
      <div class="toggle-row"><label for="barriers-toggle"><i data-lucide="shield"></i><span>安全护栏<small>沿赛道边界生成碰撞护栏</small></span></label><input class="switch" type="checkbox" id="barriers-toggle" checked/></div>
      </div>
      <div class="editor-section analysis-section"><div class="section-label"><span><b>03</b> 赛道分析</span><span class="analysis-badge"><span class="status-dot"></span>实时识别</span></div><div class="analysis-grid"><div><span>赛道全长</span><strong id="stat-length">— <small>m</small></strong></div><div><span>弯道数量</span><strong id="stat-corners">— <small>个</small></strong></div><div><span>急弯数量</span><strong id="stat-hairpins">— <small>个</small></strong></div><div><span>直道占比</span><strong id="stat-straights">— <small>%</small></strong></div></div></div>
      <div class="file-actions"><button id="export-button"><i data-lucide="arrow-down-to-line"></i>导出 JSON</button><span></span><button id="import-button"><i data-lucide="arrow-up-from-line"></i>导入赛道</button></div>
    </div>
    <div class="panel-footer"><button class="generate-button" id="generate-button"><span><i data-lucide="sparkles"></i>生成赛道</span><i data-lucide="arrow-up-right"></i></button><p><span class="status-dot"></span>平滑曲线 · 智能路肩 · 实时物理</p></div>
  </aside>
</main>
<footer class="bottom-bar"><div><span class="footer-brand">APEX</span><span class="footer-divider"></span><span>为每一个弯心而生。</span></div><div><span class="engine-label"><span class="status-dot"></span> CANNON PHYSICS</span><span class="footer-divider"></span><span>VITE + THREE.JS</span><span class="footer-version">v1.0</span></div></footer>
<div id="toast" class="toast" role="status" aria-live="polite"></div>
<input type="file" id="file-input" accept="application/json,.json" hidden/>
<dialog id="help-dialog"><div class="dialog-head"><div><span class="eyebrow">A QUICK PIT STOP</span><h2>准备好，向弯心出发。</h2></div><button class="icon-button close-help" aria-label="关闭说明"><i data-lucide="x"></i></button></div><div class="help-columns"><div><h3>驾驶控制</h3><p><kbd>W</kbd><kbd>↑</kbd><span>加速</span></p><p><kbd>S</kbd><kbd>↓</kbd><span>刹车 · 停稳后倒车</span></p><p><kbd>A</kbd><kbd>D</kbd><span>左 / 右转向</span></p><p><kbd>Space</kbd><span>手刹漂移</span></p><p><kbd>R</kbd><span>在最近路段复位</span></p><p><kbd>C</kbd><span>切换驾驶视角</span></p><p><kbd>Esc</kbd><span>暂停 / 继续</span></p></div><div><h3>赛道工坊</h3><p class="help-text">选择画笔，在画布上一笔画出不交叉的环线。松手后自动闭合和平滑；选择控制点工具可以拖动调整。</p><p class="help-text">浅青色表示直道，绿色表示缓弯，青柠色表示急弯。点击「生成赛道」将布局送入 3D 世界。</p><p class="help-text">保存会保留在当前浏览器；导出 JSON 可以备份或分享。手机和平板可用屏幕踏板驾驶。</p></div></div><div class="physics-note"><i data-lucide="grip"></i><span>真实刚体碰撞 + 四轮射线悬挂，包含轮胎滑移、后轮驱动与空气阻力。属于可玩的物理原型，参数尚未经实车标定。</span></div><button class="generate-button close-help">知道了，去跑一圈 <i data-lucide="arrow-up-right"></i></button></dialog>
<div class="error-overlay" id="error-overlay" hidden><h2>3D 场景暂时无法启动</h2><p id="error-message"></p><button onclick="location.reload()">重新加载</button></div>
`;
icons();
let toastTimer:number;
function toast(message:string){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=window.setTimeout(()=>$('#toast').classList.remove('visible'),3300);}
let settings:TrackSettings={...DEFAULT_SETTINGS};
let currentName=PRESETS[0].name,appliedPoints=PRESETS[0].points.map(p=>({...p})),appliedSettings={...settings};
const saved=safeStorage.get('apex-track-v1');if(saved)try{const file=parseTrackFile(saved);currentName=file.name;settings=file.settings;appliedPoints=file.points;appliedSettings={...settings};}catch{/* A corrupt browser save must not prevent the default circuit from loading. */}
let currentTrack=buildTrack(appliedPoints,settings);
const editor=new TrackEditor($('#track-canvas'),settings);
let draftTrack:TrackData|null=currentTrack,draftName=currentName,dirty=false;
let game:GameScene|null=null;
const physics=new KartPhysics();
const audio=new EngineAudio();
let running=false,paused=false,countingDown=false,countdown=0,lapTime=0,lapNumber=1,bestTime=Infinity,checkpoint=0,lapStarted=false;
let lastProgress=0,lastTime=performance.now(),hudElapsed=0,fpsAccum=0,fpsFrames=0;
const keys=new Set<string>(),touchKeys=new Set<string>();

function setStatus(message:string,error=false){$('#editor-status').textContent=message;$('#editor-status').classList.toggle('error',error);}
function updateStats(track:TrackData|null){for(const [id,value,unit] of [['length',track?Math.round(track.length):'—','m'],['corners',track?.corners??'—','个'],['hairpins',track?.hairpins??'—','个'],['straights',track?.straightPercent??'—','%']] as const)$(`#stat-${id}`).innerHTML=`${value} <small>${unit}</small>`;}
function syncSettings(){const w=$<HTMLInputElement>('#width-range'),s=$<HTMLInputElement>('#smooth-range');w.value=String(settings.width);s.value=String(settings.smoothness);w.style.setProperty('--progress',`${(settings.width-6)/12*100}%`);s.style.setProperty('--progress',`${settings.smoothness}%`);$('#width-output').innerHTML=`${settings.width} <small>m</small>`;$('#smooth-output').innerHTML=`${settings.smoothness}<small>%</small>`;$<HTMLInputElement>('#curbs-toggle').checked=settings.curbs;$<HTMLInputElement>('#barriers-toggle').checked=settings.barriers;}
editor.onChange=(points,track,error)=>{draftTrack=track;dirty=true;updateStats(track);$<HTMLButtonElement>('#generate-button').disabled=!track;setStatus(error||(!points.length?'选择画笔，一笔画出你的闭合赛道。':'布局已更新，点击「生成赛道」应用到 3D。'),!!error);};
editor.setPoints(appliedPoints,false);dirty=false;setStatus('拖动控制点，微调你的走线。');syncSettings();updateTrackLabels();
document.querySelectorAll<HTMLElement>('[data-preset]').forEach(b=>b.classList.toggle('selected',PRESETS.find(p=>p.id===b.dataset.preset)?.name===currentName));
function updateTrackLabels(){
  $('#track-name').textContent=currentName;$('#race-track-name').textContent=currentName;$('#track-length-label').textContent=`${Math.round(currentTrack.length)} m`;$('#track-corners-label').textContent=`${currentTrack.corners} 个弯道`;$('#difficulty-label').textContent=currentTrack.hairpins>3?'技术型':currentTrack.straightPercent>48?'高速型':'流畅型';
}
function setEditorVisible(visible:boolean){document.body.classList.toggle('drive-mode',!visible);$('#editor-tab').classList.toggle('active',visible);$('#drive-tab').classList.toggle('active',!visible);}
function setCamera(mode:CameraMode){game?.setCamera(mode);document.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach(b=>b.classList.toggle('selected',b.dataset.camera===mode));}
function applyDraft(){
  if(!draftTrack||!game)return;
  currentTrack=draftTrack;appliedPoints=editor.points.map(p=>({...p}));appliedSettings={...settings};currentName=draftName;
  physics.setTrack(currentTrack,appliedSettings);game.setTrack(currentTrack,appliedSettings);bestTime=Infinity;dirty=false;
  updateTrackLabels();setStatus('赛道已就绪，去找你的最佳走线。');toast('赛道生成完成，所有弯道已重新分析。');
}
function bestKey(){let h=2166136261;for(const c of JSON.stringify({points:appliedPoints,settings:appliedSettings})){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return `apex-best-${(h>>>0).toString(16)}`;}
function startDrive(){
  if(!game)return;if(dirty&&draftTrack)applyDraft();
  if(!currentTrack)return;
  physics.reset();keys.clear();touchKeys.clear();running=true;paused=false;countingDown=true;countdown=3.25;lapTime=0;lapNumber=1;checkpoint=0;lapStarted=false;lastProgress=0;
  bestTime=Number(safeStorage.get(bestKey()))||Infinity;
  document.body.classList.add('is-driving');setEditorVisible(false);setCamera('chase');
  for(const id of ['session-top','driving-hud','race-actions','mobile-controls'])$(`#${id}`).hidden=false;
  for(const id of ['hero-copy','session-card','kart-spec'])$(`#${id}`).hidden=true;
  $('#controls-hint').innerHTML='<span><kbd>W A S D</kbd> 驾驶</span><span><kbd>Space</kbd> 手刹</span><span><kbd>R</kbd> 复位</span><span class="hint-extra"><kbd>C</kbd> 视角 <kbd>Esc</kbd> 暂停</span>';
  $('#scene-label').textContent='自由练习';$('#render-status').textContent='物理模拟运行中';$('#lap-count').textContent='01';$('#best-time').textContent=formatTime(bestTime);$('#pause-button').innerHTML='<i data-lucide="pause"></i>';icons();
}
function exitDrive(){
  running=false;paused=false;countingDown=false;keys.clear();touchKeys.clear();physics.input={throttle:0,brake:0,steer:0,handbrake:false,reverse:false};
  document.body.classList.remove('is-driving');setEditorVisible(true);setCamera('orbit');
  for(const id of ['session-top','driving-hud','race-actions','mobile-controls','center-message'])$(`#${id}`).hidden=true;
  for(const id of ['hero-copy','session-card','kart-spec'])$(`#${id}`).hidden=false;
  $('#controls-hint').innerHTML='<span><kbd>拖动</kbd> 旋转视角</span><span><kbd>滚轮</kbd> 缩放</span><span class="hint-extra">探索你的赛道</span>';$('#scene-label').textContent='赛道预览';$('#render-status').textContent='3D 实时预览';
}
function pause(){if(!running)return;paused=!paused;keys.clear();touchKeys.clear();$('#center-message').hidden=!paused;$('#center-message').innerHTML=paused?'<span class="pause-title">休息一拍。</span><small>按 Esc 或点击暂停键继续</small>':'';$('#pause-button').innerHTML=`<i data-lucide="${paused?'play':'pause'}"></i>`;$('#pause-button').setAttribute('aria-label',paused?'继续':'暂停');icons();}
function resetKart(){if(!running)return;const near=nearestOnTrack(currentTrack,physics.body.position);physics.reset(near.index);keys.clear();touchKeys.clear();lapTime=0;lapStarted=false;checkpoint=0;lastProgress=near.index/currentTrack.samples.length;toast('已在最近路段复位，本圈计时已重置。');}

document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(b=>b.addEventListener('click',()=>{editor.setTool(b.dataset.tool as any);document.querySelectorAll('[data-tool]').forEach(x=>x.classList.toggle('selected',x===b));setStatus(b.dataset.tool==='draw'?'按住鼠标或手指，一笔画出不交叉的环线。':'拖动圆点，调整路线；点击生成应用。');}));
document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(b=>b.addEventListener('click',()=>{const p=PRESETS.find(p=>p.id===b.dataset.preset)!;draftName=p.name;editor.setPoints(p.points);editor.setTool('edit');document.querySelectorAll('[data-tool]').forEach(x=>x.classList.toggle('selected',(x as HTMLElement).dataset.tool==='edit'));document.querySelectorAll('[data-preset]').forEach(x=>x.classList.toggle('selected',x===b));}));
$('#new-button').addEventListener('click',()=>{editor.clear();draftName='我的手绘赛道';document.querySelectorAll('[data-preset]').forEach(x=>x.classList.remove('selected'));document.querySelectorAll('[data-tool]').forEach(x=>x.classList.toggle('selected',(x as HTMLElement).dataset.tool==='draw'));$('#track-canvas').focus();});
$('#clear-button').addEventListener('click',()=>$('#new-button').click());$('#undo-button').addEventListener('click',()=>editor.undo());
$('#width-range').addEventListener('input',e=>{settings.width=Number((e.target as HTMLInputElement).value);syncSettings();editor.updateSettings(settings);});
$('#smooth-range').addEventListener('input',e=>{settings.smoothness=Number((e.target as HTMLInputElement).value);syncSettings();editor.updateSettings(settings);});
$('#curbs-toggle').addEventListener('change',e=>{settings.curbs=(e.target as HTMLInputElement).checked;editor.updateSettings(settings);});
$('#barriers-toggle').addEventListener('change',e=>{settings.barriers=(e.target as HTMLInputElement).checked;editor.updateSettings(settings);});
$('#generate-button').addEventListener('click',applyDraft);$('#start-button').addEventListener('click',startDrive);$('#drive-tab').addEventListener('click',()=>running?setEditorVisible(false):startDrive());$('#editor-tab').addEventListener('click',()=>{if(running)exitDrive();else setEditorVisible(true);});$('#exit-button').addEventListener('click',exitDrive);$('#pause-button').addEventListener('click',pause);$('#reset-button').addEventListener('click',resetKart);
document.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach(b=>b.addEventListener('click',()=>setCamera(b.dataset.camera as CameraMode)));
document.querySelectorAll<HTMLButtonElement>('[data-color]').forEach(b=>b.addEventListener('click',()=>{game?.setColor(b.dataset.color!);document.querySelectorAll('[data-color]').forEach(x=>x.classList.toggle('selected',x===b));}));
$('#sound-button').addEventListener('click',async()=>{try{const enabled=await audio.toggle();$('#sound-button').innerHTML=`<i data-lucide="${enabled?'volume-2':'volume-x'}"></i>`;$('#sound-button').setAttribute('aria-label',enabled?'关闭引擎声音':'开启引擎声音');icons();toast(enabled?'引擎声音已开启':'引擎声音已关闭');}catch{toast('当前浏览器暂时无法启动音频。');}});
function trackFile():TrackFile{return {version:1,name:draftName,points:editor.points,settings:{...settings}};}
$('#save-button').addEventListener('click',()=>{if(!draftTrack){toast('请先画出一条有效赛道。');return;}toast(safeStorage.set('apex-track-v1',JSON.stringify(trackFile()))?'赛道已保存到此浏览器，下次打开会自动恢复。':'浏览器存储不可用，请使用「导出 JSON」备份。');});
$('#export-button').addEventListener('click',()=>{if(!draftTrack){toast('请先画出一条有效赛道。');return;}const blob=new Blob([JSON.stringify(trackFile(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`apex-${draftName}.json`;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),2000);toast('赛道 JSON 已导出。');});
$('#import-button').addEventListener('click',()=>$<HTMLInputElement>('#file-input').click());
$('#file-input').addEventListener('change',async e=>{const input=e.target as HTMLInputElement,file=input.files?.[0];if(!file)return;try{if(file.size>1e6)throw new Error('文件太大，请使用小于 1 MB 的赛道 JSON。');const data=parseTrackFile(await file.text());settings={...data.settings};draftName=data.name;editor.settings={...settings};syncSettings();editor.setPoints(data.points);document.querySelectorAll('[data-preset]').forEach(x=>x.classList.remove('selected'));toast('赛道已导入，点击「生成赛道」预览。');}catch(error){toast((error as Error).message);}input.value='';});
$('#help-button').addEventListener('click',()=>{if(running&&!paused)pause();$<HTMLDialogElement>('#help-dialog').showModal();});document.querySelectorAll('.close-help').forEach(b=>b.addEventListener('click',()=>$<HTMLDialogElement>('#help-dialog').close()));$<HTMLDialogElement>('#help-dialog').addEventListener('click',e=>{if(e.target===$('#help-dialog'))$<HTMLDialogElement>('#help-dialog').close();});
$('#fullscreen-button').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('.viewport').requestFullscreen();}catch{toast('当前浏览器不支持全屏，可以缩放页面查看。');}});
window.addEventListener('keydown',e=>{
  const target=e.target as HTMLElement;if(target.matches('input,textarea,select'))return;
  if($<HTMLDialogElement>('#help-dialog').open)return;
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)&&running)e.preventDefault();
  if(e.repeat){keys.add(e.code);return;}
  if(e.code==='Escape'){if(running)pause();return;}if(e.code==='KeyR'){resetKart();return;}
  if(e.code==='KeyC'&&running){const modes:CameraMode[]=['chase','top','cockpit','orbit'];setCamera(modes[(modes.indexOf(game?.mode||'chase')+1)%modes.length]);return;}
  if((e.ctrlKey||e.metaKey)&&e.code==='KeyZ'&&!running){e.preventDefault();editor.undo();return;}
  keys.add(e.code);
});window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{keys.clear();touchKeys.clear();if(running&&!paused)pause();});document.addEventListener('visibilitychange',()=>{if(document.hidden&&running&&!paused)pause();});
document.querySelectorAll<HTMLButtonElement>('[data-control]').forEach(b=>{const release=()=>{touchKeys.delete(b.dataset.control!);b.classList.remove('pressed');};b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);touchKeys.add(b.dataset.control!);b.classList.add('pressed');});b.addEventListener('pointerup',release);b.addEventListener('pointercancel',release);b.addEventListener('lostpointercapture',release);});

function updateLap(dt:number){
  const near=nearestOnTrack(currentTrack,physics.body.position),progress=near.index/currentTrack.samples.length;
  if(!lapStarted){lapStarted=true;lapTime=0;}
  lapTime+=dt;
  // Sequential gates require a complete lap in the intended direction; a start-line oscillation cannot score.
  if(near.distance<currentTrack.width/2+1){
    if(checkpoint===0&&progress>.18&&progress<.32)checkpoint=1;
    if(checkpoint===1&&progress>.43&&progress<.57)checkpoint=2;
    if(checkpoint===2&&progress>.68&&progress<.82)checkpoint=3;
    if(checkpoint===3&&lastProgress>.92&&progress<.08&&physics.telemetry.signedSpeed>1){if(lapTime<bestTime){bestTime=lapTime;safeStorage.set(bestKey(),String(bestTime));toast(`新最佳圈速 ${formatTime(bestTime)}`);}lapNumber++;lapTime=0;checkpoint=0;$('#lap-count').textContent=String(lapNumber).padStart(2,'0');$('#best-time').textContent=formatTime(bestTime);}
  }
  lastProgress=progress;
}
function updateMinimap(){const canvas=$<HTMLCanvasElement>('#minimap'),c=canvas.getContext('2d')!;c.clearRect(0,0,260,190);const b=currentTrack.bounds,s=Math.min(218/(b.maxX-b.minX),140/(b.maxZ-b.minZ)),map=(p:Point)=>({x:130+(p.x-(b.maxX+b.minX)/2)*s,y:95+(p.z-(b.maxZ+b.minZ)/2)*s});c.lineWidth=4;c.lineJoin='round';c.strokeStyle='#647d6d';c.beginPath();currentTrack.samples.forEach((p,i)=>{const v=map(p);i?c.lineTo(v.x,v.y):c.moveTo(v.x,v.y);});c.closePath();c.stroke();const st=map(currentTrack.samples[0]);c.fillStyle='#bcd888';c.fillRect(st.x-3,st.y-3,6,6);const p=map(physics.body.position);c.fillStyle='#dcf57a';c.shadowColor='#c4ee52';c.shadowBlur=9;c.beginPath();c.arc(p.x,p.y,5,0,Math.PI*2);c.fill();c.shadowBlur=0;}
function updateHUD(){const t=physics.telemetry;$('#speed').textContent=String(Math.round(t.speed));$('#gear').textContent=t.signedSpeed<-1?'R':t.speed<1?'N':'D';$('#rpm-label').textContent=`${Math.round(t.rpm/100)*100} RPM`;$('#lap-time').textContent=formatTime(lapTime);$('#surface-label').textContent=t.offroad?'草地 · 抓地降低':'干燥沥青';$('#grip-label').textContent=t.offroad?'草地低抓地':t.grip<.65?'轮胎滑移':'正常抓地';$('#g-dot').style.transform=`translate(${Math.max(-22,Math.min(22,t.lateralG*15))}px,${Math.max(-22,Math.min(22,t.longitudinalG*15))}px)`;document.querySelectorAll<HTMLElement>('.rpm-bars span').forEach((b,i)=>b.classList.toggle('lit',i<Math.round(t.rpm/12000*22)));updateMinimap();}
function animate(now:number){
  const dt=Math.min((now-lastTime)/1000,.06);lastTime=now;
  if(game){
    if(running&&!paused){
      if(countingDown){countdown-=dt;physics.input={throttle:0,brake:1,steer:0,handbrake:false,reverse:false};physics.step(dt);$('#center-message').hidden=false;$('#center-message').innerHTML=countdown>.3?`<span class="countdown-number">${Math.ceil(countdown-.3)}</span><small>找到节奏，瞄准弯心。</small>`:'<span class="countdown-go">GO.</span>';if(countdown<-.6){countingDown=false;$('#center-message').hidden=true;}}
      else{
        const accel=keys.has('KeyW')||keys.has('ArrowUp')||touchKeys.has('throttle'),brake=keys.has('KeyS')||keys.has('ArrowDown')||touchKeys.has('brake'),left=keys.has('KeyA')||keys.has('ArrowLeft')||touchKeys.has('left'),right=keys.has('KeyD')||keys.has('ArrowRight')||touchKeys.has('right');
        physics.input={throttle:accel?1:0,brake:brake&&physics.telemetry.signedSpeed>1?1:0,reverse:brake&&physics.telemetry.signedSpeed<=1&&!accel,steer:(left?1:0)-(right?1:0),handbrake:keys.has('Space')};physics.step(dt);updateLap(dt);
        if(physics.body.position.y<-4||physics.body.position.y>15||Math.abs(physics.body.position.x)>700||Math.abs(physics.body.position.z)>700)resetKart();
      }
    }else if(!running){physics.input={throttle:0,brake:.4,steer:0,handbrake:false,reverse:false};physics.step(dt);}
    game.update(dt,running&&!paused);audio.update(physics.telemetry.rpm,physics.input.throttle,running&&!paused&&!countingDown);
    hudElapsed+=dt;if(hudElapsed>.05){if(running)updateHUD();hudElapsed=0;}
  }
  fpsAccum+=dt;fpsFrames++;if(fpsAccum>1){$('#fps').textContent=`${Math.round(fpsFrames/fpsAccum)} FPS`;fpsAccum=0;fpsFrames=0;}
  requestAnimationFrame(animate);
}
try{game=new GameScene($('#scene-container'),physics);physics.setTrack(currentTrack,settings);game.setTrack(currentTrack,settings);game.onContextLost=()=>{if(running&&!paused)pause();toast('图形上下文中断，请重新加载页面恢复 3D。');};$('#loading-screen').classList.add('loaded');window.setTimeout(()=>$('#loading-screen').remove(),700);requestAnimationFrame(animate);}
catch(error){$('#loading-screen').remove();$('#error-overlay').hidden=false;$('#error-message').textContent=`请使用支持 WebGL 2 的浏览器并开启硬件加速。${(error as Error).message}`;}

// Read-only state for reproducible browser QA and integrations.
Object.defineProperty(window,'apex',{get:()=>({track:currentTrack,physics,editor,game,running,paused,countingDown,lapTime,lapNumber,checkpoint,dirty})});
