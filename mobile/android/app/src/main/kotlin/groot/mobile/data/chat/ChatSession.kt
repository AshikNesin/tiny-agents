package groot.mobile.data.chat

import groot.mobile.data.api.AttachmentRef
import groot.mobile.data.api.BotStreamEvent
import groot.mobile.data.api.ChatAuthor
import groot.mobile.data.api.ChatMessage
import groot.mobile.data.api.ChatPage
import groot.mobile.data.api.ChatState
import groot.mobile.data.api.MessageRole
import groot.mobile.data.api.MessageStatus
import groot.mobile.data.api.PastChat
import groot.mobile.data.api.PastChatView
import groot.mobile.data.api.QueuedMessage
import groot.mobile.data.api.RoutineRunCard

/*
 * One bot's chat as the app holds it, pure (the web client's lib/chat-session.ts): what the
 * bot stream said, what only this device knows (Echoes, stream health, paging, the read
 * marker), the one reducer every change goes through, and the view the chat screen renders.
 *
 * An owner message has one life here: an Echo while its send is in flight or waits for the
 * network, a queued item while the server holds it behind (or steering into) the running
 * reply, and a transcript message once placed.
 */

/** The optimistic copy of an owner send, shown until the server confirms it. */
data class Echo(
    /** Minted once, reused by every retry, and what confirms the Echo. */
    val requestId: String,
    val text: String,
    /** Device clock, when it was sent. */
    val createdAt: Long,
    val attachments: List<AttachmentRef> = emptyList(),
    /** No answer came: it goes again, same id, once the server is reachable. */
    val offline: Boolean = false,
)

data class ChatSession(
    /** The transcript loaded so far: the stream's window plus older pages. */
    val messages: List<ChatMessage> = emptyList(),
    val hasMore: Boolean = false,
    val loadingOlder: Boolean = false,
    val busy: Boolean = false,
    val queued: List<QueuedMessage> = emptyList(),
    val routineRuns: List<RoutineRunCard> = emptyList(),
    /** YOLO mode; unknown until its stream event arrives. */
    val yolo: Boolean? = null,
    val echoes: List<Echo> = emptyList(),
    /** False while the stream is down. */
    val connected: Boolean = false,
    /** True once this visit's first snapshot arrived; until then the transcript is unknown, not empty. */
    val loaded: Boolean = false,
    /** Pre-open read marker (epoch ms): messages newer than it arrived while the owner was away. */
    val unreadFrom: Long? = null,
    /** The reply the "New messages" divider goes above; [DIVIDER_UNSET] until the visit's first snapshot. */
    val dividerId: String? = DIVIDER_UNSET,
    /** A past chat's record once read; null for the live chat. */
    val past: PastChat? = null,
) {
    companion object {
        /** The divider has not been placed yet for this visit. */
        const val DIVIDER_UNSET = "\u0000unset"
    }
}

/** Everything that changes a chat besides a stream event. */
sealed interface ChatAction {
    data class Stream(val event: BotStreamEvent) : ChatAction

    /** On screen again: a new visit, whose first snapshot places the divider. */
    data object Opened : ChatAction

    /** Off screen: the cache stays, but is stale until the next visit's snapshot. */
    data object Closed : ChatAction
    data object StreamOpen : ChatAction
    data object StreamDrop : ChatAction
    data class AddEcho(val echo: Echo) : ChatAction
    data class EchoOffline(val requestId: String) : ChatAction
    data class EchoRetry(val requestId: String) : ChatAction

    /** The server refused the send: the draft goes back to the composer. */
    data class EchoRefused(val requestId: String) : ChatAction
    data object OlderLoading : ChatAction
    data class OlderPage(val before: String, val page: ChatPage) : ChatAction
    data object OlderFailed : ChatAction
    data class PastChatRead(val view: PastChatView) : ChatAction
}

private val ENTRY_ID = Regex("^e(\\d+)$")

/** Transcript order of an entry id ("e42"); live and marker ids sort last. */
private fun order(id: String): Long = ENTRY_ID.find(id)?.groupValues?.get(1)?.toLongOrNull() ?: Long.MAX_VALUE

/** The id to page back from: the oldest loaded transcript entry. */
fun oldestEntryId(messages: List<ChatMessage>): String? = messages.firstOrNull { ENTRY_ID.matches(it.id) }?.id

/**
 * A reconnect's snapshot is the newest window again; keep the older pages already loaded
 * above it. A snapshot that starts at the beginning replaces everything.
 */
internal fun mergeSnapshot(previous: ChatSession, snapshot: ChatState): Pair<List<ChatMessage>, Boolean> {
    val first = snapshot.messages.firstOrNull()
    if (!snapshot.hasMore || first == null) return snapshot.messages to snapshot.hasMore
    val older = previous.messages.filter { order(it.id) < order(first.id) }
    if (older.isEmpty()) return snapshot.messages to true
    return (older + snapshot.messages) to previous.hasMore
}

private fun attachmentIds(attachments: List<AttachmentRef>): String = attachments.map { it.uploadId }.sorted().joinToString(",")

/** How far a legacy confirmation's server clock may run behind the Echo's device clock. */
private const val LEGACY_ECHO_SKEW_MS = 5_000L

/** Whether a confirmed user message is [echo]'s: by request id, else by text and attachments. */
private fun echoMatches(echo: Echo, message: ChatMessage): Boolean {
    if (message.requestId != null) return message.requestId == echo.requestId
    return message.createdAt >= echo.createdAt - LEGACY_ECHO_SKEW_MS &&
        echo.text.trim() == message.text.trim() &&
        attachmentIds(echo.attachments) == attachmentIds(message.attachments)
}

/** Echoes still waiting: not confirmed by these messages, not held by the server as queued. */
private fun unconfirmed(echoes: List<Echo>, messages: List<ChatMessage>, queued: List<QueuedMessage>): List<Echo> =
    echoes.filter { echo ->
        messages.none { it.role == MessageRole.User && echoMatches(echo, it) } && queued.none { it.requestId == echo.requestId }
    }

/** The first bot reply newer than the read marker (only replies count). */
private fun firstUnreadReply(messages: List<ChatMessage>, unreadFrom: Long?): String? =
    messages.firstOrNull { it.role == MessageRole.Assistant && it.createdAt > (unreadFrom ?: 0L) }?.id

private fun patchEcho(state: ChatSession, requestId: String, offline: Boolean): ChatSession =
    state.copy(echoes = state.echoes.map { if (it.requestId == requestId) it.copy(offline = offline) else it })

/** The chat reducer: every stream event and every local change lands here. */
fun reduceChat(state: ChatSession, action: ChatAction): ChatSession = when (action) {
    is ChatAction.Stream -> reduceStream(state, action.event)
    ChatAction.Opened -> state.copy(dividerId = ChatSession.DIVIDER_UNSET)
    ChatAction.Closed -> state.copy(connected = false, loaded = false)
    ChatAction.StreamOpen -> state.copy(connected = true)
    ChatAction.StreamDrop -> state.copy(connected = false)
    is ChatAction.AddEcho -> state.copy(echoes = state.echoes + action.echo)
    is ChatAction.EchoOffline -> patchEcho(state, action.requestId, true)
    is ChatAction.EchoRetry -> patchEcho(state, action.requestId, false)
    is ChatAction.EchoRefused -> state.copy(echoes = state.echoes.filter { it.requestId != action.requestId })
    ChatAction.OlderLoading -> state.copy(loadingOlder = true)
    is ChatAction.OlderPage ->
        // A new chat or a fresh snapshot meanwhile: this page no longer fits.
        if (oldestEntryId(state.messages) == action.before) {
            val loaded = state.messages.map { it.id }.toSet()
            state.copy(
                messages = action.page.messages.filter { it.id !in loaded } + state.messages,
                hasMore = action.page.hasMore,
                loadingOlder = false,
            )
        } else {
            state.copy(loadingOlder = false)
        }
    ChatAction.OlderFailed -> state.copy(loadingOlder = false)
    is ChatAction.PastChatRead ->
        reduceStream(state, BotStreamEvent.Snapshot(action.view.state)).copy(routineRuns = action.view.runs, past = action.view.chat)
}

private fun reduceStream(state: ChatSession, event: BotStreamEvent): ChatSession = when (event) {
    is BotStreamEvent.Snapshot -> {
        // A fresh snapshot is authoritative; older pages already loaded stay above it.
        val (messages, hasMore) = mergeSnapshot(state, event.state)
        state.copy(
            messages = messages,
            hasMore = hasMore,
            loadingOlder = false,
            busy = event.state.busy,
            queued = event.state.queued,
            echoes = unconfirmed(state.echoes, event.state.messages, event.state.queued),
            connected = true,
            loaded = true,
            dividerId = if (state.dividerId == ChatSession.DIVIDER_UNSET) firstUnreadReply(messages, state.unreadFrom) else state.dividerId,
        )
    }
    is BotStreamEvent.Upsert -> {
        val message = event.message
        state.copy(
            // The confirmed user message replaces its Echo.
            echoes = if (message.role == MessageRole.User) unconfirmed(state.echoes, listOf(message), emptyList()) else state.echoes,
            messages = if (state.messages.any { it.id == message.id }) {
                state.messages.map { if (it.id == message.id) message else it }
            } else {
                state.messages + message
            },
        )
    }
    is BotStreamEvent.Remove -> state.copy(messages = state.messages.filter { it.id != event.id })
    is BotStreamEvent.Delta -> state.copy(
        messages = state.messages.map { m ->
            if (m.id != event.id) {
                m
            } else {
                m.copy(
                    text = m.text + event.text.orEmpty(),
                    reasoning = ((m.reasoning.orEmpty()) + event.reasoning.orEmpty()).ifEmpty { null },
                )
            }
        },
    )
    // The server holds these: their Echoes are superseded by the queued items.
    is BotStreamEvent.Queued -> state.copy(queued = event.items, echoes = unconfirmed(state.echoes, emptyList(), event.items))
    is BotStreamEvent.Busy -> state.copy(busy = event.busy)
    is BotStreamEvent.RoutineRuns -> state.copy(routineRuns = event.runs)
    // Listed and followed at connect, a run can arrive twice: keep one.
    is BotStreamEvent.RoutineRun ->
        if (state.routineRuns.any { it.id == event.run.id }) state else state.copy(routineRuns = state.routineRuns + event.run)
    is BotStreamEvent.Yolo -> state.copy(yolo = event.on)
    BotStreamEvent.Ping -> state
    // The stream gave up on this connection; it reconnects with a fresh snapshot.
    is BotStreamEvent.StreamError -> state.copy(connected = false)
}

// ---- Timeline ---------------------------------------------------------------------------

/** A shared chat's silent reply: the bot decided the message was not for it. */
private const val SKIP_REPLY = "[skip]"

private fun isHiddenReply(message: ChatMessage): Boolean {
    if (message.role != MessageRole.Assistant || message.toolCalls.isNotEmpty()) return false
    val text = message.text.trim()
    if (text == SKIP_REPLY) return true
    // Hidden while it streams in too ("[sk…").
    return message.status == MessageStatus.Streaming && text.isNotEmpty() && SKIP_REPLY.startsWith(text)
}

/** One owner message the transcript does not hold yet. */
data class OutboxEntry(
    val requestId: String,
    val text: String,
    val attachments: List<AttachmentRef>,
    val state: State,
    val createdAt: Long? = null,
    val author: ChatAuthor? = null,
) {
    /** Sending and Offline are Echoes; Steering and Queued are held by the server. */
    enum class State { Sending, Offline, Steering, Queued }
}

sealed interface TimelineItem {
    val key: String

    data class Message(val message: ChatMessage, val index: Int, override val key: String) : TimelineItem

    /** Back-to-back routine runs, oldest first. */
    data class RoutineRuns(val runs: List<RoutineRunCard>, override val key: String) : TimelineItem

    /** An owner send not yet confirmed. */
    data class EchoItem(val echo: OutboxEntry, override val key: String) : TimelineItem
}

private const val DAY_MS = 86_400_000L

private fun sameDay(a: Long, b: Long, zoneOffsetMs: Long): Boolean = (a + zoneOffsetMs) / DAY_MS == (b + zoneOffsetMs) / DAY_MS

/**
 * A finished assistant round that only called tools: the agent loop stores one per tool
 * round, so the timeline folds a run of them into the assistant message that follows.
 */
private fun isToolRound(message: ChatMessage): Boolean =
    message.role == MessageRole.Assistant &&
        message.status == MessageStatus.Done &&
        message.peer == null &&
        message.reasoning.isNullOrEmpty() &&
        message.text.isBlank() &&
        message.toolCalls.isNotEmpty()

/**
 * A quiet turn's message (issue #396: a hand-off's finish or another bot's
 * reply started it) as the owner sees it: what it sent is its text, and its
 * own words fold away with its thinking.
 */
private fun presentQuiet(message: ChatMessage): ChatMessage {
    if (!message.quiet) return message
    val reasoning = listOfNotNull(message.reasoning, message.text.ifBlank { null }).joinToString("\n\n")
    return message.copy(text = message.sent.joinToString("\n\n"), reasoning = reasoning.ifEmpty { null })
}

/** Transcript messages with the routine cards merged in by time; tool-only rounds fold forward. */
fun chatTimeline(messages: List<ChatMessage>, runs: List<RoutineRunCard>, zoneOffsetMs: Long = 0L): List<TimelineItem> {
    val cards = runs.sortedBy { it.finishedAt }
    val items = mutableListOf<TimelineItem>()
    val itemTimes = mutableListOf<Long>()
    fun addRun(card: RoutineRunCard) {
        val last = items.lastOrNull()
        if (last is TimelineItem.RoutineRuns && sameDay(itemTimes.last(), card.finishedAt, zoneOffsetMs)) {
            items[items.lastIndex] = last.copy(runs = last.runs + card)
            itemTimes[itemTimes.lastIndex] = card.finishedAt
        } else {
            items.add(TimelineItem.RoutineRuns(listOf(card), "runs:${card.id}"))
            itemTimes.add(card.finishedAt)
        }
    }
    var next = 0
    messages.forEachIndexed { index, original ->
        val message = presentQuiet(original)
        if (isHiddenReply(message)) return@forEachIndexed
        while (next < cards.size && cards[next].finishedAt < message.createdAt) addRun(cards[next++])
        val last = items.lastOrNull()
        if (last is TimelineItem.Message &&
            isToolRound(last.message) &&
            message.role == MessageRole.Assistant &&
            message.peer == null &&
            sameDay(itemTimes.last(), message.createdAt, zoneOffsetMs)
        ) {
            // Keep the first round's key: the row stays put as rounds land.
            items[items.lastIndex] = TimelineItem.Message(
                message = message.copy(id = last.message.id, toolCalls = last.message.toolCalls + message.toolCalls),
                index = index,
                key = last.key,
            )
            itemTimes[itemTimes.lastIndex] = message.createdAt
            return@forEachIndexed
        }
        items.add(TimelineItem.Message(message, index, "m:${message.id}"))
        itemTimes.add(message.createdAt)
    }
    while (next < cards.size) addRun(cards[next++])
    return items
}

// ---- View -------------------------------------------------------------------------------

enum class ChatHealth { Loading, Live, Reconnecting }

/** The chat, ready to render. */
data class ChatView(
    val messages: List<ChatMessage>,
    /** Messages and routine cards by time, then the Echoes. */
    val timeline: List<TimelineItem>,
    /** Owner messages the server holds behind or steering into the reply. */
    val held: List<OutboxEntry>,
    val busy: Boolean,
    /** Show the typing dots: the bot works with nothing on screen to show it. */
    val typing: Boolean,
    val health: ChatHealth,
    val hasMore: Boolean,
    val loadingOlder: Boolean,
    /** The message key the "New messages" divider goes above, if any. */
    val unreadDividerId: String?,
    val yolo: Boolean,
    val past: PastChat?,
) {
    companion object {
        val Empty = ChatView(emptyList(), emptyList(), emptyList(), false, false, ChatHealth.Loading, false, false, null, false, null)
    }
}

/** The bot is working with nothing on screen to show it: waiting on the first token, or between tool rounds. */
private fun awaitingFirstOutput(messages: List<ChatMessage>): Boolean {
    val last = messages.lastOrNull() ?: return true
    if (last.role != MessageRole.Assistant) return true
    if (last.status == MessageStatus.Streaming) return false
    return last.toolCalls.none(::isActive)
}

/** Derive what the chat screen shows from the session. */
fun chatView(session: ChatSession, zoneOffsetMs: Long = 0L): ChatView {
    val held = session.queued.map { item ->
        OutboxEntry(
            requestId = item.requestId,
            text = item.text,
            attachments = item.attachments,
            state = if (item.mode == "steer") OutboxEntry.State.Steering else OutboxEntry.State.Queued,
            author = item.author,
        )
    }
    val echoed = session.echoes.map { echo ->
        TimelineItem.EchoItem(
            OutboxEntry(
                requestId = echo.requestId,
                text = echo.text,
                attachments = echo.attachments,
                state = if (echo.offline) OutboxEntry.State.Offline else OutboxEntry.State.Sending,
                createdAt = echo.createdAt,
            ),
            key = "echo:${echo.requestId}",
        )
    }
    return ChatView(
        messages = session.messages,
        timeline = chatTimeline(session.messages, session.routineRuns, zoneOffsetMs) + echoed,
        held = held,
        busy = session.busy,
        typing = session.busy && session.echoes.isEmpty() && awaitingFirstOutput(session.messages),
        health = if (!session.loaded) ChatHealth.Loading else if (session.connected) ChatHealth.Live else ChatHealth.Reconnecting,
        hasMore = session.hasMore,
        loadingOlder = session.loadingOlder,
        // A chat never read before has no "new" part to mark off.
        unreadDividerId = session.dividerId?.takeIf { it != ChatSession.DIVIDER_UNSET && session.unreadFrom != null },
        yolo = session.yolo == true,
        past = session.past,
    )
}
