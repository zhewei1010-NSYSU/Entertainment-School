import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, Heart, School } from 'lucide-react';
import type { SchoolData } from './explore';

export default function SchoolCard({school, photo, status, onSelect}: {
  school: SchoolData; photo?: string; status?: string; onSelect: () => void;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photo]);
  return <button className="school-row school-card" onClick={onSelect} aria-label={'查看'+school.name+'，'+school.city+school.district}>
    <span className="school-card-media">
      {photo && !failed ? <img src={photo} alt={school.name+'・我的走訪照片'} loading="lazy" onError={()=>setFailed(true)}/> :
        <span className="school-card-placeholder"><School size={44} strokeWidth={1.2} aria-hidden="true"/><span>尚無走訪照片</span><small>校舍示意，非學校實景</small></span>}
      <span className="school-card-id">{school.id}</span>
    </span>
    <span className="school-row-copy">
      <small>{school.city} · {school.district}</small>
      <strong>{school.name}</strong>
      <em>{school.address}</em>
    </span>
    <span className="school-card-footer">
      <span className={'school-card-status '+(status||'unvisited')}>
        {status==='visited'?<><Check size={13}/>已走訪</>:status==='wish'?<><Heart size={13}/>想去</>:'尚未紀錄'}
      </span>
      <span>查看學校 <ArrowUpRight size={15}/></span>
    </span>
  </button>;
}
