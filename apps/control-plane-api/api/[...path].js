import { handleControlPlaneRequest } from '../../../mediation/src/devtools/mediation/control-plane-api-handler.js'

export default async function controlPlaneApiCatchAllHandler(req, res) {
  await handleControlPlaneRequest(req, res)
}
