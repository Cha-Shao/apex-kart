export type SectorColor='yellow'|'green'|'purple';
export class SectorTiming {
  time=0;sector=0;start=0;previousProgress=0;lap=1;
  splits:number[]=[];best=[Infinity,Infinity,Infinity];previous=[Infinity,Infinity,Infinity];colors:SectorColor[]=['yellow','yellow','yellow'];
  history:{lap:number;time:number;splits:number[]}[]=[];
  reset(){this.time=0;this.sector=0;this.start=0;this.previousProgress=0;this.lap=1;this.splits=[];this.best=[Infinity,Infinity,Infinity];this.previous=[Infinity,Infinity,Infinity];this.colors=['yellow','yellow','yellow'];this.history=[];}
  update(dt:number,progress:number,valid:boolean,forward:boolean){this.time+=dt;let completed=false;if(valid&&forward){const crossed=this.sector<2?this.previousProgress<(this.sector+1)/3&&progress>=(this.sector+1)/3&&progress-this.previousProgress<.12:this.previousProgress>.9&&progress<.1;if(crossed){const duration=this.time-this.start,i=this.sector;this.splits[i]=duration;this.colors[i]=duration<this.best[i]?'purple':duration<this.previous[i]?'green':'yellow';this.best[i]=Math.min(this.best[i],duration);this.start=this.time;if(i===2){this.history.unshift({lap:this.lap,time:this.time,splits:[...this.splits]});this.history=this.history.slice(0,10);this.previous=[...this.splits];this.lap++;this.time=0;this.start=0;this.sector=0;this.splits=[];completed=true;}else this.sector++;}}this.previousProgress=progress;return completed;}
}
