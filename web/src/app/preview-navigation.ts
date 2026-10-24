import {useEffect,useRef} from 'react';

// Cross-page fragments can arrive before React has rendered the target (or before
// API-backed content above it has its final height). Restore once after that layout,
// rather than letting a link to a race list silently land back on the hero.
export function useInitialAnchor(ready=true){
 const restored=useRef(false);
 useEffect(()=>{
  if(!ready||restored.current)return;
  if(!location.hash){restored.current=true;return}
  let id:string;try{id=decodeURIComponent(location.hash.slice(1))}catch{return}
  const target=document.getElementById(id);if(!target)return;
  let cancelled=false;let frame=0;
  document.fonts.ready.then(()=>{
   if(cancelled)return;
   frame=requestAnimationFrame(()=>{
    if(cancelled||!target.isConnected)return;
    target.scrollIntoView({block:'start',behavior:'instant'});
    if(document.documentElement.dataset.input==='keyboard')target.focus({preventScroll:true});
    restored.current=true;
   });
  });
  return()=>{cancelled=true;cancelAnimationFrame(frame)};
 },[ready]);
}
