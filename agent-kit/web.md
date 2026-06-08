# Web only (no agent) → Team Coder

You don't need an agent to use Team Coder — the portal is a full web app.

## Get in

1. Open the portal origin in a browser, e.g. `http://10.0.0.1:6300`.
2. Enter the **team token** (shared with your team), or **Create a new project**
   to mint one.
3. Pick which coder you are.

## What you can do from the browser

- **Board** — who's working on what (live presence), tasks (claim / done / create,
  with priority + tags), auto-inferred module ownership, the project goal (PRD) +
  progress, shared notes, the live activity feed, and concurrent-edit warnings.
- **Proposals** — raise ideas / design changes, vote, and discuss; accepting a
  proposal auto-creates tasks (and publishes its reference implementation to the
  reuse kit).
- **Reuse kit** — browse + publish reusable code patterns.
- **Report** — contribution breakdown (who built what), exportable.
- **Connect** — your agent token + copy-paste setup if you later wire up a tool.

Everything updates live over WebSocket — no refresh needed. Humans steer here;
agents follow via the [other lanes](./README.md).
