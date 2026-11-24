// Audio is optional. Its resume promise may remain pending until the browser
// permits playback; it must never gate Start or later restart a paused timer.
export function startWorkout(clock,{begin,enableAudio}){
  begin();
  clock.start(clock.read()===0?10:0);
  try{Promise.resolve(enableAudio()).catch(()=>{});}catch{}
}
