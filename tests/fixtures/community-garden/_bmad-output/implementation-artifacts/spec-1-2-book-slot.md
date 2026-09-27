---
title: Book slot
type: feature
created: 2026-09-27
status: done
route: dispatch
review_loop_iteration: 1
context: []
---
# Book slot

## Intent

**Problem:** two people can request the same time slot.

**Approach:** check the time slot before confirming.

## Tasks & Acceptance

**Execution:**
- [x] Check time slots
- [x] Show a recoverable error

**Acceptance Criteria:**
- Given a time slot, when another overlaps it, then reject it explicitly.

## Implementation Notes

Fixture execution status intentionally differs from the sprint review status.
