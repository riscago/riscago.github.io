/* ================= Electron Push — 광고 모듈 =================
   config.js 의 ADS_CONFIG 를 읽어서 동작합니다. (이 파일은 고칠 필요 없음)
   - 앱(Capacitor, 안드로이드·iOS): AdMob — @capacitor-community/admob 플러그인
   - 웹(PWA): AdSense — client·slot 을 채웠을 때만
   광고 원칙
   - 배너: 홈·단원 목록 화면 아래쪽에만. 화살표를 그리는 보드 화면엔 절대 띄우지 않음(오클릭 방지)
   - 전면 광고: 저절로 뜨는 광고는 없음. config.js 의 specialUnits 로 지정한 '특별 단원'을 열 때만,
     사용자가 직접 '광고 보고 열기'를 누르면 보상형 광고 1회 → 그 단원이 열림
   - 광고를 못 불러오면(오프라인·광고 없음) 그냥 열어 줌. 웹·단일 파일판에선 특별 단원도 잠그지 않음
*/
(function(){
  'use strict';
  const C=window.ADS_CONFIG||{provider:'none'};
  const cap=window.Capacitor;
  const isNative=!!(cap&&cap.isNativePlatform&&cap.isNativePlatform());
  const platform=isNative&&cap.getPlatform?cap.getPlatform():'web';   // 'android' | 'ios' | 'web'
  const adsenseReady=!!(C.adsense&&/^ca-pub-\d{10,}$/.test(C.adsense.client||'')&&C.adsense.slot);
  let provider=C.provider||'none';
  if(provider==='auto')provider=isNative?'admob':(adsenseReady?'adsense':'none');
  if(provider==='admob'&&!isNative)provider='none';
  if(provider==='adsense'&&(isNative||!adsenseReady))provider='none';   // AdSense는 앱 WebView 안에서 쓰면 안 됨

  const num=(v,d)=>typeof v==='number'&&isFinite(v)&&v>=0?v:d;   // 0도 올바른 설정값으로 취급
  const special=new Set((Array.isArray(C.specialUnits)?C.specialUnits:[]).map(Number));
  const unlockHours=num(C.unlockHours,0);
  // allowed: null=아직 모름, true=광고 가능, false=광고 불가(플러그인 없음·초기화 실패·동의 거부) → 잠그지 않음
  const S={ready:false,allowed:provider==='admob'?null:false,view:'home',bannerOn:false,bannerHidden:false,h:0,rewReady:false,rewLoading:null};
  const bar=()=>document.getElementById('adBar');
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const withTimeout=(p,ms)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),ms))]);
  function notify(){try{if(typeof window.Ads.onChange==='function')window.Ads.onChange();}catch(e){}}
  function setBar(h){
    S.h=h||0;
    document.documentElement.style.setProperty('--ad-h',(S.view==='play'?0:S.h)+'px');
    const b=bar();if(b)b.hidden=!(S.h>0&&S.view!=='play');
  }

  /* ---------- 특별 단원 잠금 기록 (기기에만 저장) ---------- */
  const UKEY='electronPush.unlocked',mem={};
  function unlocks(){try{return Object.assign({},mem,JSON.parse(localStorage.getItem(UKEY)||'{}')||{});}catch(e){return Object.assign({},mem);}}
  function isUnlocked(n){const ts=unlocks()[n];return !!ts&&(unlockHours===0||Date.now()-ts<unlockHours*3600e3);}
  function markUnlocked(n){mem[n]=Date.now();const u=unlocks();u[n]=mem[n];try{localStorage.setItem(UKEY,JSON.stringify(u));}catch(e){}}
  const isLocked=n=>provider==='admob'&&S.allowed!==false&&special.has(Number(n))&&!isUnlocked(n);

  /* ---------- AdMob (앱) ---------- */
  const AdMob=isNative&&cap.Plugins?cap.Plugins.AdMob:null;
  const ids=()=>(C.admob&&C.admob[platform])||{};
  const testing=()=>!!(C.admob&&C.admob.testing);
  let pending=null;   // 진행 중인 '광고 보고 열기'
  function finish(ok,why){
    if(!pending)return;
    const p=pending;pending=null;
    if(ok)markUnlocked(p.n);
    p.resolve({ok,why});
    S.rewReady=false;
    if([...special].some(isLocked))prepRewarded().catch(()=>{});   // 다음을 위해 미리 준비
    notify();
  }
  async function admobInit(){
    if(!AdMob){console.warn('[ads] AdMob 플러그인이 없어요 — npm i @capacitor-community/admob 후 npx cap sync');S.allowed=false;notify();return;}
    try{
      await AdMob.initialize({initializeForTesting:testing(),testingDevices:(C.admob&&C.admob.testDevices)||[]});
      // iOS: 앱 추적 투명성(ATT) — 거부해도 비개인화 광고는 나옴
      if(platform==='ios'&&AdMob.trackingAuthorizationStatus){
        const s=await AdMob.trackingAuthorizationStatus();
        if(s&&s.status==='notDetermined')await AdMob.requestTrackingAuthorization();
      }
      // 유럽(EEA)·영국 등 동의가 필요한 지역: Google UMP 동의 양식 (AdMob 콘솔 '개인 정보 보호 및 메시지'에서 양식 게시 필요)
      let can=true;
      try{
        const opt=C.admob&&C.admob.consentDebugEEA?{debugGeography:1,testDeviceIdentifiers:C.admob.testDevices||[]}:{};
        let info=await AdMob.requestConsentInfo(opt);
        if(info&&info.isConsentFormAvailable&&info.status==='REQUIRED')info=await AdMob.showConsentForm();
        can=!info||info.canRequestAds!==false;
        // 동의를 받은 지역이면 '광고 개인정보 설정' 버튼을 홈 화면에 보여 줘야 함(UMP 요구사항)
        const pb=document.getElementById('privacyOptionsBtn');
        if(pb&&info&&info.privacyOptionsRequirementStatus==='REQUIRED')pb.hidden=false;
      }catch(e){console.warn('[ads] consent',e);}
      if(!can){S.allowed=false;notify();return;}   // 광고에 동의하지 않은 사용자: 광고 없음, 특별 단원도 그냥 열림
      AdMob.addListener('bannerAdSizeChanged',sz=>setBar(sz&&sz.height||0));
      AdMob.addListener('onRewardedVideoAdReward',()=>{if(pending)pending.rewarded=true;});
      AdMob.addListener('onRewardedVideoAdDismissed',()=>{if(pending)finish(pending.rewarded,pending.rewarded?'reward':'dismissed');});
      AdMob.addListener('onRewardedVideoAdFailedToShow',()=>finish(true,'free'));
      S.ready=true;S.allowed=true;
      apply();notify();
      if([...special].some(isLocked))prepRewarded().catch(()=>{});
    }catch(e){console.warn('[ads] AdMob init 실패',e);S.allowed=false;notify();}
  }
  function prepRewarded(){
    if(!S.ready||!ids().rewarded)return Promise.reject(new Error('no rewarded ad unit'));
    if(S.rewReady)return Promise.resolve();
    if(!S.rewLoading){
      S.rewLoading=withTimeout(AdMob.prepareRewardVideoAd({adId:ids().rewarded,isTesting:testing()}),12000)
        .then(()=>{S.rewReady=true;},e=>{S.rewReady=false;throw e;})
        .finally(()=>{S.rewLoading=null;});
      S.rewLoading.catch(()=>{});
    }
    return S.rewLoading;
  }
  // 특별 단원 열기: 사용자가 '광고 보고 열기'를 눌렀을 때만 호출됨
  function unlock(n){
    if(!isLocked(n))return Promise.resolve({ok:true,why:'already'});
    if(pending)return pending.promise;   // 두 번 눌러도 한 번만
    let resolve;const promise=new Promise(r=>{resolve=r;});
    pending={n,resolve,promise,rewarded:false,shown:false,cancelled:false};
    (async()=>{
      const t0=Date.now();
      while(!S.ready&&S.allowed!==false&&Date.now()-t0<8000)await sleep(150);   // 앱 켠 직후면 초기화를 잠깐 기다림
      if(!pending)return;
      if(!S.ready){finish(true,'free');return;}
      try{await prepRewarded();}catch(e){finish(true,'free');return;}   // 광고를 못 불러오면 그냥 열어 줌
      if(!pending)return;
      if(pending.cancelled){finish(false,'cancelled');return;}        // 기다리는 사이 창을 닫았으면 광고를 띄우지 않음
      pending.shown=true;
      try{AdMob.showRewardVideoAd().then(()=>{if(pending)pending.rewarded=true;}).catch(()=>finish(true,'free'));}
      catch(e){finish(true,'free');}
    })();
    return promise;
  }
  async function admobApply(){
    if(!S.ready||!ids().banner)return;
    try{
      if(S.view==='play'){
        if(S.bannerOn&&!S.bannerHidden){await AdMob.hideBanner();S.bannerHidden=true;}
        setBar(0);
      }else if(!S.bannerOn){
        S.bannerOn=true;
        await AdMob.showBanner({adId:ids().banner,adSize:'ADAPTIVE_BANNER',position:'BOTTOM_CENTER',margin:0,isTesting:testing()});
      }else if(S.bannerHidden){
        S.bannerHidden=false;await AdMob.resumeBanner();
      }
    }catch(e){console.warn('[ads] banner',e);}
  }

  /* ---------- AdSense (웹) ---------- */
  let gsLoaded=false,insDone=false;
  function adsenseApply(){
    const b=bar();if(!b)return;
    if(S.view==='play'){b.hidden=true;return;}
    if(!gsLoaded){
      gsLoaded=true;
      const s=document.createElement('script');s.async=true;s.crossOrigin='anonymous';
      s.src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client='+encodeURIComponent(C.adsense.client);
      document.head.appendChild(s);
    }
    b.hidden=false;b.classList.add('web');
    if(!insDone){
      insDone=true;
      b.innerHTML=`<ins class="adsbygoogle" style="display:block;width:100%;height:60px" data-ad-client="${C.adsense.client}" data-ad-slot="${C.adsense.slot}" data-ad-format="horizontal" data-full-width-responsive="false"></ins>`;
      try{(window.adsbygoogle=window.adsbygoogle||[]).push({});}catch(e){}
    }
  }

  function apply(){
    if(provider==='admob')admobApply();
    else if(provider==='adsense')adsenseApply();
    else{const b=bar();if(b)b.hidden=true;}
  }

  window.Ads={
    provider,unlockHours,onChange:null,
    view(v){S.view=v;if(provider==='admob')setBar(S.h);apply();},
    isLocked,unlock,
    cancel(){if(pending&&!pending.shown)pending.cancelled=true;},
    lang(){},
    // 유럽 사용자가 동의를 바꿀 수 있게 (privacyOptionsRequirementStatus가 REQUIRED일 때 버튼 노출)
    privacyOptions(){if(provider==='admob'&&AdMob&&AdMob.showPrivacyOptionsForm)return AdMob.showPrivacyOptionsForm();}
  };
  if(provider==='admob'){
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',admobInit);else admobInit();
  }
})();
