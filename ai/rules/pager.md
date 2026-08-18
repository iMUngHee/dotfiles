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

- **You cannot name the recipient.** Run `pager who`; if nobody there owns the
  affected work, there is nowhere to send.
- **The body would only say what changed.** Without why it matters, the message costs
  the recipient context and returns nothing.
- **They will hit it themselves.** Already in a commit or plan they read anyway.
- **Progress nobody asked for.**

## How

`pager who` for the name, then `pager send <name> "<body>"`. Lead with the
consequence for them, not with what you did.
