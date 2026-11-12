import messages from './messages.en.json' with {type:'json'};
import errors from './messages.errors.en.json' with {type:'json'};

export type Language = 'vi' | 'en';
export type Theme = 'light' | 'dark' | 'system';
declare global {
  interface Window {
    storelumaPreferences: {
      readonly language: Language;
      readonly theme: Theme;
      setLanguage(language: Language): void;
      setTheme(theme: Theme): void;
      snapshot(): string;
    };
  }
}
const catalog:Record<string,string>={...messages,...errors};
const reverse=new Map(Object.entries(catalog).map(([vi,en])=>[en,vi]));
const interpolate=(text:string,args:unknown[])=>text.replace(/\{(\d+)\}/g,(_,index)=>String(args[Number(index)]??''));
const escapeRegex=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const patterns=Object.entries(catalog).filter(([vi])=>/\{\d+\}/.test(vi)).flatMap(([vi,en])=>[vi,en].map(pattern=>{
  const indexes:number[]=[];
  let pos=0,expression='^';
  for(const match of pattern.matchAll(/\{(\d+)\}/g)){
    expression+=escapeRegex(pattern.slice(pos,match.index))+'([\\s\\S]*?)';
    indexes.push(Number(match[1]));
    pos=match.index!+match[0].length;
  }
  expression+=escapeRegex(pattern.slice(pos))+'$';
  return {regex:new RegExp(expression),indexes,vi,en};
}));
export function locale(){return window.storelumaPreferences?.language==='en'?'en-GB':'vi-VN';}
/** Translate authored UI copy only. Never call this on customer or catalog data. */
export function t(text:string,args:unknown[]=[]):string{
  const source=catalog[text]?text:reverse.get(text)??text;
  const english=window.storelumaPreferences?.language==='en';
  if(catalog[source])return interpolate(english?catalog[source]:source,args);
  for(const pattern of patterns){
    const match=pattern.regex.exec(text);
    if(match){
      const values:unknown[]=[];
      pattern.indexes.forEach((index,i)=>values[index]=match[i+1]);
      return interpolate(english?pattern.en:pattern.vi,values);
    }
  }
  return text;
}
/** Module-level status maps resolve their labels when rendered, not at import time. */
export function localizedLabels<T extends Record<string,string>>(labels:T):T{
  return new Proxy(labels,{
    get(target,key,receiver){
      const value=Reflect.get(target,key,receiver);
      return typeof value==='string'?t(value):value;
    },
  });
}
