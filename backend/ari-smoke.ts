import { PrivateAriClient } from './ari-client.ts';

const {ARI_BASE_URL,ARI_USERNAME,ARI_PASSWORD_FILE}=process.env;
if(!ARI_BASE_URL||!ARI_USERNAME||!ARI_PASSWORD_FILE) {
  throw Error('ARI_BASE_URL, ARI_USERNAME and ARI_PASSWORD_FILE are required');
}
// Read-only smoke check. Never originate or change Asterisk configuration.
const client=await PrivateAriClient.fromFiles({
  baseUrl:ARI_BASE_URL,username:ARI_USERNAME,passwordFile:ARI_PASSWORD_FILE,
});
const info=await client.readiness();
if(!info||typeof info!=='object') throw Error('ARI_INFO_INVALID');
console.log('ARI_READINESS_OK'); // no secrets, endpoint IDs, or server metadata printed
