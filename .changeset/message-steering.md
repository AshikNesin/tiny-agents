---
"@tiny-agents/agent": patch
"@groot/web": patch
---

Add message steering: sending while a bot is replying no longer blocks. Enter (or the send button, which stays live beside Stop) submits the message as a steer that joins the running reply after its current tool round; Alt+Enter queues a follow-up answered by the next run. Held messages render inline as tagged bubbles ("Steering into the reply" / "Queued for the next reply") with a cancel (x) that withdraws them, survive a reload from the server's durable queue, and flow into the transcript once placed. Cross-bot deliveries keep the queued-follow-up behavior.
