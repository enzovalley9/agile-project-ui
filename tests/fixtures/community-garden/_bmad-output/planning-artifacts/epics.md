---
stepsCompleted: [1, 2, 3]
inputDocuments: [product-brief.md]
---
# Community Garden - Epic Breakdown

## Epic 1: Coordinate watering

View plots and prevent overlapping time slots.

### Story 1.1: View plots

As a participant,
I want to view the plots,
So that I can choose where to help.

**Acceptance Criteria:**

**Given** two plots, **When** I open the list, **Then** I see both areas.

### Story 1.2: Book slot

As a participant, I want to book a time slot, So that it does not overlap another.

**Acceptance Criteria:**

- Reject overlapping time slots.
- Keep the draft when the operation fails.

### Story 1.3: Cancel slot

Only allow confirmed time slots to be canceled.

## Epic 2: Share tools

Record loans and returns.

### Story 2.1: Borrow tool

A loan preserves the tool, date, and declared borrower.

### Story 2.2: Return tool

Close a loan while preserving its history.

### Story 2.3: Check inventory

Check stock and outstanding equipment.
