# Pager — When to Message Another Session

`pager` delivers messages between agent sessions. Delivery is solved; deciding to
send is not. Send when one of these holds — not otherwise.

## Send

- **You changed a shared contract.** Something with more than one consumer: a deploy
  source, a shared rule file, a CLI signature, a schema. Name what changed and what
  breaks if they assume the old shape.
- **You learned their basis is wrong.** They acted on a fact you can now disprove.
  Say what you verified and how.
- **A result they asked for is ready.** They requested it; the answer exists now.

## Do not send

- **You cannot name the recipient.** Run `pager who` or `ListAgents`; if nobody there
  owns the affected work, there is nowhere to send.
- **The body would only say what changed.** Without why it matters, the message costs
  the recipient context and returns nothing.
- **They will hit it themselves.** Already in a commit or plan they read anyway.
- **Progress nobody asked for.**

## How

Two channels reach another session, and their inboxes do not cross over: a
`SendMessage` never lands in `msg_list`, and a `pager send` never lands in the peer's
built-in inbox. Pick one per exchange and expect the reply on that same one.

- **Default — `pager`.** `pager who` for the name, then `pager send <name> "<body>"`.
  The only channel that reaches Codex, and the only one with an inbox you can read
  (`msg_list`) — so use it whenever you expect a reply.
- **Built-in `SendMessage`** — Claude Code peers only; `ListAgents` for the name and
  its live busy/idle state. One-way: the peer's user may have to approve it, and it can
  be declined, expire, be refused outright, or be dropped at their inbox. Do not wait
  for a reply and do not resend. Use for a notice, not a question.

Lead with the consequence for them, not with what you did.
