import { handleControlPlaneRequest } from '../../../../mediation/src/devtools/mediation/control-plane-api-handler.js'

export default async function controlPlaneApiV1CatchAllHandler(req, res) {
  await handleControlPlaneRequest(req, res)
}
