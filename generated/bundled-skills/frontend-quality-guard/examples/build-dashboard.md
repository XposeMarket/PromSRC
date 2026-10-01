# Example: Build A Practical Dashboard

User request:

> Build a dashboard for tracking support queue health.

Execution:

1. Inspect the repo for framework, chart library, table components, and theme tokens.
2. Choose an operational SaaS layout, not a landing page.
3. Implement:
   - KPI strip: open tickets, SLA risk, median first response, satisfaction
   - filter bar: queue, priority, owner, date range
   - primary chart: ticket volume and SLA risk
   - table: tickets with status, age, owner, priority
   - detail panel for selected ticket
   - empty/loading/error placeholders if data loading exists
4. Use compact spacing, restrained color, and table-first density.
5. Verify desktop and mobile. On mobile, preserve filters and table readability with stacked rows or horizontal table containment.
6. Run build/lint and report exact checks.

Avoid:

- giant hero saying "Support smarter"
- three feature cards instead of queue data
- charts without labels or units
- decorative gradients that reduce scan speed
