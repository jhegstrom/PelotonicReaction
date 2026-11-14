import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { createAppServer } from '../server.mjs';
import { StravaService } from '../lib/strava-service.mjs';
import { stravaEnvironment } from '../lib/strava-config.mjs';
import { prepareUserData, desktopPort } from './paths.mjs';
const appRoot=fileURLToPath(new URL('..',import.meta.url));
app.setName('PelotonicReaction');
if(process.env.PELOTONIC_DATA_DIR)app.setPath('userData',path.resolve(process.env.PELOTONIC_DATA_DIR));
let window,server,quitting=false;
let state={ready:false,message:'Starting workout server…',urls:[],dataRoot:app.getPath('userData'),platform:process.platform};
const push=()=>window?.webContents.send('server-state',state);
if(!app.requestSingleInstanceLock())app.quit();
else {
  app.on('second-instance',()=>{window?.show();window?.focus();});
  app.whenReady().then(async()=>{
    Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'PelotonicReaction',submenu:[{role:'about'},{type:'separator'},{role:'quit'}]},{role:'editMenu'},{role:'windowMenu'}]));
    window=new BrowserWindow({width:670,height:640,minWidth:540,minHeight:520,title:'PelotonicReaction',backgroundColor:'#11171c',show:false,
      icon:path.join(appRoot,'public/assets/pelotonicreaction-logo-512.png'),
      webPreferences:{preload:fileURLToPath(new URL('./preload.cjs',import.meta.url)),nodeIntegration:false,contextIsolation:true,sandbox:true}});
    const trusted=event=>event.sender===window?.webContents&&event.senderFrame===window?.webContents.mainFrame;
    ipcMain.handle('server-state',event=>trusted(event)?state:null);
    ipcMain.handle('open-workouts',async event=>{if(trusted(event)&&state.ready)await shell.openExternal(state.urls[0]);});
    ipcMain.handle('open-data',async event=>{if(trusted(event))await shell.openPath(state.dataRoot);});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.on('will-navigate',event=>event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    window.once('ready-to-show',()=>window.show());
    await window.loadFile(path.join(appRoot,'desktop/index.html'));
    try {
      const {dataRoot,workoutsRoot}=await prepareUserData(appRoot,state.dataRoot);
      const port=desktopPort(process.env);
      const strava=new StravaService(dataRoot,{env:{...await stravaEnvironment(dataRoot),PORT:String(port)}});
      const helperPath=app.isPackaged&&process.platform==='darwin'?path.join(process.resourcesPath,'bike-helper','Grupetto Bridge.app','Contents','MacOS','GrupettoWiFi'):null;
      server=createAppServer(appRoot,{dataRoot,workoutsRoot,helperPath,strava});
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'0.0.0.0',resolve);});
      const addresses=[...new Set(Object.values(os.networkInterfaces()).flat().filter(i=>i?.family==='IPv4'&&!i.internal).map(i=>i.address))];
      state={...state,ready:true,message:'Workout server is running.',urls:[`http://localhost:${port}`,...addresses.map(ip=>`http://${ip}:${port}`)]};push();
      void strava.refresh();
      server.on('error',()=>{state={...state,ready:false,message:'The workout server stopped. Quit and reopen the app.'};push();});
    } catch(e) {
      state={...state,ready:false,message:e.code==='EADDRINUSE'?'Port is already in use. Stop the command-line workout server, then quit and reopen this app.':'The workout server could not start. Check the data-folder permissions and configuration.'};
      server?.close();push();
    }
  }).catch(()=>app.quit());
  app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
  app.on('activate',()=>{window?.show();});
  // Keep the hub alive when the Mac window is closed; the bike may still be riding.
  app.on('browser-window-created',(_event,browserWindow)=>browserWindow.on('close',event=>{if(!quitting&&process.platform==='darwin'){event.preventDefault();browserWindow.hide();}}));
  app.on('before-quit',event=>{
    if(quitting)return;
    quitting=true;
    if(server?.listening){event.preventDefault();server.closeAllConnections();server.close(()=>app.quit());setTimeout(()=>app.quit(),3000).unref();}
  });
}
