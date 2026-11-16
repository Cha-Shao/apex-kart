export const START_LIGHT_COUNT=4;
const FIRST_LIGHT_DELAY=.7,LIGHT_INTERVAL=.7;

/** Advance with driving time so pausing also freezes the starting procedure. */
export class StartSequence {
  waiting=false;
  active=false;
  falseStart=false;
  released=false;
  reactionTime:number|null=null;
  private elapsed=0;
  private releaseAt=Infinity;
  private resuming=false;

  get needsHandbrake(){return this.waiting||this.resuming;}
  get awaitingLaunch(){return this.released&&this.reactionTime===null;}

  get litCount(){
    return this.active?Math.min(START_LIGHT_COUNT,Math.max(0,Math.floor((this.elapsed-FIRST_LIGHT_DELAY)/LIGHT_INTERVAL)+1)):0;
  }
  start(){
    this.waiting=false;this.falseStart=false;this.released=false;this.reactionTime=null;this.resuming=false;
    this.elapsed=0;
    // Pick once per start; the fully lit signal gives no hint of the release.
    this.releaseAt=FIRST_LIGHT_DELAY+(START_LIGHT_COUNT-1)*LIGHT_INTERVAL+1.2+Math.random()*2.2;
    this.active=true;
  }
  prepare(){this.clear();this.waiting=true;}
  suspend(){if((this.active&&!this.falseStart)||this.awaitingLaunch)this.resuming=true;}
  advance(dt:number,handbrake=true,throttle=0){
    if(this.waiting){
      if(!handbrake)return false;
      this.start();dt=0;
    }
    if(!this.active&&!this.awaitingLaunch)return false;
    // Pause/focus loss clears input. Require a fresh hold before continuing,
    // rather than interpreting that cleared input as a false start.
    if(this.resuming){if(!handbrake&&throttle<=.01)return false;this.resuming=false;dt=0;}
    this.elapsed+=dt;
    const launching=!handbrake||throttle>.01;
    if(this.active&&this.elapsed<this.releaseAt){
      if(!this.falseStart&&launching){this.falseStart=true;this.reactionTime=this.elapsed-this.releaseAt;}
      return false;
    }
    // Freeze the first launch input relative to the actual lights-out time,
    // including the fraction of the frame after the signal was extinguished.
    if(this.reactionTime===null&&launching)this.reactionTime=this.elapsed-this.releaseAt;
    if(!this.active)return false;
    this.active=false;this.released=true;
    return true;
  }
  clear(){this.waiting=false;this.active=false;this.falseStart=false;this.released=false;this.reactionTime=null;this.resuming=false;this.elapsed=0;this.releaseAt=Infinity;}
}
