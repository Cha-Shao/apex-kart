export const START_LIGHT_COUNT=4;
const FIRST_LIGHT_DELAY=.7,LIGHT_INTERVAL=.7;

/** Advance with driving time so pausing also freezes the starting procedure. */
export class StartSequence {
  active=false;
  private elapsed=0;
  private releaseAt=Infinity;

  get litCount(){
    return this.active?Math.min(START_LIGHT_COUNT,Math.max(0,Math.floor((this.elapsed-FIRST_LIGHT_DELAY)/LIGHT_INTERVAL)+1)):0;
  }
  start(){
    this.elapsed=0;
    // Pick once per start; the fully lit signal gives no hint of the release.
    this.releaseAt=FIRST_LIGHT_DELAY+(START_LIGHT_COUNT-1)*LIGHT_INTERVAL+1.2+Math.random()*2.2;
    this.active=true;
  }
  advance(dt:number){
    if(!this.active)return false;
    this.elapsed+=dt;
    if(this.elapsed<this.releaseAt)return false;
    this.active=false;
    return true;
  }
  clear(){this.active=false;this.elapsed=0;this.releaseAt=Infinity;}
}
