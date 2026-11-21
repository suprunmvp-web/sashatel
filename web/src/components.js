export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const icon=name=>'<span data-icon="'+name+'"></span>';
export const link=(href,text,active=false)=>'<a href="'+esc(href)+'"'+(active?' aria-current="page"':'')+'>'+text+'</a>';
export const button=(text,action,disabled=false,secondary=false)=>'<button class="button '+(secondary?'secondary':'')+'" data-action="'+action+'"'+(disabled?' disabled':'')+'>'+text+'</button>';
export const table=(heads,rows)=>'<div class="table-scroll" tabindex="0" role="region" aria-label="Таблица"><table><thead><tr>'+heads.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
export const empty=(title,text,unavailable=false)=>'<section class="empty-state"'+(unavailable?' role="status"':'')+'><h2>'+esc(title)+'</h2><p>'+esc(text)+'</p></section>';
export const missing=what=>empty('Данные пока недоступны','API для '+what+' ещё не подключён. Повторите позже.',true);
export const tabs=(items,current,base)=>'<nav class="tabs" aria-label="Вкладки">'+items.map(([id,title])=>link(base+id+'/',esc(title),id===current)).join('')+'</nav>';
export const metrics=labels=>'<dl class="metrics">'+labels.map(s=>'<div><dt>'+esc(s)+'</dt><dd>—</dd></div>').join('')+'</dl>';
export const range=()=>'<div class="filters"><label>С<input type="datetime-local" name="from" aria-label="Начало периода"></label><label>По<input type="datetime-local" name="to" aria-label="Конец периода"></label></div>';
export function hydrate(root=document){window.renderSashaIcons?.(root);}
