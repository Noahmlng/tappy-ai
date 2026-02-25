import { handleControlPlaneRequest } from '../../../projects/tappy-ai-mediation/src/devtools/mediation/mediation-gateway.js'

export default async function controlPlaneApiCatchAllHandler(req, res) {
  await handleControlPlaneRequest(req, res)
}
