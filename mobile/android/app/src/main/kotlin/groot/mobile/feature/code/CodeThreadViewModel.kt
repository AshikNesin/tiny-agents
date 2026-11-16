package groot.mobile.feature.code

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import groot.mobile.AppContainer
import groot.mobile.data.api.CodeHarness
import groot.mobile.data.api.CodeModel
import groot.mobile.data.api.CodeThreadEvent
import groot.mobile.data.api.SseSignal
import groot.mobile.data.code.CodeThreadState
import groot.mobile.data.code.reduceCodeThread
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * One Code thread on screen: its live stream, the draft, and everything the owner can do to it
 * (send, steer or queue, stop, answer, recover, change settings, rename, archive, delete). A
 * control is offered only when the thread's harness has the capability.
 */
class CodeThreadViewModel(private val container: AppContainer, val threadId: String) : ViewModel() {
    private val api = container.code

    private val _state = MutableStateFlow(CodeThreadState())
    val state: StateFlow<CodeThreadState> = _state.asStateFlow()

    /** Whether the stream is open now (false while it reconnects). */
    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected.asStateFlow()

    private val _harness = MutableStateFlow<CodeHarness?>(null)
    val harness: StateFlow<CodeHarness?> = _harness.asStateFlow()

    private val _models = MutableStateFlow<List<CodeModel>>(emptyList())
    val models: StateFlow<List<CodeModel>> = _models.asStateFlow()

    private val _draft = MutableStateFlow("")
    val draft: StateFlow<String> = _draft.asStateFlow()

    /** The thread is gone (deleted here): the screen closes. */
    private val _closed = MutableStateFlow(false)
    val closed: StateFlow<Boolean> = _closed.asStateFlow()

    private var stream: Job? = null
    private var seenCursor = -1

    init {
        viewModelScope.launch {
            val instanceId = instanceOf(threadId)
            val harness = runCatching { api.harnesses().firstOrNull { it.id == instanceId } }.getOrNull()
            _harness.value = harness
            if (harness?.capabilities?.modelSwitch == true) {
                _models.value = runCatching { api.models(instanceId) }.getOrDefault(emptyList())
            }
        }
    }

    fun show() {
        if (stream?.isActive == true) return
        stream = viewModelScope.launch {
            api.threadEvents(threadId).collect { signal ->
                when (signal) {
                    SseSignal.Open -> _connected.value = true
                    SseSignal.Drop -> _connected.value = false
                    is SseSignal.Event -> CodeThreadEvent.from(signal.json)?.let { event ->
                        _state.update { reduceCodeThread(it, event) }
                        markSeen()
                    }
                }
            }
        }
    }

    fun hide() {
        stream?.cancel()
        stream = null
        _connected.value = false
    }

    /** Clear the unread mark once a turn ended with the thread on screen. */
    private fun markSeen() {
        val now = _state.value
        if (!now.loaded || now.working || now.cursor <= seenCursor) return
        seenCursor = now.cursor
        viewModelScope.launch { runCatching { api.markSeen(threadId, now.cursor) } }
    }

    fun setDraft(text: String) {
        _draft.value = text
    }

    /** Send the draft. While a turn runs it steers that turn, or with [queue] waits for it to end. */
    fun send(queue: Boolean = false) {
        val text = _draft.value.trim()
        if (text.isEmpty()) return
        _draft.value = ""
        act("Could not send the message.", onFailure = { if (_draft.value.isEmpty()) _draft.value = text }) {
            val status = api.send(threadId, text, queue = queue && _state.value.working)
            if (status == "queued") container.notices.show("Queued for when this turn ends.")
        }
    }

    fun stop() = act("Could not stop the turn.") { api.interrupt(threadId) }

    fun allow(requestId: String, allow: Boolean) = act("Could not answer.") { api.allow(threadId, requestId, allow) }

    fun answer(requestId: String, answers: Map<String, String>) = act("Could not answer.") { api.answer(threadId, requestId, answers) }

    fun recover(action: String) = act("Could not $action.") { api.recover(threadId, action) }

    fun queued(queuedId: String, action: String) = act("Could not change the queued message.") { api.queued(threadId, queuedId, action) }

    fun setModel(model: String) = changeSettings { api.settings(threadId, model = model) }

    /** "default" goes back to the model's own reasoning level. */
    fun setEffort(effort: String) = changeSettings { api.setEffort(threadId, effort.takeIf { it != "default" }) }

    fun setPermissionMode(mode: String) = changeSettings { api.settings(threadId, permissionMode = mode) }

    private fun changeSettings(block: suspend () -> groot.mobile.data.api.ThreadSettings) =
        act("Could not change the setting.") {
            val settings = block()
            _state.update { it.copy(settings = settings) }
        }

    fun rename(title: String) = act("Could not rename the thread.") {
        api.rename(threadId, title)
        _state.update { it.copy(thread = it.thread?.copy(title = title)) }
    }

    fun archive(archived: Boolean, done: () -> Unit = {}) = act("Could not archive the thread.") {
        api.archive(threadId, archived)
        _state.update { it.copy(thread = it.thread?.copy(archived = archived)) }
        container.notices.show(if (archived) "Archived." else "Restored.")
        done()
    }

    fun delete() = act("Could not delete the thread.") {
        api.delete(threadId)
        _closed.value = true
    }

    private fun act(failure: String, onFailure: () -> Unit = {}, block: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                onFailure()
                container.notices.showError(e, failure)
            }
        }
    }

    companion object {
        fun factory(container: AppContainer, threadId: String) = viewModelFactory { initializer { CodeThreadViewModel(container, threadId) } }
    }
}

/** The harness part of a thread id (`shelley:c1` gives `shelley`); a bare id from before ADR 0011 is Shelley's. */
fun instanceOf(threadId: String): String {
    val at = threadId.indexOf(':')
    return if (at <= 0) "shelley" else threadId.substring(0, at)
}
