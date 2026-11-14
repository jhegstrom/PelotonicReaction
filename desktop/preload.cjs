const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pelotonic',{
  state:()=>ipcRenderer.invoke('server-state'),
  openWorkouts:()=>ipcRenderer.invoke('open-workouts'),
  openData:()=>ipcRenderer.invoke('open-data'),
  onState:callback=>ipcRenderer.on('server-state',(_event,state)=>callback(state)),
});
