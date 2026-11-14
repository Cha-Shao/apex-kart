export type PadStatus='waiting'|'connected'|'unsupported'|'unavailable';
export class GamepadController {
  status:PadStatus='waiting';
  name='';
  throttle=0;brake=0;steer=0;handbrake=false;reverse=false;
  start=false;confirm=false;reset=false;view=false;exit=false;
  private index:number|null=null;
  private buttons=0;
  private armed=false;
  private blocked=false;
  suspend(){this.armed=false;this.throttle=0;this.brake=0;this.steer=0;this.handbrake=false;this.reverse=false;}
  poll(){
    this.throttle=0;this.brake=0;this.steer=0;this.handbrake=false;this.reverse=false;
    this.start=false;this.confirm=false;this.reset=false;this.view=false;this.exit=false;
    if(this.blocked||typeof navigator.getGamepads!=='function'){this.status='unavailable';return;}
    let pads:(Gamepad|null)[];
    try{pads=Array.from(navigator.getGamepads());}catch{this.blocked=true;this.status='unavailable';this.suspend();return;}
    const previous=this.index===null?null:pads[this.index];
    const pad=previous?.connected?previous:pads.find(p=>p?.connected&&p.mapping==='standard')??pads.find(p=>p?.connected);
    if(!pad){this.status='waiting';this.name='';this.index=null;this.buttons=0;this.suspend();return;}
    this.name=pad.id;
    if(pad.mapping!=='standard'){this.status='unsupported';this.index=null;this.suspend();return;}
    this.status='connected';
    let mask=0;for(let i=0;i<Math.min(pad.buttons.length,20);i++)if(pad.buttons[i].pressed||pad.buttons[i].value>.5)mask|=1<<i;
    const value=(i:number)=>Math.max(0,Math.min(1,pad.buttons[i]?.value??0));
    const axis=Math.max(-1,Math.min(1,Number.isFinite(pad.axes[0])?pad.axes[0]:0));
    if(this.index!==pad.index){this.index=pad.index;this.buttons=mask;this.suspend();}
    // Re-arm only after releasing controls: no stuck throttle after reconnect,
    // focus loss, reset or pause. Read fresh Gamepad objects each animation frame.
    if(document.hidden||!document.hasFocus()){this.buttons=mask;this.suspend();return;}
    if(!this.armed){this.buttons=mask;if(Math.abs(axis)<.14&&mask===0&&value(6)<.06&&value(7)<.06)this.armed=true;return;}
    const pressed=mask&~this.buttons;this.buttons=mask;
    const trigger=(v:number)=>v<.04?0:(v-.04)/.96;
    this.throttle=trigger(value(7));this.brake=trigger(value(6));
    const stick=Math.abs(axis)<=.12?0:Math.sign(axis)*Math.pow((Math.abs(axis)-.12)/.88,1.45);
    const dpad=((mask&(1<<14))?1:0)-((mask&(1<<15))?1:0);
    this.steer=dpad||-stick;
    this.handbrake=!!(mask&1);this.reverse=!!(mask&(1<<1));
    this.confirm=!!(pressed&1);this.start=!!(pressed&(1<<9));this.reset=!!(pressed&(1<<3));this.view=!!(pressed&(1<<2));this.exit=!!(pressed&(1<<8));
  }
}
