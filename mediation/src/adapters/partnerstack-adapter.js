import { createPartnerStackConnector } from '../connectors/partnerstack/index.js'
import { createBaseSourceAdapter } from './base-source-adapter.js'

export function createPartnerstackAdapter(options = {}) {
  const connector = options.connector || createPartnerStackConnector(options.connectorOptions || {})
  return createBaseSourceAdapter({
    ...options,
    network: 'partnerstack',
    sourceId: options.sourceId || 'source_partnerstack_primary',
    sourceType: options.sourceType || 'alliance',
    adapterId: options.adapterId || 'adapter_partnerstack_v1',
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
    timeoutPolicyMs: options.timeoutPolicyMs || 3500,
    owner: options.owner || 'alliance_partnerstack_team',
    connector
  })
}
