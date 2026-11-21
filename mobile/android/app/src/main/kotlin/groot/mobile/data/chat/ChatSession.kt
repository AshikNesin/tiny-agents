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

data class Echo(
    val requestId: String,
    val text: String,
    val createdAt: Long,
    val attachments: List<AttachmentRef> = emptyList(),
    val offline: Boolean = false,
)

data class ChatSession(
    val messages: List<ChatMessage> = emptyList(),
    val hasMore: Boolean = false,
    val loadingOlder: Boolean = false,
    val busy: Boolean = false,
    val queued: List<QueuedMessage> = emptyList(),
    val routineRuns: List<RoutineRunCard> = emptyList(),
    val yolo: Boolean? = null,
    val echoes: List<Echo> = emptyList(),
    val connected: Boolean = false,
    val loaded: Boolean = false,
    val unreadFrom: Long? = null,
    val dividerId: String? = DIVIDER_UNSET,
    val past: PastChat? = null,
) {
    companion object {
        const val DIVIDER_UNSET = "\u0000unset"
    }
}

sealed interface ChatAction {
    data class Stream(val event: BotStreamEvent) : ChatAction

    data object Opened : ChatAction

    data object Closed : ChatAction
    data object StreamOpen : ChatAction
    data object StreamDrop : ChatAction
    data class AddEcho(val echo: Echo) : ChatAction
    data class EchoOffline(val requestId: String) : ChatAction
    data class EchoRetry(val requestId: String) : ChatAction

    data class EchoRefused(val requestId: String) : ChatAction
    data object OlderLoading : ChatAction
    data class OlderPage(val before: String, val page: ChatPage) : ChatAction
    data object OlderFailed : ChatAction
    data class PastChatRead(val view: PastChatView) : ChatAction
}

private val ENTRY_ID = Regex("^e(\\d+)$")

private fun order(id: String): Long = ENTRY_ID.find(id)?.groupValues?.get(1)?.toLongOrNull() ?: Long.MAX_VALUE

fun oldestEntryId(messages: List<ChatMessage>): String? = messages.firstOrNull { ENTRY_ID.matches(it.id) }?.id

internal fun mergeSnapshot(previous: ChatSession, snapshot: ChatState): Pair<List<ChatMessage>, Boolean> {
    val first = snapshot.messages.firstOrNull()
    if (!snapshot.hasMore || first == null) return snapshot.messages to snapshot.hasMore
    val older = previous.messages.filter { order(it.id) < order(first.id) }
    if (older.isEmpty()) return snapshot.messages to true
    return (older + snapshot.messages) to previous.hasMore
}

private fun attachmentIds(attachments: List<AttachmentRef>): String = attachments.map { it.uploadId }.sorted().joinToString(",")

private const val LEGACY_ECHO_SKEW_MS = 5_000L

private fun echoMatches(echo: Echo, message: ChatMessage): Boolean {
    if (message.requestId != null) return message.requestId == echo.requestId
    return message.createdAt >= echo.createdAt - LEGACY_ECHO_SKEW_MS &&
        echo.text.trim() == message.text.trim() &&
        attachmentIds(echo.attachments) == attachmentIds(message.attachments)
}

private fun unconfirmed(echoes: List<Echo>, messages: List<ChatMessage>, queued: List<QueuedMessage>): List<Echo> =
    echoes.filter { echo ->
        messages.none { it.role == MessageRole.User && echoMatches(echo, it) } && queued.none { it.requestId == echo.requestId }
    }

private fun firstUnreadReply(messages: List<ChatMessage>, unreadFrom: Long?): String? =
    messages.firstOrNull { it.role == MessageRole.Assistant && it.createdAt > (unreadFrom ?: 0L) }?.id

private fun patchEcho(state: ChatSession, requestId: String, offline: Boolean): ChatSession =
    state.copy(echoes = state.echoes.map { if (it.requestId == requestId) it.copy(offline = offline) else it })

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
    is BotStreamEvent.Queued -> state.copy(queued = event.items, echoes = unconfirmed(state.echoes, emptyList(), event.items))
    is BotStreamEvent.Busy -> state.copy(busy = event.busy)
    is BotStreamEvent.RoutineRuns -> state.copy(routineRuns = event.runs)
    is BotStreamEvent.RoutineRun ->
        if (state.routineRuns.any { it.id == event.run.id }) state else state.copy(routineRuns = state.routineRuns + event.run)
    is BotStreamEvent.Yolo -> state.copy(yolo = event.on)
    BotStreamEvent.Ping -> state
    is BotStreamEvent.StreamError -> state.copy(connected = false)
}

private const val SKIP_REPLY = "[skip]"

private fun isHiddenReply(message: ChatMessage): Boolean {
    if (message.role != MessageRole.Assistant || message.toolCalls.isNotEmpty()) return false
    val text = message.text.trim()
    if (text == SKIP_REPLY) return true
    return message.status == MessageStatus.Streaming && text.isNotEmpty() && SKIP_REPLY.startsWith(text)
}

data class OutboxEntry(
    val requestId: String,
    val text: String,
    val attachments: List<AttachmentRef>,
    val state: State,
    val createdAt: Long? = null,
    val author: ChatAuthor? = null,
) {
    enum class State { Sending, Offline, Steering, Queued }
}

sealed interface TimelineItem {
    val key: String

    data class Message(val message: ChatMessage, val index: Int, override val key: String) : TimelineItem

    data class RoutineRuns(val runs: List<RoutineRunCard>, override val key: String) : TimelineItem

    data class EchoItem(val echo: OutboxEntry, override val key: String) : TimelineItem
}

private const val DAY_MS = 86_400_000L

private fun sameDay(a: Long, b: Long, zoneOffsetMs: Long): Boolean = (a + zoneOffsetMs) / DAY_MS == (b + zoneOffsetMs) / DAY_MS

private fun isToolRound(message: ChatMessage): Boolean =
    message.role == MessageRole.Assistant &&
        message.status == MessageStatus.Done &&
        message.peer == null &&
        message.reasoning.isNullOrEmpty() &&
        message.text.isBlank() &&
        message.toolCalls.isNotEmpty()

private fun presentQuiet(message: ChatMessage): ChatMessage {
    if (!message.quiet) return message
    val reasoning = listOfNotNull(message.reasoning, message.text.ifBlank { null }).joinToString("\n\n")
    return message.copy(text = message.sent.joinToString("\n\n"), reasoning = reasoning.ifEmpty { null })
}

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
        if (isHiddenReply(original)) return@forEachIndexed
        val message = presentQuiet(original)
        while (next < cards.size && cards[next].finishedAt < message.createdAt) addRun(cards[next++])
        val last = items.lastOrNull()
        if (last is TimelineItem.Message &&
            isToolRound(last.message) &&
            message.role == MessageRole.Assistant &&
            message.peer == null &&
            sameDay(itemTimes.last(), message.createdAt, zoneOffsetMs)
        ) {
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

enum class ChatHealth { Loading, Live, Reconnecting }

data class ChatView(
    val messages: List<ChatMessage>,
    val timeline: List<TimelineItem>,
    val held: List<OutboxEntry>,
    val busy: Boolean,
    val typing: Boolean,
    val health: ChatHealth,
    val hasMore: Boolean,
    val loadingOlder: Boolean,
    val unreadDividerId: String?,
    val yolo: Boolean,
    val past: PastChat?,
) {
    companion object {
        val Empty = ChatView(emptyList(), emptyList(), emptyList(), false, false, ChatHealth.Loading, false, false, null, false, null)
    }
}

private fun awaitingFirstOutput(messages: List<ChatMessage>): Boolean {
    val last = messages.lastOrNull() ?: return true
    if (last.role != MessageRole.Assistant) return true
    if (last.status == MessageStatus.Streaming) return false
    return last.toolCalls.none(::isActive)
}

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
        unreadDividerId = session.dividerId?.takeIf { it != ChatSession.DIVIDER_UNSET && session.unreadFrom != null },
        yolo = session.yolo == true,
        past = session.past,
    )
}
