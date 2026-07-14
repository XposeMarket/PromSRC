# Development escalation

This reference is private to development distributions. Apply it only after the base Self Repair workflow establishes that operational recovery cannot resolve the incident and the evidence indicates a reproducible Prometheus source defect.

Prepare one evidence packet containing:

- expected and observed behavior;
- minimal reproduction;
- affected subsystem;
- relevant live task, runtime, audit, and log evidence;
- non-source recovery already attempted;
- confidence and unresolved uncertainty.

Create the structured packet with `diagnostic_packet(action:"create", classification:"application_defect", operational_recovery_exhausted:true, ...)`. Then read `src-edit-proposal-rigor`, inspect current source through its approved read path, and use the standard `write_proposal` code-change lane with the packet ID and evidence cited in the proposal. That skill and proposal executor are the sole source mutation workflow and own approval, canonical paths, dirty-state preservation, scope, sandboxing, testing, promotion, and restart verification.

Do not apply a patch through Self Repair. Do not use the legacy independent Self Repair patch executor. Do not bypass source-edit approval or broaden the diagnosed scope silently.
