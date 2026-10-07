import type { PrometheusExtensionDefinition } from '../../../runtime-api.js';
import { registerSocialApiRequest } from '../_runtime/social-api-request.js';
const extension: PrometheusExtensionDefinition = {
  id: 'tiktok',
  register(api) { registerSocialApiRequest(api, 'tiktok', 'TikTok', 'https://open.tiktokapis.com', '/v2/user/info/?fields=open_id,display_name'); },
};
export default extension;
