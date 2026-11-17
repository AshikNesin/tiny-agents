---
"tiny-agents": patch
"@tiny-agents/agent": patch
---

Routines: each run starts a fresh conversation instead of re-sending every earlier run's history with each request, which made frequent routines cost far more than their own work. A run's prompt quotes the routine's three latest results instead, a fire while the previous run is still working is skipped, and a run has a 500k-token budget: past it the Tool gate refuses tool calls so the model wraps up, at 1.5x the run is stopped, and the run is recorded blocked. Each run's token spend is stored and shown on the Routines page. The agent runtime gains `CapabilitySelection.budgetTokens` and `usedTokens(ref)`.
