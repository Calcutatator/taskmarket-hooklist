# Taskmarket UI Polish
## Product Requirements Document (PRD) + Technical Design Document (TDD)

Document owner: Product + Frontend
Last updated: March 9, 2026
Status: Proposed

## Implementation Status

- [x] Shared scaffolding components and tests
- [x] Primitive normalization
- [x] Core task surfaces
- [x] Agent, leaderboard, and profile surfaces
- [x] Landing and protocol surfaces
- [x] Verification and PRD/TDD checklist updates

## 1. Executive Summary

Taskmarket has a strong visual identity already: mono-led typography, a sand/orange palette, squared surfaces, and bracket motifs. The current issue is not missing identity. It is inconsistent execution.

The UI feels less polished than the brand system implies because spacing, component density, surface treatment, and hierarchy drift between routes. The design system exists, but it is not yet governing the product tightly enough.

This effort will deliver a systematic UI polish pass across the frontend by:
- tightening the shared design tokens and primitive components
- standardizing shell and page-level spacing
- unifying filters, cards, tables, and empty/loading states
- preserving the existing brand language rather than rebranding the product

This document defines:
- product goals, scope, non-goals, and success criteria
- the technical design for implementing the polish pass in the existing frontend and design system
- a test-first verification plan for shipping the work safely

## 2. Product Context

### 2.1 Problem Statement

Current Taskmarket screens are individually functional, but the product lacks visual consistency in the places users feel most often:
- page headers and intro blocks use different spacing and hierarchy rules
- filters and controls use different container patterns on different routes
- card surfaces and table rows vary in density and padding
- some screens use shared primitives while others recreate styling manually
- loading, empty, and error states do not follow one system

The result is a UI that feels assembled screen-by-screen instead of intentionally composed as one product.

### 2.2 Opportunity

Because the frontend is already routed through a small set of layout wrappers and UI primitives, this is a high-leverage cleanup:
- a relatively small number of shared changes can improve most routes
- the existing design system can become the real source of truth
- polish can improve trust, readability, and task completion without feature work

## 3. Goals and Non-Goals

### 3.1 Goals

1. Improve visual hierarchy across all primary screens.
2. Normalize padding, density, and spacing rhythm across shared UI patterns.
3. Make the design system authoritative for common surfaces and controls.
4. Preserve the current Taskmarket brand language:
   - mono-forward typography
   - squared surfaces
   - sand/orange palette
   - bracket accents
5. Reduce one-off styling and move screens toward reusable primitives.
6. Ensure the core routes feel coherent on desktop and mobile.

### 3.2 Non-Goals

1. Rebranding Taskmarket.
2. Rewriting information architecture or route structure.
3. Adding new product features or workflow steps.
4. Changing backend, wallet, or contract logic.
5. Replacing the existing design system toolchain.
6. Turning the UI into a soft, generic SaaS aesthetic that loses current character.

## 4. Personas and Jobs-To-Be-Done

### 4.1 Requester

Needs to:
- scan task information quickly
- create tasks without visual friction
- compare submissions and task state cleanly

### 4.2 Worker

Needs to:
- browse tasks efficiently
- understand status, reward, and next actions immediately
- trust that the product is reliable and well-maintained

### 4.3 Ecosystem Visitor

Needs to:
- understand what Taskmarket is
- connect the landing and protocol pages to the product experience

## 5. Success Metrics

### 5.1 Product Quality KPIs

1. All primary routes share one consistent page-header pattern.
2. All primary routes use shared state patterns for loading, empty, and error states.
3. All task, agent, and leaderboard filters follow one density and spacing system.
4. All major surfaces use shared primitives rather than ad hoc styling.
5. Desktop and mobile visual QA passes for:
   - `/`
   - `/tasks`
   - `/tasks/new`
   - `/tasks/:taskId`
   - `/agents`
   - `/agents/:agentId`
   - `/leaderboard`
   - `/protocol`

### 5.2 Engineering KPIs

1. Eliminate known one-off control styling in shared shell components.
2. Reduce hardcoded color utility usage in product surfaces where tokens should apply.
3. Keep the refactor frontend-only except for test support or documentation.

## 6. Scope by Phase

### 6.1 Phase 1: Foundations

- tighten shared tokens where needed for component polish
- normalize primitive components
- introduce shared page-header and state patterns
- align app shell spacing

### 6.2 Phase 2: Core Product Screens

- tasks browse
- task creation
- task detail
- agents directory
- leaderboard
- agent profile

### 6.3 Phase 3: Marketing and Docs Surfaces

- landing page
- protocol page

### 6.4 Phase 4: Hardening

- mobile density pass
- dark mode parity pass
- leftover consistency cleanup

## 7. Functional Requirements

### 7.1 Design System Foundations

FR-001: Shared primitives must expose a consistent spacing and density model for buttons, inputs, selects, textareas, cards, badges, and section surfaces.  
FR-002: Shared primitives must preserve Taskmarket brand cues rather than introducing a new visual language.  
FR-003: Shared color and shadow decisions must come from source design tokens where the system should own them.  
FR-004: Surfaces that represent the same UI role must look materially consistent across routes.

### 7.2 Layout and Hierarchy

FR-010: Primary app routes must use a shared page header pattern for title, subtitle, and optional actions.  
FR-011: Primary app routes must share a consistent content width and vertical rhythm.  
FR-012: Landing and protocol pages may keep hero bands, but their inner spacing must align with the rest of the system.  
FR-013: Header and sidebar controls must match the primitive system used elsewhere.

### 7.3 Controls and Data Surfaces

FR-020: Filter bars must use one consistent spacing, control sizing, and container pattern.  
FR-021: Task cards, stat cards, and data tables must follow one density system.  
FR-022: Tags, chips, and status elements must use shared badge-style primitives where appropriate.  
FR-023: Tables and cards must present information with clearer alignment and hierarchy than the current baseline.

### 7.4 State Consistency

FR-030: Loading states must use one shared visual system.  
FR-031: Empty states must use one shared visual system.  
FR-032: Error states must use one shared visual system.  
FR-033: These states must be reusable across list, detail, and profile surfaces.

### 7.5 Responsive Quality

FR-040: Core routes must remain readable and usable on mobile widths.  
FR-041: Mobile filter and table experiences must avoid cramped spacing and awkward control sizing.  
FR-042: Header and navigation chrome must remain visually balanced at small widths.

## 8. Non-Functional Requirements

NFR-001: Frontend behavior must remain functionally unchanged except for presentational improvements.  
NFR-002: Existing route structure and data-fetching patterns must remain intact.  
NFR-003: New shared components must fit the existing frontend architecture in `docs/FRONTEND_GUIDE.md`.  
NFR-004: Token changes must be made only in design-system source files, followed by regeneration via `make design-system`.  
NFR-005: The polish pass must preserve accessibility baselines for contrast, focus visibility, and semantic structure.  
NFR-006: The work should minimize style duplication rather than adding more screen-specific exceptions.

## 9. User Journeys

### 9.1 Browse Tasks

1. User lands on `/tasks`.
2. User immediately understands the page title, purpose, and available filtering controls.
3. Filters read as one coherent control group.
4. Task cards scan cleanly for mode, status, reward, requester, and urgency.

### 9.2 Create Task

1. User lands on `/tasks/new`.
2. Page framing and form surface feel intentional and uncluttered.
3. Field grouping, spacing, and section transitions are easy to follow.
4. The UI feels trustworthy before the user commits to a paid action.

### 9.3 Inspect Agent or Leaderboard Data

1. User lands on `/agents`, `/agents/:agentId`, or `/leaderboard`.
2. Controls and tables feel related to the rest of the product, not like a separate subsystem.
3. Stats, badges, rankings, and supporting metadata are easy to compare.

### 9.4 Understand the Product

1. User lands on `/` or `/protocol`.
2. Brand voice remains intact.
3. Section pacing and surface treatment feel cleaner and more deliberate than the current version.

## 10. Technical Design (TDD)

## 10.1 Architecture Overview

This is a frontend and design-system hardening effort, not a new feature build.

Primary areas of change:
- `packages/design-system` for token-level improvements
- `apps/frontend/src/components/ui` for primitive normalization
- `apps/frontend/src/components/layout` for shell and page scaffolding
- `apps/frontend/src/components/views` and feature components for adoption

Existing architecture remains the same:
- route layer stays thin
- views stay presentational
- data fetching stays in current containers and TRPC usage

## 10.2 Target Surfaces

Primary routes in scope:
- `/`
- `/tasks`
- `/tasks/new`
- `/tasks/$taskId`
- `/agents`
- `/agents/$agentId`
- `/leaderboard`
- `/protocol`

Shared components in scope:
- `Header`
- `Sidebar`
- `PageLayout`
- `TaskFilterBar`
- `TaskCard`
- `TaskDetail`
- `AgentTable`
- `LeaderboardTable`
- `CreateTaskForm`
- core `ui/*` primitives

## 10.3 Proposed Component and Layout Additions

Add small shared abstractions instead of spreading more utility-only styling:

1. `PageHeader`
   - standard title, subtitle, and optional action slot
   - used by tasks, create-task, agents, leaderboard, agent profile

2. `StatePanel`
   - standard loading, empty, and error surface
   - used by list and detail screens

3. `FilterPanel`
   - shared container for filter forms
   - used by tasks, agents, and leaderboard

4. `MetricCard`
   - consistent stat surface for agent profile and any future stats blocks

These should stay small and composable rather than becoming a large abstraction layer.

## 10.4 Token Strategy

Token work should be minimal and purposeful.

Likely changes:
- refine component tokens for outline/ghost/button/badge states where density or contrast needs adjustment
- add or adjust surface/shadow tokens if the shared system needs a clearer separation between background and card surfaces
- review spacing scale coverage only if current token values are insufficient for repeated layouts

Files:
- `packages/design-system/tokens/colors/components.json`
- `packages/design-system/tokens/colors/components.dark.json`
- `packages/design-system/tokens/colors/semantics.json`
- `packages/design-system/tokens/colors/semantics.dark.json`
- `packages/design-system/tokens/dimensions/base.json`
- `packages/design-system/tokens/objectValues/base.json`

Regeneration:
- run `make design-system` after token changes

## 10.5 Primitive Normalization

Normalize these primitives first:
- `button.tsx`
- `card.tsx`
- `input.tsx`
- `select.tsx`
- `native-select.tsx`
- `textarea.tsx`
- `badge.tsx`
- `bracket-card.tsx`

Key goals:
- consistent internal padding
- consistent focus treatment
- consistent text sizing
- consistent surface/background behavior
- shared decorative treatment where bracket accents are used

## 10.6 Shell and Page Layout Changes

Refine:
- `AppLayout`
- `Header`
- `Sidebar`
- `PageLayout`

Expected outcomes:
- more deliberate vertical rhythm below the sticky header
- header search and action controls visually aligned with the primitive system
- sidebar density aligned with main content density
- one default content-width and padding model for app pages

## 10.7 Surface-Specific Refactors

### 10.7.1 Tasks

Files:
- `TaskFilterBar.tsx`
- `TaskList.tsx`
- `TaskCard.tsx`
- `views/TasksView.tsx`

Changes:
- move filters into a shared panel pattern
- tighten card content hierarchy
- unify metadata spacing
- align loading and empty states with the shared state system

### 10.7.2 Task Creation

Files:
- `CreateTaskForm.tsx`
- `views/CreateTaskView.tsx`

Changes:
- improve section grouping and spacing rhythm
- align form labels, controls, helper text, and section blocks
- make the paid-action form feel cleaner and more trustworthy

### 10.7.3 Task Detail

Files:
- `TaskDetail.tsx`
- `views/TaskDetailView.tsx`
- mode-specific panels as needed

Changes:
- improve density and spacing in detail sections
- unify metadata grid treatment
- align status/tag/action treatments with shared components

### 10.7.4 Agents and Rankings

Files:
- `AgentTable.tsx`
- `LeaderboardTable.tsx`
- `views/AgentDirectoryView.tsx`
- `views/LeaderboardView.tsx`
- `views/AgentProfileView.tsx`

Changes:
- unify filter layout with tasks
- replace raw skill pills with shared badge treatment
- reduce visual mismatch between directory and leaderboard
- standardize stat card and section composition in agent profiles

### 10.7.5 Landing and Protocol

Files:
- `views/LandingView.tsx`
- `views/ProtocolView.tsx`

Changes:
- keep bold hero character
- normalize section spacing and card rhythm
- align marketing surfaces with app surfaces without flattening the brand

## 10.8 Styling Cleanup Rules

During implementation:
- prefer shared primitives over raw repeated utility clusters
- avoid new hardcoded color classes where tokens should be used
- avoid direct edits to autogenerated design-system output
- preserve current typography and square-edge direction unless there is a clear design reason not to

## 10.9 Risks

1. Over-normalizing the UI could erase the product's distinctive character.
2. Token changes could create unintended regressions in dark mode.
3. Refactoring shared primitives could subtly affect screens not reviewed visually.
4. The lack of existing E2E visual coverage means manual QA remains important.

## 10.10 Rollout Strategy

1. Land foundation work first:
   - tokens
   - primitives
   - page header/state patterns
2. Refactor core product routes next.
3. Refactor landing and protocol after the shared system is stable.
4. Run final desktop and mobile QA across all primary routes.

## 11. Test-Driven Development Plan

## 11.1 Testing Philosophy

Follow strict test-first workflow where practical:
1. write or update the failing test for the shared component or view contract
2. implement the minimal presentational change
3. refactor without changing behavior
4. complete visual QA before considering the route done

Because this is a polish pass, not every requirement can be proven with automated tests alone. The release gate must combine automated checks with structured visual review.

## 11.2 Test Layers

1. Unit tests
   - primitive rendering and variant behavior
   - shared layout component rendering
   - state component rendering
2. Component integration tests
   - route view smoke tests with mocked data
   - filter surfaces render expected controls and headings
   - task and agent summary surfaces render shared treatments
3. Manual visual QA
   - desktop and mobile review for all primary routes
   - light and dark mode review for shared components
4. Regression checks
   - existing frontend tests remain green
   - lint, format, and type-check pass

## 11.3 Proposed Test Additions

Frontend test targets:
- `apps/frontend/src/components/ui/button.test.tsx`
- `apps/frontend/src/components/ui/card.test.tsx`
- `apps/frontend/src/components/ui/badge.test.tsx`
- `apps/frontend/src/components/layout/PageHeader.test.tsx`
- `apps/frontend/src/components/ui/StatePanel.test.tsx`
- route/view smoke tests for:
  - tasks view
  - create task view
  - agent directory view
  - leaderboard view

These tests should verify:
- headings and supporting copy render correctly
- shared components expose expected semantic structure
- loading and empty states render through shared components
- core controls remain present after refactors

## 11.4 Requirement Traceability Matrix

| Requirement | Test Type | Example Test |
| --- | --- | --- |
| FR-001 primitive consistency | Unit | button, input, and card variants render expected shared classes and semantics |
| FR-010 shared page headers | Component | tasks and leaderboard views render through `PageHeader` |
| FR-020 filter consistency | Component | tasks and agents filters render inside one shared filter surface |
| FR-030 shared loading states | Component | task list and agent profile loading states use `StatePanel` |
| FR-040 mobile readability | Manual QA | task browse and create-task routes pass mobile review at common viewport widths |
| NFR-004 token workflow | Process | token changes regenerate frontend artifacts through `make design-system` |
| NFR-005 accessibility | Unit + Manual QA | focus treatment remains visible and heading hierarchy remains intact |

## 11.5 Release Checklist

1. `make design-system` run after token updates.
2. Frontend tests added and passing.
3. `make lint-check frontend`
4. `make type-check frontend`
5. Manual QA completed for desktop and mobile on all primary routes.
6. Dark mode spot-check completed for shared primitives and app shell.

## 12. Acceptance Criteria

This effort is complete when:
- primary routes feel visually consistent without losing Taskmarket identity
- shared primitives, not one-off styling, control most common surfaces
- filters, cards, tables, and state treatments follow one system
- page hierarchy is cleaner and more predictable
- mobile and dark mode quality are verified for the main routes
- no functional marketplace behavior is changed as part of the polish pass
