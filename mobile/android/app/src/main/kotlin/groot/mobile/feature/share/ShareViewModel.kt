package groot.mobile.feature.share

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import groot.mobile.AppContainer
import groot.mobile.data.FileActions
import groot.mobile.data.SharedContent
import groot.mobile.data.api.BotListEntry
import groot.mobile.data.chat.OwnerSubmission
import groot.mobile.data.shareMessage
import groot.mobile.data.sharedText
import groot.mobile.feature.chat.StagedUpload
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.util.UUID

data class ShareDraft(
    val botId: String? = null,
    val query: String = "",
    val note: String = "",
    val sharedText: String? = null,
    val staged: List<StagedUpload> = emptyList(),
    val sending: Boolean = false,
) {
    val message: String get() = shareMessage(note, sharedText)

    val canSend: Boolean
        get() = botId != null && !sending && (message.isNotEmpty() || staged.any { it.error == null })
}

fun filterBots(bots: List<BotListEntry>, query: String): List<BotListEntry> {
    val needle = query.trim()
    return if (needle.isEmpty()) bots else bots.filter { it.name.contains(needle, ignoreCase = true) }
}

sealed interface ShareOutcome {
    data class Sent(val botName: String) : ShareOutcome

    data class Pending(val botName: String) : ShareOutcome
}

class ShareViewModel(private val container: AppContainer) : ViewModel() {
    private val _draft = MutableStateFlow(ShareDraft())
    val draft: StateFlow<ShareDraft> = _draft.asStateFlow()

    private val _outcome = MutableStateFlow<ShareOutcome?>(null)

    val outcome: StateFlow<ShareOutcome?> = _outcome.asStateFlow()

    private var started = false

    fun start(content: SharedContent) {
        if (started) return
        started = true
        _draft.value = ShareDraft(botId = content.botId, sharedText = sharedText(content))
        attach(content.uris)
    }

    fun setQuery(query: String) = _draft.update { it.copy(query = query) }

    fun setNote(note: String) = _draft.update { it.copy(note = note) }

    fun select(botId: String) = _draft.update { it.copy(botId = botId, query = "") }

    fun clearBot() = _draft.update { it.copy(botId = null) }

    fun removeSharedText() = _draft.update { it.copy(sharedText = null) }

    fun attach(uris: List<Uri>) {
        for (uri in uris) {
            if (_draft.value.staged.size >= FileActions.MAX_ATTACHMENTS) {
                container.notices.show("A message can carry up to ${FileActions.MAX_ATTACHMENTS} attachments.")
                return
            }
            val id = UUID.randomUUID().toString()
            viewModelScope.launch {
                val file = container.files.describe(uri)
                _draft.update { it.copy(staged = it.staged + StagedUpload(id, file)) }
                try {
                    val ref = container.files.upload(file)
                    updateStaged(id) { it.copy(ref = ref) }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    updateStaged(id) { it.copy(error = e.message ?: "Upload failed") }
                }
            }
        }
    }

    fun removeStaged(id: String) {
        val removed = _draft.value.staged.firstOrNull { it.id == id } ?: return
        _draft.update { draft -> draft.copy(staged = draft.staged.filter { it.id != id }) }
        removed.ref?.let { ref -> container.scope.launch { runCatching { container.api.deleteUpload(ref.uploadId) } } }
    }

    fun send(bot: BotListEntry) {
        if (!_draft.value.canSend) return
        _draft.update { it.copy(sending = true) }
        viewModelScope.launch {
            val settled = _draft.first { draft -> draft.staged.none { it.uploading } }
            val attachments = settled.staged.mapNotNull { it.ref }
            val text = settled.message
            if (text.isEmpty() && attachments.isEmpty()) {
                container.notices.show("Nothing to send: the files did not upload.")
                _draft.update { it.copy(sending = false) }
                return@launch
            }
            val submission = OwnerSubmission(text = text, attachments = attachments)
            val sending = container.scope.async { container.chats.send(bot.id, submission) }
            when (withTimeoutOrNull(SEND_WAIT_MS) { sending.await() }) {
                false -> _draft.update { it.copy(sending = false) }
                true -> finish(bot, ShareOutcome.Sent(bot.name))
                null -> finish(bot, ShareOutcome.Pending(bot.name))
            }
        }
    }

    private fun finish(bot: BotListEntry, outcome: ShareOutcome) {
        container.session.selectBot(bot.id)
        _outcome.value = outcome
    }

    private fun updateStaged(id: String, change: (StagedUpload) -> StagedUpload) =
        _draft.update { draft -> draft.copy(staged = draft.staged.map { if (it.id == id) change(it) else it }) }

    override fun onCleared() {
        if (_outcome.value != null) return
        for (ref in _draft.value.staged.mapNotNull { it.ref }) {
            container.scope.launch { runCatching { container.api.deleteUpload(ref.uploadId) } }
        }
    }

    private companion object {
        const val SEND_WAIT_MS = 8_000L
    }
}
