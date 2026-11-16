import {createRoot} from 'react-dom/client';
import type {LapRecord} from '../timing';
import './lap-times.css';

interface LapTimesProps {
  currentTime:number;
  currentLap:number;
  currentInvalid:boolean;
  currentInvalidCount:number;
  history:readonly LapRecord[];
}

function lapTime(seconds:number){
  const milliseconds=Math.max(0,Math.round(seconds*1000));
  const minutes=Math.floor(milliseconds/60000),remainder=milliseconds%60000;
  return `${String(minutes).padStart(2,'0')}:${String(Math.floor(remainder/1000)).padStart(2,'0')}.${String(remainder%1000).padStart(3,'0')}`;
}

function LapBadge({kind,count=0}:{kind:'fastest'|'invalid';count?:number}){
  const label=kind==='fastest'?'最近十圈中最快的有效圈':`本圈违规 ${count} 次（抢跑或四轮完全驶出白线）`;
  return <span className={`lap-result-badge lap-result-badge--${kind}`} role="img" aria-label={label} title={label}>
    {kind==='fastest'
      ?<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 2h4M12 10v4l2 1M18 7l2-2"/><circle cx="12" cy="14" r="8"/></svg>
      :<><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="10" y="3" width="4" height="13"/><rect x="10" y="18" width="4" height="4"/></svg><b className="lap-result-count" aria-hidden="true">{count}</b></>}
  </span>;
}

export function LapTimes({currentTime,currentLap,currentInvalid,currentInvalidCount,history}:LapTimesProps){
  const laps=history.slice(0,10);
  const validLaps=laps.filter(lap=>!lap.invalid);
  const fastestMilliseconds=validLaps.length?Math.min(...validLaps.map(lap=>Math.round(lap.time*1000))):Infinity;
  // A single badge remains deterministic when two laps tie at displayed precision.
  const fastestIndex=validLaps.length?laps.findIndex(lap=>!lap.invalid&&Math.round(lap.time*1000)===fastestMilliseconds):-1;
  return <section className="lap-times-card" aria-label="当前圈速和最近十圈成绩">
    <div className={`lap-times-current${currentInvalid?' lap-times-current--invalid':''}`}>
      <span className="lap-times-sr">当前第 {currentLap} 圈</span>
      <output aria-label="当前圈速">{lapTime(currentTime)}</output>
      {currentInvalid&&<div className="lap-result-badges"><LapBadge kind="invalid" count={currentInvalidCount}/></div>}
    </div>
    {laps.length>0&&<div className="lap-results" role="table" aria-label="圈速、相对最快圈差值与三个赛段成绩">
      <div role="rowgroup">
        {laps.map((lap,index)=>{
          const fastest=index===fastestIndex;
          const hasBaseline=Number.isFinite(fastestMilliseconds);
          const delta=(Math.round(lap.time*1000)-fastestMilliseconds)/1000;
          const deltaLabel=delta>=0?`+${delta.toFixed(3)}`:delta.toFixed(3);
          return <div className={`lap-result-row${fastest?' lap-result-row--fastest':''}${lap.invalid?' lap-result-row--invalid':''}`} role="row" key={lap.lap}>
            <span className="lap-result-number" role="cell">L{String(lap.lap).padStart(2,'0')}</span>
            <span className="lap-result-time" role="cell" aria-label={fastest?'最快圈 '+lapTime(lap.time):hasBaseline?`与最快有效圈相差 ${deltaLabel} 秒，圈速 ${lapTime(lap.time)}`:'圈速 '+lapTime(lap.time)} title={`圈速 ${lapTime(lap.time)}`}>
              <span>{fastest||!hasBaseline?lapTime(lap.time):deltaLabel}</span>
              {!fastest&&hasBaseline&&<small className="lap-result-absolute">{lapTime(lap.time)}</small>}
            </span>
            <div className="lap-result-sectors" role="cell" aria-label="三个赛段成绩">
              {[0,1,2].map(sector=><span key={sector} title={`Sector ${sector+1}`}>{(lap.splits[sector]??0).toFixed(3)}</span>)}
            </div>
            {(fastest||lap.invalid)&&<div className="lap-result-badges">
              {fastest&&<LapBadge kind="fastest"/>}
              {lap.invalid&&<LapBadge kind="invalid" count={lap.invalidCount}/>}
            </div>}
          </div>;
        })}
      </div>
    </div>}
  </section>;
}

export function mountLapTimes(host:HTMLElement){
  const root=createRoot(host);
  return {update(props:LapTimesProps){root.render(<LapTimes {...props}/>);},destroy(){root.unmount();}};
}
