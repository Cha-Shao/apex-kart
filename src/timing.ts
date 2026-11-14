export type SectorColor='yellow'|'green'|'purple';
export interface LapRecord {lap:number;time:number;splits:number[];invalid:boolean}
export class SectorTiming {
  time=0;sector=0;start=0;previousProgress=0;lap=1;
  invalid=false;
  splits:number[]=[];best=[Infinity,Infinity,Infinity];previous=[Infinity,Infinity,Infinity];colors:SectorColor[]=['yellow','yellow','yellow'];
  history:LapRecord[]=[];
  reset(){this.time=0;this.sector=0;this.start=0;this.previousProgress=0;this.lap=1;this.invalid=false;this.splits=[];this.best=[Infinity,Infinity,Infinity];this.previous=[Infinity,Infinity,Infinity];this.colors=['yellow','yellow','yellow'];this.history=[];}
  restartLap(){this.time=0;this.sector=0;this.start=0;this.previousProgress=0;this.invalid=false;this.splits=[];this.colors=['yellow','yellow','yellow'];}
  update(dt:number,progress:number,valid:boolean,forward:boolean,fourWheelsOutside=false){
    this.time+=dt;this.invalid ||= fourWheelsOutside;
    if(this.invalid)this.colors=['yellow','yellow','yellow'];
    let completed=false;
    if(valid&&forward){
      const crossed=this.sector<2?this.previousProgress<(this.sector+1)/3&&progress>=(this.sector+1)/3&&progress-this.previousProgress<.12:this.previousProgress>.9&&progress<.1;
      if(crossed){
        const duration=this.time-this.start,i=this.sector;this.splits[i]=duration;
        this.colors[i]=this.invalid?'yellow':duration<this.best[i]?'purple':duration<this.previous[i]?'green':'yellow';this.start=this.time;
        if(i===2){
          this.history.unshift({lap:this.lap,time:this.time,splits:[...this.splits],invalid:this.invalid});this.history=this.history.slice(0,10);
          // Commit sector benchmarks only once the whole lap is valid. A later
          // track-limits violation cannot leave behind a false purple sector.
          if(!this.invalid){for(let j=0;j<3;j++)this.best[j]=Math.min(this.best[j],this.splits[j]);this.previous=[...this.splits];}
          this.lap++;this.restartLap();completed=true;
        }else this.sector++;
      }
    }
    this.previousProgress=progress;return completed;
  }
}
