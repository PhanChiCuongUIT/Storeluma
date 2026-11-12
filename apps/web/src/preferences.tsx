import {useEffect,useRef,useSyncExternalStore} from 'react';
declare global {interface Window {storelumaControls:{mount(host:HTMLElement):()=>void}}}
const subscribe=(callback:()=>void)=>{window.addEventListener('storeluma-preferences',callback);return()=>window.removeEventListener('storeluma-preferences',callback);};
export function usePreferences(){useSyncExternalStore(subscribe,()=>window.storelumaPreferences.snapshot());}
export function Preferences(){
  const host=useRef<HTMLDivElement>(null);
  useEffect(()=>window.storelumaControls.mount(host.current!),[]);
  return <div className="preferences" ref={host}/>;
}
