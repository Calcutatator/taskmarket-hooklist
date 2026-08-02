# Taskmarket component catalogue

Storybook is the visual development and regression environment for `apps/web`.

Run it on its own with `make storybook`, or alongside the application with
`make dev storybook`. Use `make storybook-ci` to run the same coverage, static
build, browser-rendering, interaction, and accessibility audit used in CI.

## Story expectations

Stories are grouped by the level at which a component is normally reviewed:

- primitives and form controls;
- charts and visualizations;
- product surfaces such as tasks, drops, actions, artifacts, and submissions;
- application shells, loading states, and complete user flows.

Each component should be shown with every materially different visual or data
state it supports. Include empty, loading, error, disconnected, long-content,
boundary-value, status, mode, and responsive variants where they apply. Composite
stories should use representative data rather than placeholder-only content.

## Coverage contract

Every component module under `components/` must have a
`storybook-coverage: components/path/to/component.tsx` marker in the story that
exercises it. A component that cannot render independently must be listed with a
specific reason in `.storybook/component-exclusions.json`.

`make storybook-ci` rejects missing or stale markers and exclusions. Accessibility
violations are reported as audit todos during the initial catalogue rollout so
existing debt stays visible without hiding rendering regressions.
