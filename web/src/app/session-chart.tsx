import { useId, useState } from 'react';
import { useSize } from '../lib/useSize';
import { along, type TrackStraight } from '../lib/track';
import type { Lap } from '../lib/types';
import type { Cutoffs, Median } from '../explorer/data';

type ChartDriver={number:number;code:string;colour:string;hollow:boolean;cutoffs:Cutoffs|null;median:Median|undefined};
type Props={straight:TrackStraight;lapLen:number;laps:Lap[];selectedLap:number|null;onLap:(n:number)=>void;drivers:ChartDriver[];loading:boolean;compareLoading?:boolean;dim?:boolean;dimCompare?:boolean};
const fmt=(n:number|null|undefined)=>n==null?'—':Math.round(n).toLocaleString('en-GB');
export function SessionChart({straight,lapLen,laps,selectedLap,onLap,drivers,loading,compareLoading=false,dim=false,dimCompare=false}:Props){
  const [ref,{w:W}]=useSize<HTMLDivElement>();const id=useId().replace(/:/g,'');
  const [preview,setPreview]=useState<{sid:number;lap:number;keyboard:boolean}|null>(null);
  const hover=preview?.sid===straight.straight_id?preview.lap:null;
  const shownLap=hover??selectedLap;
  const narrow=W<540;const H=narrow?290:340;const M={l:narrow?37:45,r:12,t:18,b:34};
  const rel=(m:number)=>along(straight,m,lapLen);
  const series=drivers.map(d=>({d,points:[...(d.cutoffs??[])].flatMap(([lap,values])=>{const m=values.get(straight.straight_id);return m===undefined?[]:[{lap,m:rel(m)}]}).sort((a,b)=>a.lap-b.lap),median:d.median?{m:rel(d.median.m),lo:d.median.lo===null?null:rel(d.median.lo),hi:d.median.hi===null?null:rel(d.median.hi)}:null}));
  const first=laps[0]?.lap_number??1;const last=Math.max(first+1,laps[laps.length-1]?.lap_number??first+1);
  const values=series.flatMap(s=>s.points.map(p=>p.m)).sort((a,b)=>a-b);
  const medianValues=series.flatMap(s=>s.median?[s.median.m,s.median.lo??s.median.m,s.median.hi??s.median.m]:[]);
  const q=(p:number)=>values[Math.round(p*(values.length-1))];
  // Preserve the existing robust chart range; outliers are edge triangles with exact readouts.
  const low=values.length?Math.min(q(.02),...medianValues):0;
  const high=values.length?Math.max(q(.98),...medianValues):straight.len;
  const pad=Math.max(10,(high-low)*.12);const rough=(high-low+2*pad)/4;
  const power=10**Math.floor(Math.log10(Math.max(1,rough)));const factor=rough/power;
  const step=(factor<=1?1:factor<=2?2:factor<=5?5:10)*power;
  const bottom=Math.max(0,Math.floor((low-pad)/step)*step);const top=Math.max(bottom+step,Math.ceil((high+pad)/step)*step);
  const x=(lap:number)=>M.l+(lap-first)/(last-first)*Math.max(1,W-M.l-M.r);
  const y=(m:number)=>H-M.b-(Math.max(bottom,Math.min(top,m))-bottom)/(top-bottom)*(H-M.b-M.t);
  const yTicks=Array.from({length:Math.round((top-bottom)/step)+1},(_,i)=>bottom+i*step);
  const xStep=narrow?10:5;const xTicks=Array.from({length:last-first+1},(_,i)=>first+i).filter(n=>n===first||n===last||n%xStep===0).filter(n=>n===first||n===last||((x(n)-x(first)>=24)&&(x(last)-x(n)>=24)));
  const available=[...new Set(series.flatMap(s=>s.points.map(p=>p.lap)))].sort((a,b)=>a-b);
  const pointAt=(s:typeof series[number],lap:number|null)=>lap===null?null:s.points.find(p=>p.lap===lap)?.m??null;
  const pointerLap=(clientX:number,svg:SVGSVGElement)=>{const r=svg.getBoundingClientRect();return Math.max(first,Math.min(last,Math.round(first+((clientX-r.left)*W/r.width-M.l)/Math.max(1,W-M.l-M.r)*(last-first))))};
  const seriesLoading=(i:number)=>i===0?loading:compareLoading;const anyLoading=loading||compareLoading;const showData=!loading&&values.length>0;
  const description=series.map(s=>`${s.d.code}: ${s.median?`median ${fmt(s.median.m)} metres, interval ${fmt(s.median.lo)} to ${fmt(s.median.hi)}`:'no published median'}, ${s.points.length} lap estimates`).join('. ');
  return <div ref={ref} className={`session-chart ${dim?'is-loading':''}`} aria-busy={dim||undefined}>
    <div className="chart-summary">{series.map(s=><div className="chart-summary-driver" key={s.d.number} style={{'--team':s.d.colour} as any}><span className={`chart-key ${s.d.hollow?'is-hollow':''}`}/><span className="chart-summary-code">{s.d.code}</span><span className="chart-summary-value">{fmt(s.median?.m)} <small>m est.</small></span><span className="chart-summary-caption">Session median</span></div>)}</div>
    <div className="chart-readout" aria-live={preview?.keyboard?'polite':'off'}><span className="chart-readout-lap">{shownLap===null?'Explore a lap':`Lap ${shownLap}`}</span><div>{series.map((s,i)=><span key={s.d.number} className={i>0&&dimCompare?'is-loading':undefined} aria-busy={i>0&&dimCompare||undefined} style={{'--team':s.d.colour} as any}><i className={`chart-key ${s.d.hollow?'is-hollow':''}`}/><b>{s.d.code}</b><strong>{shownLap===null?(seriesLoading(i)?'—':s.points.length):fmt(pointAt(s,shownLap))}</strong><small>{shownLap===null?'laps':'m est.'}</small></span>)}</div></div>
    <p id={`${id}-keys`} className="sr-only">Use left and right arrow keys to preview laps, Enter to select, and Escape to return to the selected lap. Points are estimates; edge triangles indicate values outside the displayed range.</p>
    <svg width="100%" height={H} viewBox={`0 0 ${W||320} ${H}`} className="session-chart-svg" tabIndex={0} role="group" aria-label={`Lap estimate chart on ${straight.label}. ${anyLoading?'Loading estimates.':description}`} aria-describedby={`${id}-keys`}
      onPointerMove={e=>{if(e.pointerType!=='touch'){const n=pointerLap(e.clientX,e.currentTarget);if(hover!==n||preview?.keyboard)setPreview({sid:straight.straight_id,lap:n,keyboard:false})}}} onPointerLeave={()=>setPreview(null)}
      onClick={e=>{const n=pointerLap(e.clientX,e.currentTarget);if(available.includes(n))onLap(n)}}
      onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();setPreview(null);return}if(e.key==='Enter'&&shownLap!==null&&available.includes(shownLap)){e.preventDefault();onLap(shownLap);return}if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)&&available.length){e.preventDefault();const current=shownLap===null?-1:available.indexOf(shownLap);const n=e.key==='Home'?available[0]:e.key==='End'?available[available.length-1]:available[Math.max(0,Math.min(available.length-1,current+(e.key==='ArrowRight'?1:-1)))];setPreview({sid:straight.straight_id,lap:n,keyboard:true})}}} onBlur={()=>setPreview(null)}>
      <defs>{series.map(s=><pattern key={s.d.number} id={`${id}-band-${s.d.number}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke={s.d.colour} strokeWidth="1" strokeOpacity=".22"/></pattern>)}</defs>
      {yTicks.map(t=><g key={t}><line x1={M.l} x2={W-M.r} y1={y(t)} y2={y(t)} className="chart-grid"/><text x={M.l-9} y={y(t)+3} textAnchor="end" className="chart-axis-text">{fmt(t)}</text></g>)}
      <text x={M.l-9} y="10" textAnchor="end" className="chart-axis-unit">m</text>
      {xTicks.map(t=><g key={t}><line x1={x(t)} x2={x(t)} y1={H-M.b} y2={H-M.b+4} className="chart-tick"/><text x={x(t)} y={H-M.b+19} textAnchor="middle" className="chart-axis-text">{t}</text></g>)}<text x={W-M.r} y={H-1} textAnchor="end" className="chart-axis-unit">Lap</text>
      {series.map((s,i)=>showData&&!seriesLoading(i)?<g key={s.d.number}>{s.median&&<>{s.median.lo!==null&&s.median.hi!==null&&<rect x={M.l} y={y(s.median.hi)} width={Math.max(0,W-M.l-M.r)} height={Math.max(1,y(s.median.lo)-y(s.median.hi))} fill={`url(#${id}-band-${s.d.number})`}/>}<line x1={M.l} x2={W-M.r} y1={y(s.median.m)} y2={y(s.median.m)} stroke={s.d.colour} strokeWidth="1" strokeOpacity=".55" strokeDasharray={s.d.hollow?'4 4':undefined}/></>}
        {s.points.map(p=>{const cx=x(p.lap),cy=y(p.m),active=p.lap===shownLap,out=p.m<bottom||p.m>top;return <g key={p.lap} className="chart-point"><title>{`${s.d.code}, lap ${p.lap}: ${fmt(p.m)} m estimated cut-off`}</title>{active&&<circle cx={cx} cy={cy} r="8" fill="none" stroke="#f4f4ef" strokeWidth="1"/>}{out?<path d={p.m>top?`M${cx-4},${cy+5}L${cx+4},${cy+5}L${cx},${cy-2}Z`:`M${cx-4},${cy-5}L${cx+4},${cy-5}L${cx},${cy+2}Z`} fill={s.d.hollow?'#111110':s.d.colour} stroke={s.d.colour}/>:<circle cx={cx} cy={cy} r={active?4.5:3.2} fill={s.d.hollow?'#111110':s.d.colour} stroke={s.d.colour} strokeWidth={s.d.hollow?1.5:0}/>}</g>})}
      </g>:null)}
      {shownLap!==null&&<line x1={x(shownLap)} x2={x(shownLap)} y1={M.t} y2={H-M.b} className="chart-cursor" pointerEvents="none"/>}
      {!showData&&<text x={(W+M.l-M.r)/2} y={H/2} textAnchor="middle" className="chart-empty">{loading?'Loading lap estimates…':'No lap estimates for this selection.'}</text>}
    </svg>
    <div className="chart-explanation"><span><i className="chart-band-key"/>95% median interval</span><span>{narrow?'Tap the chart or choose a lap':'Hover to inspect · click to select'}</span></div>
  </div>;
}
