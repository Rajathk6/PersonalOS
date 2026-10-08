# OPEN_QUESTIONS — answer before Phase 0 code (max 8)

## 1. Should the local API need a password/PIN at first, or no login on your own laptop?
- A: No login for now (fastest; anyone on the laptop can call it)
- B: Simple PIN/token on every call (a bit more setup, safer on shared Wi-Fi)
- Recommendation: B — a one-line token in env; costs minutes now, avoids an open API later.

## 2. Postgres: Docker container or installed directly on the laptop?
- A: Docker Compose (matches roadmap; easy reset; needs Docker running)
- B: Native install (one less dependency; harder to reset cleanly)
- Recommendation: A — roadmap and recovery tests assume `docker restart db`.

## 3. Which first demo matters most to you (Phase 1's one working flow)?
- A: Reminders ("remind me at 4 to leave at 6")
- B: Finance ("add ₹235 for chicken tikka")
- C: Jobs ("find govt engineering jobs worth applying for")
- Recommendation: A — reminders exercise intent→task→worker→persist with zero sensitive data or math risk.

## 4. Phone: real app/screens now, or confirm it stays a thin client until Phase 9?
- A: Later (Phase 9; phone only views status/approvals; core first)
- B: Now (basic phone UI alongside core; slower core, earlier feel)
- Recommendation: A — North Star says thin client; building it now repeats the scope-creep risk.

## 5. Backups: what should survive a dead laptop/SSD?
- A: Nothing special yet (database volume only; rebuild from scratch if disk dies)
- B: Nightly Postgres dump to a folder/pen-drive you own (cheap insurance)
- Recommendation: B — a one-line dump script; power cuts + single SSD make A risky.

## 6. Phase 0 on one machine or two (laptop + Pi) from day one?
- A: One machine (laptop only; Pi joins in Phase 8)
- B: Two machines now (real multi-node early; double the setup/debugging)
- Recommendation: A — worker registration already keeps the door open; prove recovery on one box first.

## 7. How should the system tell you things in Phase 0–1 (before the phone app)?
- A: Terminal + log files only (simplest, no extra moving parts)
- B: Terminal + local desktop notification / email draft (nicer feel, more code)
- Recommendation: A — notifications become a permission-gated tool in Phase 3; don't pre-build them.
