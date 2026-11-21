package groot.mobile

import groot.mobile.data.api.BotStreamEvent
import groot.mobile.data.api.ChatPage
import groot.mobile.data.api.ChatState
import groot.mobile.data.api.MessageRole
import groot.mobile.data.api.MessageStatus
import groot.mobile.data.api.QueuedMessage
import groot.mobile.data.api.RoutineRunCard
import groot.mobile.data.api.ToolStatus
import groot.mobile.data.chat.ChatAction
import groot.mobile.data.chat.ChatHealth
import groot.mobile.data.chat.ChatSession
import groot.mobile.data.chat.Echo
import groot.mobile.data.chat.OutboxEntry
import groot.mobile.data.chat.TimelineItem
import groot.mobile.data.chat.chatTimeline
import groot.mobile.data.chat.chatView
import groot.mobile.data.chat.reduceChat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatSessionTest {
    private fun stream(state: ChatSession, event: BotStreamEvent) = reduceChat(state, ChatAction.Stream(event))

    private fun snapshot(vararg ids: String, hasMore: Boolean = false, busy: Boolean = false) = BotStreamEvent.Snapshot(
        ChatState(ids.map { message(it, if (it.endsWith("u")) MessageRole.User else MessageRole.Assistant, "text $it") }, busy, emptyList(), hasMore),
    )

    @Test
    fun `a snapshot loads the chat and deltas grow the live reply`() {
        var state = stream(ChatSession(), snapshot("e1u", busy = true))
        assertTrue(state.loaded && state.connected && state.busy)
        state = stream(state, BotStreamEvent.Upsert(message("live", MessageRole.Assistant, "", status = MessageStatus.Streaming)))
        state = stream(state, BotStreamEvent.Delta("live", "Hel", null))
        state = stream(state, BotStreamEvent.Delta("live", "lo", "thinking"))
        assertEquals("Hello", state.messages.last().text)
        assertEquals("thinking", state.messages.last().reasoning)
        state = stream(state, BotStreamEvent.Remove("live"))
        assertEquals(listOf("e1u"), state.messages.map { it.id })
    }

    @Test
    fun `an echo is confirmed by request id, not by text`() {
        var state = stream(ChatSession(), snapshot())
        state = reduceChat(state, ChatAction.AddEcho(Echo("req-1", "ok", FIXED_NOW)))
        state = stream(state, BotStreamEvent.Upsert(message("e1", MessageRole.User, "ok").copy(requestId = "other")))
        assertEquals(1, state.echoes.size)
        state = stream(state, BotStreamEvent.Upsert(message("e2", MessageRole.User, "ok (annotated by the server)").copy(requestId = "req-1")))
        assertTrue(state.echoes.isEmpty())
    }

    @Test
    fun `a queued item supersedes its echo, and a refused send removes it`() {
        var state = stream(ChatSession(), snapshot(busy = true))
        state = reduceChat(state, ChatAction.AddEcho(Echo("req-1", "wait for me", FIXED_NOW)))
        state = reduceChat(state, ChatAction.AddEcho(Echo("req-2", "refuse me", FIXED_NOW)))
        state = stream(state, BotStreamEvent.Queued(listOf(QueuedMessage("req-1", "steer", "wait for me"))))
        assertEquals(listOf("req-2"), state.echoes.map { it.requestId })
        state = reduceChat(state, ChatAction.EchoRefused("req-2"))
        assertTrue(state.echoes.isEmpty())
        val view = chatView(state)
        assertEquals(OutboxEntry.State.Steering, view.held.single().state)
    }

    @Test
    fun `an offline echo shows as waiting and retries with the same id`() {
        var state = reduceChat(stream(ChatSession(), snapshot()), ChatAction.AddEcho(Echo("req-1", "hi", FIXED_NOW)))
        state = reduceChat(state, ChatAction.EchoOffline("req-1"))
        assertEquals(OutboxEntry.State.Offline, (chatView(state).timeline.last() as TimelineItem.EchoItem).echo.state)
        state = reduceChat(state, ChatAction.EchoRetry("req-1"))
        assertEquals(OutboxEntry.State.Sending, (chatView(state).timeline.last() as TimelineItem.EchoItem).echo.state)
    }

    @Test
    fun `a reconnect's snapshot keeps the older pages already loaded`() {
        var state = stream(ChatSession(), snapshot("e10", "e11", hasMore = true))
        state = reduceChat(state, ChatAction.OlderLoading)
        state = reduceChat(state, ChatAction.OlderPage("e10", ChatPage(listOf(message("e8", MessageRole.User, "old"), message("e9", MessageRole.Assistant, "older")), hasMore = false)))
        assertEquals(listOf("e8", "e9", "e10", "e11"), state.messages.map { it.id })
        assertFalse(state.hasMore)
        state = stream(state, snapshot("e11", "e12", hasMore = true))
        assertEquals(listOf("e8", "e9", "e10", "e11", "e12"), state.messages.map { it.id })
        state = stream(state, snapshot("e20"))
        assertEquals(listOf("e20"), state.messages.map { it.id })
    }

    @Test
    fun `a stale page of older messages is dropped`() {
        var state = stream(ChatSession(), snapshot("e10", hasMore = true))
        state = stream(state, snapshot("e30"))
        state = reduceChat(state, ChatAction.OlderPage("e10", ChatPage(listOf(message("e9", MessageRole.User, "old")), hasMore = false)))
        assertEquals(listOf("e30"), state.messages.map { it.id })
    }

    @Test
    fun `the unread divider sits above the first reply after the read marker, fixed per visit`() {
        val messages = listOf(
            message("e1", MessageRole.User, "a", minutesAgo = 30),
            message("e2", MessageRole.Assistant, "read", minutesAgo = 29),
            message("e3", MessageRole.Assistant, "new", minutesAgo = 5),
        )
        var state = reduceChat(ChatSession(unreadFrom = FIXED_NOW - 10 * 60_000), ChatAction.Opened)
        state = stream(state, BotStreamEvent.Snapshot(ChatState(messages, false, emptyList(), false)))
        assertEquals("e3", chatView(state).unreadDividerId)
        state = stream(state, BotStreamEvent.Upsert(message("e4", MessageRole.Assistant, "newer", minutesAgo = 0)))
        assertEquals("e3", chatView(state).unreadDividerId)
        val fresh = stream(reduceChat(ChatSession(), ChatAction.Opened), BotStreamEvent.Snapshot(ChatState(messages, false, emptyList(), false)))
        assertNull(chatView(fresh).unreadDividerId)
    }

    @Test
    fun `health, typing and yolo follow the stream`() {
        assertEquals(ChatHealth.Loading, chatView(ChatSession()).health)
        var state = stream(ChatSession(), snapshot("e1u", busy = true))
        assertTrue("busy with nothing on screen shows the dots", chatView(state).typing)
        state = stream(state, BotStreamEvent.Upsert(message("live", MessageRole.Assistant, "", status = MessageStatus.Streaming)))
        assertFalse(chatView(state).typing)
        state = reduceChat(state, ChatAction.StreamDrop)
        assertEquals(ChatHealth.Reconnecting, chatView(state).health)
        state = stream(state, BotStreamEvent.Yolo(true))
        assertTrue(chatView(state).yolo)
        state = reduceChat(state, ChatAction.Closed)
        assertEquals(ChatHealth.Loading, chatView(state).health)
    }

    @Test
    fun `tool-only rounds fold into the reply that follows, and skip replies are hidden`() {
        val messages = listOf(
            message("e1", MessageRole.User, "go"),
            message("e2", MessageRole.Assistant, "", toolCalls = listOf(tool("web_search"))),
            message("e3", MessageRole.Assistant, "", toolCalls = listOf(tool("web_fetch"))),
            message("e4", MessageRole.Assistant, "answer", toolCalls = listOf(tool("web_fetch", mapOf("url" to "x")))),
            message("e5", MessageRole.Assistant, "[skip]"),
        )
        val timeline = chatTimeline(messages, emptyList())
        assertEquals(2, timeline.size)
        val reply = (timeline[1] as TimelineItem.Message).message
        assertEquals("answer", reply.text)
        assertEquals(listOf("web_search", "web_fetch", "web_fetch"), reply.toolCalls.map { it.name })
        assertEquals("the row keeps the first round's key as rounds land", "m:e2", timeline[1].key)
    }

    @Test
    fun `a round that waits on the owner does not fold away`() {
        val messages = listOf(
            message("e1", MessageRole.Assistant, "", toolCalls = listOf(tool("browser_open", status = ToolStatus.AwaitingApproval, taskId = 1))),
            message("e2", MessageRole.User, "why"),
        )
        assertEquals(2, chatTimeline(messages, emptyList()).size)
    }

    @Test
    fun `routine runs slot in by time and back-to-back runs share a line`() {
        fun run(id: String, minutesAgo: Long) = RoutineRunCard(id, "r", "Morning", "succeeded", "schedule", 0, FIXED_NOW - minutesAgo * 60_000, "ok", null)
        val messages = listOf(message("e1", MessageRole.User, "a", minutesAgo = 50), message("e2", MessageRole.Assistant, "b", minutesAgo = 10))
        val timeline = chatTimeline(messages, listOf(run("x", 30), run("y", 20), run("z", 1)))
        assertEquals(listOf("m:e1", "runs:x", "m:e2", "runs:z"), timeline.map { it.key })
        assertEquals(2, (timeline[1] as TimelineItem.RoutineRuns).runs.size)
    }
}
