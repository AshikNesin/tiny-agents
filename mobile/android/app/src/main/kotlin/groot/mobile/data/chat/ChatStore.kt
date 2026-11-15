package groot.mobile.data.chat

import groot.mobile.data.Notices
import groot.mobile.data.api.ApiException
import groot.mobile.data.api.AttachmentRef
import groot.mobile.data.api.BotStreamEvent
import groot.mobile.data.api.SseSignal
import groot.mobile.data.api.TinyAgentsApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID

/** What the owner sends: the text, its attachments, and where it goes while a reply runs. */
data class OwnerSubmission(
    val text: String,
    val attachments: List<AttachmentRef> = emptyList(),
    val mentions: List<String> = emptyList(),
    /** "steer" joins the running reply; "followUp" is answered by the next one. */
    val whenBusy: String = "followUp",
)

/**
 * Every open chat: runs each bot's stream into its [ChatSession] through [reduceChat], and
 * the owner's sends through their Echo. A session is keyed by bot id; a past chat by
 * [pastChatKey].
 */
class ChatStore(
    private val api: TinyAgentsApi,
    private val scope: CoroutineScope,
    private val notices: Notices,
    private val now: () -> Long = System::currentTimeMillis,
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    private val _sessions = MutableStateFlow<Map<String, ChatSession>>(emptyMap())
    val sessions: StateFlow<Map<String, ChatSession>> = _sessions.asStateFlow()

    private val streams = HashMap<String, Job>()
    private val pastChats = HashMap<String, Pair<String, String>>()

    private fun dispatch(key: String, action: ChatAction) {
        _sessions.update { sessions ->
            val session = sessions[key] ?: return@update sessions
            val next = reduceChat(session, action)
            if (next === session) sessions else sessions + (key to next)
        }
    }

    /** Show a bot's chat: opens its stream, which starts with a snapshot. */
    fun open(botId: String, unreadFrom: Long?) {
        if (streams.containsKey(botId)) return
        _sessions.update { it + (botId to reduceChat(it[botId] ?: ChatSession(unreadFrom = unreadFrom), ChatAction.Opened)) }
        streams[botId] = scope.launch {
            api.botStream(botId).collect { signal ->
                when (signal) {
                    SseSignal.Open -> dispatch(botId, ChatAction.StreamOpen)
                    SseSignal.Drop -> dispatch(botId, ChatAction.StreamDrop)
                    is SseSignal.Event -> BotStreamEvent.from(signal.json)?.let { dispatch(botId, ChatAction.Stream(it)) }
                }
            }
        }
    }

    /** The chat left the screen: stop its stream; the cache stays for the next visit. */
    fun close(botId: String) {
        streams.remove(botId)?.cancel()
        dispatch(botId, ChatAction.Closed)
    }

    /** Drop every chat; call on sign-out. */
    fun clear() {
        streams.values.forEach { it.cancel() }
        streams.clear()
        pastChats.clear()
        _sessions.value = emptyMap()
    }

    /** Read a past chat once, as a read-only session under [pastChatKey]. */
    fun openPast(botId: String, chatId: String) {
        val key = pastChatKey(botId, chatId)
        pastChats[key] = botId to chatId
        _sessions.update { it + (key to ChatSession()) }
        scope.launch {
            try {
                val view = api.pastChat(botId, chatId)
                dispatch(key, ChatAction.PastChatRead(view))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                notices.showError(e, "Could not open the past chat.")
            }
        }
    }

    fun dropPast(key: String) {
        pastChats.remove(key)
        _sessions.update { it - key }
    }

    /**
     * Send an owner message: its Echo shows at once. Returns true when the server took it,
     * false when it refused (the caller puts the draft back in the composer).
     */
    suspend fun send(botId: String, submission: OwnerSubmission): Boolean {
        val echo = Echo(requestId = newId(), text = submission.text, createdAt = now(), attachments = submission.attachments)
        dispatch(botId, ChatAction.AddEcho(echo))
        var retryMs = FIRST_RETRY_MS
        while (true) {
            try {
                api.sendMessage(
                    botId = botId,
                    requestId = echo.requestId,
                    text = submission.text,
                    attachments = submission.attachments.map { it.uploadId },
                    mentions = submission.mentions,
                    whenBusy = submission.whenBusy,
                )
                return true
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                dispatch(botId, ChatAction.EchoRefused(echo.requestId))
                notices.showError(e, "Could not send the message.")
                return false
            } catch (e: Exception) {
                // No answer: the message waits and goes again with the same id, which the server dedupes.
                dispatch(botId, ChatAction.EchoOffline(echo.requestId))
                delay(retryMs)
                retryMs = (retryMs * 2).coerceAtMost(MAX_RETRY_MS)
                dispatch(botId, ChatAction.EchoRetry(echo.requestId))
            }
        }
    }

    fun stop(botId: String) = act("Could not stop the reply.") { api.abort(botId) }

    /** Withdraw a message the server still holds queued. */
    fun withdraw(botId: String, requestId: String) = act("Could not cancel the message.") { api.withdrawMessage(botId, requestId) }

    fun setYolo(botId: String, on: Boolean) = act("Could not change YOLO mode.") {
        api.setYolo(botId, on)
        dispatch(botId, ChatAction.Stream(BotStreamEvent.Yolo(on)))
    }

    fun decideApproval(botId: String, taskId: Int, approved: Boolean, alwaysAllow: String? = null, grant: Boolean = false) =
        act("Could not send your decision.") { api.decideApproval(botId, taskId, approved, alwaysAllow, grant) }

    /** Load the page of older messages above what is loaded. */
    fun loadOlder(key: String) {
        val session = _sessions.value[key] ?: return
        val before = oldestEntryId(session.messages) ?: return
        if (!session.hasMore || session.loadingOlder) return
        dispatch(key, ChatAction.OlderLoading)
        scope.launch {
            try {
                val past = pastChats[key]
                val page = if (past != null) api.pastChatHistory(past.first, past.second, before) else api.history(key, before)
                dispatch(key, ChatAction.OlderPage(before, page))
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                dispatch(key, ChatAction.OlderFailed)
            }
        }
    }

    private fun act(failure: String, block: suspend () -> Unit): Job = scope.launch {
        try {
            block()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            notices.showError(e, failure)
        }
    }

    companion object {
        private const val FIRST_RETRY_MS = 2_000L
        private const val MAX_RETRY_MS = 15_000L

        fun pastChatKey(botId: String, chatId: String): String = "$botId/history/$chatId"
    }
}
