package groot.mobile.data

import groot.mobile.data.api.BotListEntry
import groot.mobile.data.api.Capability
import groot.mobile.data.api.FeedEvent
import groot.mobile.data.api.ModelsResponse
import groot.mobile.data.api.SseSignal
import groot.mobile.data.api.TinyAgentsApi
import groot.mobile.data.chat.ToolLabels
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** What the drawer and the pickers read: the bot list, the models and the tool catalog. */
data class BotsState(
    val bots: List<BotListEntry> = emptyList(),
    /** True until the first list arrived (or failed). */
    val loading: Boolean = true,
    val error: String? = null,
    val models: ModelsResponse = ModelsResponse.Empty,
    val capabilities: List<Capability> = emptyList(),
    val labels: ToolLabels = ToolLabels(),
    /** The signed-in account is a guest: only the bots shared with them, no management. */
    val guest: Boolean = false,
    /** Live MCP connection status by id, from the events feed. */
    val connectionStatus: Map<String, String> = emptyMap(),
) {
    /** Pinned first (newest pin first), then by last activity. */
    val sorted: List<BotListEntry>
        get() = bots.sortedWith(
            compareByDescending<BotListEntry> { it.pinnedAt != null }
                .thenByDescending { it.pinnedAt ?: 0L }
                .thenByDescending { it.lastActivityAt },
        )

    fun bot(id: String?): BotListEntry? = bots.firstOrNull { it.id == id }

    fun modelName(modelId: String?): String =
        models.models.firstOrNull { it.id == (modelId ?: models.defaultModelId) }?.name ?: "Default model"
}

/**
 * The bot list, kept live by the app-wide events feed: which bots are replying and which
 * wait on the owner arrive as events; previews and unread marks are refetched when a reply
 * settles.
 */
class BotsStore(
    private val api: TinyAgentsApi,
    private val scope: CoroutineScope,
    private val notices: Notices,
) {
    private val _state = MutableStateFlow(BotsState())
    val state: StateFlow<BotsState> = _state.asStateFlow()

    private var feed: Job? = null
    private var pendingRefresh: Job? = null

    /** Load everything and follow the feed; call when a session starts. */
    fun start() {
        if (feed != null) return
        feed = scope.launch {
            launch { loadStatic() }
            launch { refresh() }
            api.eventsFeed().collect { signal ->
                when (signal) {
                    // Whatever changed while the feed was down is in a fresh list.
                    SseSignal.Open -> refreshSoon(0)
                    is SseSignal.Event -> FeedEvent.from(signal.json)?.let(::onFeed)
                    SseSignal.Drop -> Unit
                }
            }
        }
    }

    /** Stop following and forget everything; call on sign-out. */
    fun stop() {
        feed?.cancel()
        feed = null
        pendingRefresh?.cancel()
        _state.value = BotsState()
    }

    private suspend fun loadStatic() {
        runQuietly { _state.update { it.copy(guest = api.isGuest()) } }
        runQuietly { val models = api.models(); _state.update { it.copy(models = models) } }
        runQuietly {
            val capabilities = api.capabilities()
            _state.update { it.copy(capabilities = capabilities, labels = ToolLabels.of(capabilities)) }
        }
    }

    suspend fun refresh() {
        try {
            val bots = api.bots()
            _state.update { it.copy(bots = bots, loading = false, error = null) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _state.update { it.copy(loading = false, error = e.message ?: "Could not load your bots.") }
        }
    }

    private fun refreshSoon(delayMs: Long = 400) {
        pendingRefresh?.cancel()
        pendingRefresh = scope.launch {
            delay(delayMs)
            refresh()
        }
    }

    private fun onFeed(event: FeedEvent) {
        when (event) {
            is FeedEvent.BusySnapshot ->
                _state.update { state -> state.copy(bots = state.bots.map { it.copy(replying = it.conversationId in event.busy) }) }
            is FeedEvent.Activity -> {
                _state.update { state ->
                    state.copy(
                        bots = state.bots.map {
                            if (it.conversationId == event.conversation) {
                                it.copy(replying = event.busy, approvals = event.approvals, questions = event.questions)
                            } else {
                                it
                            }
                        },
                    )
                }
                // A settled reply changes the preview and the unread mark; a new chat changes the conversation.
                refreshSoon()
            }
            is FeedEvent.Connection -> _state.update { it.copy(connectionStatus = it.connectionStatus + (event.id to event.status)) }
            FeedEvent.ModelsChanged -> scope.launch { runQuietly { val models = api.models(); _state.update { it.copy(models = models) } } }
        }
    }

    /** The chat is on screen: clear its unread mark here and on the server. */
    fun markRead(botId: String) {
        _state.update { state -> state.copy(bots = state.bots.map { if (it.id == botId) it.copy(unread = false) else it }) }
        scope.launch { runQuietly { api.markRead(botId) } }
    }

    fun togglePin(botId: String) {
        val pinned = _state.value.bot(botId)?.pinnedAt == null
        scope.launch {
            try {
                api.pinBot(botId, pinned)
                refresh()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                notices.showError(e, "Could not pin the bot.")
            }
        }
    }

    private suspend fun runQuietly(block: suspend () -> Unit) {
        try {
            block()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Best effort: the next refresh or feed event tries again.
        }
    }
}
