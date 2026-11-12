import {useSyncExternalStore} from 'react';
import {type Theme,type Language} from './i18n';
const subscribe=(callback:()=>void)=>{window.addEventListener('storeluma-preferences',callback);return()=>window.removeEventListener('storeluma-preferences',callback);};
export function usePreferences(){useSyncExternalStore(subscribe,()=>window.storelumaPreferences.snapshot());}
export function Preferences(){
  usePreferences();const p=window.storelumaPreferences;
  return <div className="preferences" role="group" aria-label={p.language==='en'?'Display preferences':'Tùy chọn hiển thị'}>
    <label><span className="sr-only">{p.language==='en'?'Language':'Ngôn ngữ'}</span><select aria-label={p.language==='en'?'Language':'Ngôn ngữ'} value={p.language} onChange={e=>p.setLanguage(e.target.value as Language)}><option value="vi">Tiếng Việt</option><option value="en">English</option></select></label>
    <label><span className="sr-only">{p.language==='en'?'Appearance':'Giao diện'}</span><select aria-label={p.language==='en'?'Appearance':'Giao diện'} value={p.theme} onChange={e=>p.setTheme(e.target.value as Theme)}><option value="system">{p.language==='en'?'System':'Hệ thống'}</option><option value="light">{p.language==='en'?'Light':'Sáng'}</option><option value="dark">{p.language==='en'?'Dark':'Tối'}</option></select></label>
  </div>;
}
