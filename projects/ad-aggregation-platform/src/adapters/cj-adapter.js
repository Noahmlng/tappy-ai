import { createCjConnector } from '../connectors/cj/index.js'
import { createBaseSourceAdapter } from './base-source-adapter.js'

export function createCjAdapter(options = {}) {
  const connector = options.connector || createCjConnector(options.connectorOptions || {})
  return createBaseSourceAdapter({
    ...options,
    network: 'cj',
    sourceId: options.sourceId || 'source_cj_primary',
    sourceType: options.sourceType || 'alliance',
    adapterId: options.adapterId || 'adapter_cj_v1',
    adapterContractVersion: options.adapterContractVersion || 'd_adapter_contract_v1',
    capabilityProfileVersion: options.capabilityProfileVersion || 'd_capability_profile_v1',
    supportedCapabilities: options.supportedCapabilities || [
      'request_adapt',
      'candidate_normalize',
      'error_normalize',
      'source_trace'
    ],
    supportedPlacementTypes: options.supportedPlacementTypes || [
      'chat_inline',
      'tool_result',
      'workflow_checkpoint'
    ],
    timeoutPolicyMs: options.timeoutPolicyMs || 3000,
    owner: options.owner || 'alliance_cj_team',
    connector
  })
}
