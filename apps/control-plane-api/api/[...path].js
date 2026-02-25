import { handleControlPlaneRequest } from '../../../projects/ad-aggregation-platform/src/devtools/simulator/simulator-gateway.js'

export default async function controlPlaneApiCatchAllHandler(req, res) {
  await handleControlPlaneRequest(req, res)
}
