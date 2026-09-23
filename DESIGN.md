---
version: alpha
name: "Helixis distributed pharmacy control room"
description: "A warm-white, black-ink system interface that opens from the supplied capsule sequence into a readable six-node pharmacy network console."
colors:
  primary: "#151512"
  background: "#F5F5F0"
  ink: "#151512"
  muted: "#6D6D66"
  line: "#D3D3CA"
  panel: "#EEEEE8"
  darkSurface: "#151512"
  darkLine: "#3D3D36"
  good: "#607565"
  warning: "#8D7650"
  danger: "#925D59"
typography:
  display:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "6.6rem"
    lineHeight: "0.86"
  editorial:
    fontFamily: "Playfair Display, Georgia, serif"
    fontSize: "5.3rem"
    lineHeight: "0.9"
  body:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "0.9375rem"
    lineHeight: "1.7"
  utility:
    fontFamily: "DM Mono, ui-monospace, monospace"
    fontSize: "0.5625rem"
    lineHeight: "1.4"
rounded:
  DEFAULT: "0px"
  capsule: "145px"
spacing:
  page-max: "1370px"
  page-gutter: "56px"
  section-gap: "155px"
components:
  navigation: { "backgroundColor": "#F5F5F0", "textColor": "#151512", "height": "76px" }
  sequence: { "backgroundColor": "#F5F5F0", "textColor": "#151512", "height": "100vh" }
  table: { "backgroundColor": "#F5F5F0", "textColor": "#151512", "rounded": "0px" }
  dialog: { "backgroundColor": "#F5F5F0", "textColor": "#151512", "rounded": "0px" }
---

# Helixis distributed pharmacy control room design system

## Overview

### Creative north star

The supplied capsule is a physical metaphor for the system: a sealed pharmaceutical object opens, then reveals the network that makes the record trustworthy. The page transitions from gallery-like stillness into a precise control room without becoming a generic SaaS dashboard.

### Product context and register

- **Audience:** project reviewers, distributed-systems learners, pharma-operations stakeholders, and research partners.
- **Primary communication job:** show within three seconds that one query crosses a real six-node network and returns accountable records.
- **Primary message:** One network. Six nodes. Every record accountable.
- **Register:** marketing shell plus read-only operational console.
- **Signature:** 100 supplied capsule frames scrubbed by scroll, followed by a live Java/RMI data explorer.
- **Runtime token mapping:** this file owns the durable design decisions; CSS tokens live in `styles.css` under the matching `--paper`, `--ink`, `--muted`, `--line`, `--dark`, `--dark-line`, `--good`, `--warn`, and `--bad` names.

## Color

Warm paper `#F5F5F0` carries the editorial surface. Near-black `#151512` carries primary text, the dark network and protocol sections, and the main route action. Hairline `#D3D3CA` defines the data grid. Green, ochre, and muted red are reserved for state meaning: healthy, waiting/at risk, and unavailable/conflicted.

## Typography

Manrope carries headings, body copy, table content, and actions. Playfair Display is limited to one short editorial phrase inside a major heading. DM Mono is reserved for routes, ports, node IDs, statuses, table labels, and protocol metadata. Data remains readable at normal sizes; utility text never carries essential information alone.

## Layout and hierarchy

1. The supplied frame sequence is the first and only spectacle.
2. The system overview makes counts and gateway state legible immediately after the opening.
3. The node layer shows the six RMI registries and coordinator candidate.
4. The fault-tolerance lab makes primary-backup failover, degraded commit, recovery, and replay observable.
5. The data explorer exposes the five collections with real sorting, search, and record details.
6. The protocol and database sections explain why the records are trustworthy and where persistence fits.

The desktop grid is centered at 1370px with a 56px gutter. The data table owns horizontal overflow on narrow screens; the page itself never creates horizontal scrolling. Cards are square-edged and quiet. The capsule is the only strongly rounded object.

## Interaction contract

- `Refresh` repeats read-only gateway calls and preserves the selected collection.
- Collection tabs use native buttons and keep their active state visible.
- Table headers sort the current collection; no state is lost when the sort changes.
- Record identifiers open an app-owned native dialog with keyboard-close support.
- Search has an explicit clear action and returns local records plus an RMI route trace when available.
- The fault lab uses explicit buttons for `Append test event`, `Fail Mumbai`, `Recover Mumbai`, and `Reset lab`; disabled actions reflect the current simulation state.
- Fault-lab feedback shows the current term, active node, replica acknowledgements, replay lag, and audit trail in the same surface as the controls.
- The UI presents `catalog-only` and `rmi-live` as different evidence states; it does not imply that an unreachable cluster is healthy.
- The fault-lab POST route changes only ephemeral simulation state in the Java gateway; no browser control can dispense medicine, alter inventory, edit a prescription, or delete a record.

## Motion

The capsule is scrubbed by scroll through `ScrollTrigger`; `ScrollSmoother` supports the page handoff. Section and node reveals are short and subordinate to the data. Reduced-motion users receive the final capsule frame without continuous scrubbing, and all interactive content remains accessible without animation.

## Data and trust

The browser consumes the Java `PharmacyWebServer` gateway. The gateway projects `HardcodedData`, probes RMI registries, optionally routes search through the supplied Mumbai `PharmacyRouter`, and hosts a separate `PrimaryBackupSimulation` state machine for the fault lab. `sql/reference/pharmacy_schema.sql` is visible as a migration reference but is not treated as a live database. This distinction is shown in the database map so the interface never confuses a demo read model with persistence.

## Do's and don'ts

- **Do:** keep node origin, sync state, idempotency key, and protocol meaning visible.
- **Do:** use semantic tables, visible keyboard focus, and stable loading/error geometry.
- **Do:** preserve the monochrome palette and spend emphasis on the capsule plus the data route.
- **Do:** make failover evidence concrete: active role, term, acknowledgements, lag, and replay should be readable without animation.
- **Don't:** add neon sci-fi gradients, invented KPI stories, fake persistence, or write controls without a verified mutation contract.
- **Don't:** present the fault lab as clinical data replication or imply that its in-memory state survives a gateway restart.
- **Don't:** hide an offline node behind a green aggregate status.
