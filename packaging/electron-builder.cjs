const signed=process.env.PELOTONIC_SIGNED_RELEASE==='1';
module.exports={
  appId:'com.pelotonicreaction.desktop',productName:'PelotonicReaction',asar:true,
  directories:{output:'dist',buildResources:'packaging'},
  artifactName:'${productName}-${version}-${os}-${arch}.${ext}',
  files:['desktop/**','lib/**','public/**','workouts/*.json','server.mjs','package.json','.env.example','README.md',
    '!**/.env','!**/.data/**','!**/.git/**','!**/.build/**','!**/*.log'],
  npmRebuild:false,
  mac:{target:['pkg'],category:'public.app-category.healthcare-fitness',minimumSystemVersion:'13.0',hardenedRuntime:signed,entitlements:'packaging/entitlements.mac.plist',entitlementsInherit:'packaging/entitlements.mac.plist',
    icon:'public/assets/pelotonicreaction-logo-512.png',identity:signed?undefined:'-',notarize:signed,
    extraResources:[{from:'.packaging/helper/Grupetto Bridge.app',to:'bike-helper/Grupetto Bridge.app'}],
    extendInfo:{NSLocalNetworkUsageDescription:'Host the workout screen and discover Grupetto bikes on your private network.',NSBonjourServices:['_wahoo-fitness-tnp._tcp']}},
  pkg:{identity:signed?undefined:null,installLocation:'/Applications',allowAnywhere:false,allowCurrentUserHome:false,
    mustClose:['com.pelotonicreaction.desktop'],welcome:'packaging/welcome.html'},
  win:{target:['msi'],icon:'public/assets/pelotonicreaction-logo-512.png'},
  msi:{oneClick:false,perMachine:false,runAfterFinish:false,createDesktopShortcut:true,createStartMenuShortcut:true},
  linux:{target:['deb','rpm'],icon:'public/assets/pelotonicreaction-logo-512.png',category:'Sports',
    maintainer:'PelotonicReaction',synopsis:'Indoor cycling workout player and recording hub'},
};
