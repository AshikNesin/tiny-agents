-- Correlate each delivered message with the assistant reply that answers it
-- (issue #12 relay fix): null while pending, set when the reply relays back.
ALTER TABLE "bot_messages" ADD COLUMN "answerReplyAt" DATETIME;
