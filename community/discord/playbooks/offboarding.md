# Staff and integration offboarding

Owner: Community Lead. Backup: Security Lead. Start immediately for involuntary or security-related
departures and within 30 minutes of the recorded end time for every other departure. Escalate
missing access, unexplained audit-log activity, or shared-credential exposure to the incident
commander. Review the roster monthly and exercise one sample offboarding quarterly.

1. A second authorized staff member removes every staff role, private-channel override, managed
   integration assignment, active session, and server-specific invite owned by the departing user.
2. Transfer ownership of webhooks, scheduled events, forum threads, runbooks, and external records;
   delete personal webhooks rather than leaving them ownerless.
3. Rotate any credential the person or integration could access, including registration tokens,
   webhook tokens, bot tokens, and external alert destinations. Never paste replacement values into
   Discord.
4. Compare effective permissions, role order, integrations, webhooks, and recent audit-log actions
   with the approved blueprint. Preserve suspicious evidence in the restricted canonical record.
5. Record the actor, subject, start and completion time, access removed, credentials rotated,
   transferred ownership, exceptions, and second-person verification outside Discord.
