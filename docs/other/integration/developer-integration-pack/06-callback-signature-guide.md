# 06 - Callback and Signature Validation Guide

- Owner:
- Last Updated:

## 1. Callback Types

| Callback | Trigger | Required Fields | Retry Behavior |
| --- | --- | --- | --- |
| impression |  |  |  |
| click |  |  |  |
| conversion |  |  |  |

## 2. Signature Verification

- Signature header:
- Hash algorithm:
- Canonical string rule:
- Clock skew tolerance:

## 3. Idempotency Policy

- Idempotency key source:
- Dedup TTL:
- Duplicate handling behavior:

## 4. Validation Examples

```text
# Insert signed callback example here.
```

## 5. Failure Handling

| Failure | HTTP Response | Retryable | Alert |
| --- | --- | --- | --- |
| invalid signature |  |  |  |
| timestamp expired |  |  |  |
| malformed payload |  |  |  |
