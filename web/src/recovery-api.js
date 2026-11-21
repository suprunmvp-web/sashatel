import {createHttpApi} from './api.js';
const api=createHttpApi();
export async function requestResetCode(email) {
  return api.requestResetCode(email);
}
export async function verifyResetCode(email,code) {
  const result=await api.verifyResetCode(email,code);
  if(typeof result?.reset_token!=='string')throw new Error('Некорректный ответ сервера. Повторите попытку.');
  return result.reset_token;
}
export async function completePasswordReset(email,resetToken,newPassword) {
  return api.completePasswordReset(email,resetToken,newPassword);
}
