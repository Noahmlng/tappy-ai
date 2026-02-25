import { handleRuntimeRequest } from '../../../projects/ad-aggregation-platform/src/devtools/simulator/simulator-gateway.js'

export default async function runtimeApiCatchAllHandler(req, res) {
  await handleRuntimeRequest(req, res)
}
