# Rollback Drill Record Template

- Drill date:
- Target environment:
- Release tag / commit:
- Incident / change id:
- Commander:
- Executor:

## 1. Trigger

- Trigger symptom:
- First alert timestamp:
- Reason codes observed:

## 2. Actions Timeline

1. HH:MM - freeze publish traffic
2. HH:MM - rollback config snapshot
3. HH:MM - drain/retry queue workers
4. HH:MM - rollback runtime artifact
5. HH:MM - verify health metrics

## 3. Verification

- `request_availability`:
- `event_ack_success`:
- `closed_loop_completion`:
- DLQ trend:
- replay determinism check:

## 4. Result

- Rollback success/fail:
- Total recovery time:
- Follow-up actions:
- Owner and deadline:
