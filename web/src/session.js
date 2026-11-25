import {createHttpApi} from './api.js';
export const isPreview=globalThis.__SASHA_PREVIEW_ENABLED__===true && new URLSearchParams(location.search).get('preview')==='1';
let selected;
if(isPreview){
 const legacy=(await import('./preview-api.js')).createPreviewApi(()=>sessionStorage.getItem('sashatel.onboarding.preview.scenario')||'normal');
 selected={...legacy,register:input=>legacy.register({email:input.email,display_name:input.first_name})};
}else selected=createHttpApi({onSessionLoss:()=>dispatchEvent(new Event('sashatel:session-lost'))});
export const api=selected;
