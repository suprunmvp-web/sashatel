export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cabinetIcons={
 'chevron-right':'<path d="m9 6 6 6-6 6"/>',
 x:'<path d="m6 6 12 12M18 6 6 18"/>',
 'shield-off':'<path d="m3 3 18 18M9 4l3-1 7 3v6c0 2-.5 3.7-1.4 5M14 20l-2 1c-4-2-7-5-7-9V7"/>',
 'list-trunks':'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
 ellipsis:'<path d="M12 5h.01M12 12h.01M12 19h.01"/>'
};
export const icon=name=>cabinetIcons[name]
 ? '<svg class="cabinet-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+cabinetIcons[name]+'</svg>'
 : '<span data-icon="'+name+'"></span>';
export const link=(href,text,active=false)=>'<a href="'+esc(href)+'"'+(active?' aria-current="page"':'')+'>'+text+'</a>';
export const button=(text,action,disabled=false,secondary=false)=>'<button class="button '+(secondary?'secondary':'')+'" data-action="'+action+'"'+(disabled?' disabled':'')+'>'+text+'</button>';
export const table=(heads,rows,emptyText='')=>'<div class="table-scroll" tabindex="0" role="region" aria-label="Таблица"><table><thead><tr>'+heads.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+(!rows.length&&emptyText?'<tr><td class="table-empty" colspan="'+heads.length+'" role="status">'+esc(emptyText)+'</td></tr>':'')+'</tbody></table></div>';
export const empty=(title,text,unavailable=false)=>'<section class="empty-state"'+(unavailable?' role="status"':'')+'><h2>'+esc(title)+'</h2><p>'+esc(text)+'</p></section>';
export const missing=()=>empty('Нет данных','',true);
export const tabs=(items,current,base)=>'<nav class="tabs" aria-label="Вкладки">'+items.map(([id,title])=>link(base+id+'/',esc(title),id===current)).join('')+'</nav>';
export const metrics=labels=>'<dl class="metrics">'+labels.map(s=>'<div><dt>'+esc(s)+'</dt><dd>—</dd></div>').join('')+'</dl>';
export const range=()=>'<div class="filters"><label>С<input type="datetime-local" name="from" aria-label="Начало периода"></label><label>По<input type="datetime-local" name="to" aria-label="Конец периода"></label></div>';
export function hydrate(root=document){window.renderSashaIcons?.(root);}
