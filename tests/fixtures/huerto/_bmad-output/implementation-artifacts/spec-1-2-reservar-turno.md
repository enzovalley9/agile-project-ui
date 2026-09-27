---
title: Reservar turno
type: feature
created: 2026-09-27
status: done
route: dispatch
review_loop_iteration: 1
context: []
---
# Reservar turno

## Intent

**Problem:** dos personas pueden pedir el mismo intervalo.

**Approach:** verificar el intervalo antes de confirmar.

## Tasks & Acceptance

**Execution:**
- [x] Comprobar intervalos
- [x] Mostrar error recuperable

**Acceptance Criteria:**
- Given un turno, when otro lo solapa, then rechazo explícito.

## Implementation Notes

Estado de ejecución de fixture distinto del sprint review.
