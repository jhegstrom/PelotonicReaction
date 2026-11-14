const $=id=>document.getElementById(id);
function render(state){
  if(!state)return;
  $('status').textContent=state.message;$('open').disabled=!state.ready;
  $('addresses').replaceChildren();
  for(const url of state.urls.slice(1)){const item=document.createElement('li');item.textContent=url;$('addresses').append(item);}
  if(state.ready&&state.urls.length===1)$('addresses').textContent='No network address found. Check your network connection.';
  $('platform').textContent=state.platform==='darwin'?'Closing this window keeps the bike server running. Use Quit to stop it.':'Live Grupetto telemetry currently requires the Mac app. This version supports the workout player, profiles and saved rides.';
}
$('open').onclick=()=>window.pelotonic.openWorkouts();$('data').onclick=()=>window.pelotonic.openData();
window.pelotonic.onState(render);window.pelotonic.state().then(render);
