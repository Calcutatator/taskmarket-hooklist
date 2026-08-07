# Incident communications

Owner: Security Lead. Incident commander: the first available Owner or Security Lead who explicitly
accepts the role. Communications lead: Community Lead or Publisher. The canonical incident system
outside Discord records severity, decisions, evidence, actions, and the next update deadline.

Activate the incident process for suspected credential compromise, public-data leakage, widespread
task/payment failure, malicious integration behavior, or a raid that normal moderation cannot
contain. Classify severity before posting:

- SEV-1: active compromise, privacy exposure, or widespread market unavailability. Disable the
  affected app/integration, page Security and Engineering, and post at least every 30 minutes.
- SEV-2: material degradation or targeted abuse with a working containment. Page the owning team
  and post at least every 60 minutes.
- SEV-3: limited issue with a documented workaround. Track outside Discord and update when the
  state materially changes.

Contain first: remove unsafe links, disable affected integrations or the Interactions Endpoint URL,
restrict posting when necessary, preserve evidence outside Discord, and rotate exposed credentials.
Recovery requires the owning engineer and incident commander to confirm the affected surface is
healthy, monitoring is stable, and any temporary permissions are restored deliberately.

The canonical incident record and status page lead; Discord amplifies concise updates. Each update
states observed impact, affected surfaces, current mitigation, next update time, and canonical
status link. Distinguish confirmed facts from investigation. Do not speculate about cause, expose
personal data, or paste internal logs.

Use `status` for service impact and `announcements` only for severe, broad, or long-running events.
Close with the final status link and a short member-facing summary. Publish deeper analysis in the
canonical post-incident location, not a Discord transcript.
