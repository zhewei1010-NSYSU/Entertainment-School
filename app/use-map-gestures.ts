"use client";
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { screenFraction, zoomAt, fitBounds, type MapBox } from './map-math';
type Point={x:number;y:number};
type Snapshot={box:MapBox;points:Point[];rect:DOMRect};
export function useMapGestures(base:MapBox,key:string,onTap:(target:Element)=>void){
 const [box,setBox]=useState<MapBox>(base);const current=useRef<MapBox>(base),baseRef=useRef(base),tapRef=useRef(onTap);baseRef.current=base;tapRef.current=onTap;
 const pointers=useRef(new Map<number,Point>()),snapshot=useRef<Snapshot|null>(null),targetRef=useRef<Element|null>(null),moved=useRef(false),multi=useRef(false),frame=useRef<number|null>(null);
 function update(next:MapBox){current.current=next;if(frame.current===null)frame.current=requestAnimationFrame(()=>{frame.current=null;setBox(current.current)})}
 function reset(){pointers.current.clear();snapshot.current=null;multi.current=false;moved.current=false;update([...baseRef.current])}
 useEffect(()=>{reset()},[key]);useEffect(()=>()=>{if(frame.current!==null)cancelAnimationFrame(frame.current)},[]);
 function begin(svg:SVGSVGElement){snapshot.current={box:[...current.current],points:Array.from(pointers.current.values()).slice(0,2),rect:svg.getBoundingClientRect()}}
 function down(e:ReactPointerEvent<SVGSVGElement>){if(e.pointerType==='mouse'&&e.button!==0)return;e.preventDefault();if(!pointers.current.size){moved.current=false;multi.current=false;targetRef.current=e.target as Element}pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.current.size>1){multi.current=true;moved.current=true}e.currentTarget.setPointerCapture(e.pointerId);begin(e.currentTarget)}
 function move(e:ReactPointerEvent<SVGSVGElement>){if(!pointers.current.has(e.pointerId)||!snapshot.current)return;e.preventDefault();pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});const start=snapshot.current;const now=Array.from(pointers.current.values()).slice(0,2);if(!now.length||start.points.length!==now.length)return;
 if(now.length===2){const distance=(p:Point[])=>Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y);const mid=(p:Point[])=>[(p[0].x+p[1].x)/2,(p[0].y+p[1].y)/2] as [number,number];const a=mid(start.points),b=mid(now);const from=screenFraction(start.box,start.rect,...a),to=screenFraction(start.box,start.rect,...b);update(zoomAt(start.box,baseRef.current,distance(now)/Math.max(distance(start.points),1),from,to));moved.current=true;
 }else{const dx=now[0].x-start.points[0].x,dy=now[0].y-start.points[0].y;if(Math.hypot(dx,dy)>4){moved.current=true;const scale=Math.min(start.rect.width/start.box[2],start.rect.height/start.box[3]);update([start.box[0]-dx/scale,start.box[1]-dy/scale,start.box[2],start.box[3]])}}}
 function end(e:ReactPointerEvent<SVGSVGElement>){if(!pointers.current.has(e.pointerId))return;const last=snapshot.current;const origin=last?.points[0];const releaseMoved=origin?Math.hypot(e.clientX-origin.x,e.clientY-origin.y)>4:false;const tap=e.type==='pointerup'&&!moved.current&&!releaseMoved&&!multi.current&&pointers.current.size===1;const target=targetRef.current;pointers.current.delete(e.pointerId);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);if(pointers.current.size){begin(e.currentTarget)}else{snapshot.current=null;targetRef.current=null}if(tap&&target)tapRef.current(target)}
 return {box,restore:(value:MapBox)=>update([...value]),zoom:base[2]/box[2],zoomBy:(ratio:number)=>update(zoomAt(current.current,baseRef.current,ratio,[.5,.5])),fit:(bounds:number[])=>update(fitBounds(bounds,baseRef.current)),reset,handlers:{onPointerDown:down,onPointerMove:move,onPointerUp:end,onPointerCancel:end,onLostPointerCapture:(e:ReactPointerEvent<SVGSVGElement>)=>{if(pointers.current.has(e.pointerId))end(e)}}};
}
