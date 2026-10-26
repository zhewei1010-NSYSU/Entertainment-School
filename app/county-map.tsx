"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, LoaderCircle, MapPin, Minus, Plus, RotateCcw, Search } from 'lucide-react';
import { useMapGestures } from './use-map-gestures';
import type { MapBox } from './map-math';
import { assetPath } from './asset-path';
import type { SchoolData } from './explore';
type DistrictShape={name:string;path:string;label:number[];area:number;bounds:number[]};
type CountyData={city:string;districts:DistrictShape[];urbanBounds?:number[]};
export default function CountyMap({city,district,schools,onDistrict,onBack,focusSchool,schoolPhoto,onAddPhoto}:{city:string;district:string;schools:SchoolData[];onDistrict:(d:string)=>void;onBack:()=>void;focusSchool?:SchoolData|null;schoolPhoto?:string;onAddPhoto?:()=>void}){
 const [data,setData]=useState<CountyData|null>(null),[error,setError]=useState(false),[mode,setMode]=useState('all'),[hover,setHover]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{const controller=new AbortController();setData(null);setError(false);setMode('all');setHover('');fetch(assetPath('data/district-maps/'+encodeURIComponent(city)+'.json'),{signal:controller.signal}).then(async r=>{if(!r.ok)throw Error();setData(await r.json() as CountyData)}).catch(e=>{if(e.name!=='AbortError')setError(true)});return()=>controller.abort()},[city,attempt]);
 const counts=useMemo(()=>Object.fromEntries((data?.districts||[]).map(d=>[d.name,schools.filter(s=>s.city===city&&s.district===d.name).length])),[schools,city,data]);
 const gestures=useMapGestures([0,0,760,820],city,target=>{const name=target.closest('[data-district]')?.getAttribute('data-district');if(name)onDistrict(name)});
 const {box,zoom}=gestures;const factor=760/box[2];const font=20/factor;
 useEffect(()=>{if(mode==='urban'&&data?.urbanBounds)gestures.fit(data.urbanBounds);else gestures.reset()},[mode,data?.city]);
 // Preserve the user's list-view zoom, and focus only when a school changes.
 const previousView=useRef<MapBox|null>(null);
 useEffect(()=>{
   if(!data||data.city!==city)return;
   if(focusSchool){
     if(!previousView.current)previousView.current=[...box];
     const shape=data.districts.find(d=>d.name===focusSchool.district);
     if(shape)gestures.fit([shape.bounds[0]-25,shape.bounds[1]-25,shape.bounds[2]+25,shape.bounds[3]+25]);
   }else if(previousView.current){
     gestures.restore(previousView.current);previousView.current=null;
   }
 },[data,focusSchool?.id]);
 function changeMode(value:string){setMode(value);if(value===mode){if(value==='urban'&&data?.urbanBounds)gestures.fit(data.urbanBounds);else gestures.reset()}}
 function fitDistrict(){const d=data?.districts.find(d=>d.name===district);if(d)gestures.fit([d.bounds[0]-25,d.bounds[1]-25,d.bounds[2]+25,d.bounds[3]+25])}
 return <section className="district-map-panel" aria-label={city+'行政區互動地圖'}><div className="district-map-header"><button className="map-back" onClick={onBack}><ArrowLeft size={18}/>台灣地圖</button><span><MapPin size={17}/>{city}</span></div><div className="district-map-heading"><h2>{city}<span>行政區探索</span></h2><p>點選行政區，查看區內國小。</p></div>{data?<><div className="district-map-modes"><button className={mode==='all'&&!focusSchool?'active':''} aria-pressed={mode==='all'} onClick={()=>changeMode('all')}>全市行政區 · {data.districts.length}</button>{data.urbanBounds&&<button className={mode==='urban'&&!focusSchool?'active':''} aria-pressed={mode==='urban'} onClick={()=>changeMode('urban')}><Search size={15}/>市區放大</button>}</div>{focusSchool&&<div className="map-school-focus" role="status">{schoolPhoto?<a href={schoolPhoto} target="_blank" rel="noreferrer" aria-label={'開啟'+focusSchool.name+'校園照片'}><img className="map-school-photo" src={schoolPhoto} alt={focusSchool.name+'・我的校園照片'}/></a>:<MapPin size={20}/>}<div><strong>{focusSchool.name}</strong><span>{city}・{focusSchool.district} — 顯示所在行政區，非學校精確位置</span>{!schoolPhoto&&<span>還沒有校園照片，加入自己的走訪照片吧。</span>}<button className="map-add-photo" onClick={onAddPhoto}>{schoolPhoto?'再記一筆照片與心得':'加入校園照片'}</button></div><button onClick={fitDistrict} disabled={!data.districts.some(d=>d.name===district)}>聚焦行政區</button></div>}<div className="district-svg-wrap"><svg className="district-svg" viewBox={box.join(' ')} role="group" aria-label={city+'行政區，點選區域後顯示學校'} {...gestures.handlers}><rect x={box[0]} y={box[1]} width={box[2]} height={box[3]} fill="#f1f5ed"/>{data.districts.map((d,i)=><g key={d.name} data-district={d.name} onClick={e=>{if(e.detail===0)onDistrict(d.name)}} role="button" tabIndex={0} aria-pressed={district===d.name} aria-label={d.name+'，'+counts[d.name]+'所國小'} className={'district-region '+(district===d.name?'selected':'')} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onDistrict(d.name)}}} onMouseEnter={()=>setHover(d.name)} onMouseLeave={()=>setHover('')}><path d={d.path} fillRule="evenodd" style={{strokeWidth:1.5/factor}} className={'district-shape shade-'+i%4+(hover===d.name?' hovered':'')}><title>{d.name} · {counts[d.name]} 所國小</title></path>{(d.area*factor*factor>2200||district===d.name||hover===d.name)&&<g className="district-name" pointerEvents="none"><rect x={d.label[0]-font*1.8} y={d.label[1]-font*.85} width={font*3.6} height={font*1.45} rx={font*.25}/><text x={d.label[0]} y={d.label[1]} textAnchor="middle" dominantBaseline="middle" style={{fontSize:font}}>{d.name}</text></g>}</g>)}</svg><div className="district-map-zoom"><button aria-label="放大行政區地圖" disabled={zoom>=12} onClick={()=>gestures.zoomBy(1.7)}><Plus size={21}/></button><button aria-label="縮小行政區地圖" disabled={zoom<=1} onClick={()=>gestures.zoomBy(1/1.7)}><Minus size={21}/></button><button aria-label="重設地圖" onClick={()=>{if(mode==='urban'&&data?.urbanBounds)gestures.fit(data.urbanBounds);else gestures.reset()}}><RotateCcw size={18}/></button></div><div className="district-hover" aria-live="polite"><MapPin size={17}/>{hover||district||'點選一個行政區'}{(hover||district)&&<strong>{counts[hover||district]||0} 所國小</strong>}</div></div><div className="district-map-foot"><span>單指拖曳・雙指縮放・＋／－ 放大</span>{district&&<button onClick={fitDistrict}>放大{district} <Search size={14}/></button>}</div></>:error?<div className="small-status">行政區地圖載入失敗。<button className="secondary" onClick={()=>setAttempt(x=>x+1)}>重新載入</button></div>:<div className="small-status"><LoaderCircle className="spin"/>正在放大{city}…</div>}</section>
}
