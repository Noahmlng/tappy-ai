import { handleRuntimeRequest } from '../../../../mediation/src/devtools/mediation/runtime-api-handler.js'

export default async function runtimeApiV2CatchAllHandler(req, res) {
  await handleRuntimeRequest(req, res)
}
