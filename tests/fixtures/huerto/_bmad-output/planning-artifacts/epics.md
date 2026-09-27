---
stepsCompleted: [1, 2, 3]
inputDocuments: [product-brief.md]
---
# Huerto Compartido - Epic Breakdown

## Epic 1: Coordinar el riego

Consultar parcelas y evitar turnos solapados.

### Story 1.1: Consultar parcelas

As a participante,
I want consultar las parcelas,
So that pueda elegir dónde colaborar.

**Acceptance Criteria:**

**Given** dos parcelas, **When** abro el listado, **Then** veo ambas zonas.

### Story 1.2: Reservar turno

As a participante, I want reservar un turno, So that no se solape con otro.

**Acceptance Criteria:**

- Rechazar intervalos coincidentes.
- Mantener el borrador al fallar.

### Story 1.3: Cancelar turno

Permitir cancelar únicamente un turno confirmado.

## Epic 2: Compartir herramientas

Registrar préstamos y devoluciones.

### Story 2.1: Prestar herramienta

Un préstamo conserva herramienta, fecha y persona declarada.

### Story 2.2: Devolver herramienta

Cerrar un préstamo preservando su historial.

### Story 2.3: Revisar inventario

Consultar existencias y material pendiente.
