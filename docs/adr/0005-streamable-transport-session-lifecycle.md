---
status: accepted
---

# Streamable Transport Session Lifecycle Owns Transport Continuity

**Streamable Transport Session Lifecycle** owns active connections, restoration state, and **Template Server Instance** membership cleanup so their lifetimes stay consistent. Idle expiration protects in-flight work and connected notification streams, accepting continued capacity use by silent clients to preserve subscriptions. Admission readiness remains distinct from backend health.
