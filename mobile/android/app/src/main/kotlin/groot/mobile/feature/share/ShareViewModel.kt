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

/** The share sheet as the owner fills it in: who it goes to, what goes, and a note. */
data class ShareDraft(
    val botId: String? = null,
    /** Typed into the To field: narrows the bot list. */
    val query: String = "",
    val note: String = "",
    /** The text another app shared (a link, a selection); the owner can drop it. */
    val sharedText: String? = null,
    val staged: List<StagedUpload> = emptyList(),
    val sending: Boolean = false,
) {
    /** The message text that goes: the note, then the shared text. */
    val message: String get() = shareMessage(note, sharedText)

    /**
     * A bot is chosen and something would go: text, or a file that uploaded or still uploads
     * (sending waits for it). A failed upload does not count.
     */
    val canSend: Boolean
        get() = botId != null && !sending && (message.isNotEmpty() || staged.any { it.error == null })
}

/** The bots whose name holds [query], in the drawer's order; all of them for a blank query. */
fun filterBots(bots: List<BotListEntry>, query: String): List<BotListEntry> {
    val needle = query.trim()
    return if (needle.isEmpty()) bots else bots.filter { it.name.contains(needle, ignoreCase = true) }
}

/** How a send ended, for the toast the sheet closes with. */
sealed interface ShareOutcome {
    data class Sent(val botName: String) : ShareOutcome

    /** No answer yet (offline): the app keeps trying while it runs. */
    data class Pending(val botName: String) : ShareOutcome
}

/**
 * The share sheet: uploads what was shared as soon as it opens, so sending only waits for
 * what is still on its way, then sends one message to the chosen bot.
 */
class ShareViewModel(private val container: AppContainer) : ViewModel() {
    private val _draft = MutableStateFlow(ShareDraft())
    val draft: StateFlow<ShareDraft> = _draft.asStateFlow()

    private val _outcome = MutableStateFlow<ShareOutcome?>(null)

    /** Set once the share went (or waits to go): the sheet then closes. */
    val outcome: StateFlow<ShareOutcome?> = _outcome.asStateFlow()

    private var started = false

    /** Take what was shared; once, so a configuration change does not upload it twice. */
    fun start(content: SharedContent) {
        if (started) return
        started = true
        _draft.value = ShareDraft(botId = content.botId, sharedText = sharedText(content))
        attach(content.uris)
    }

    fun setQuery(query: String) = _draft.update { it.copy(query = query) }

    fun setNote(note: String) = _draft.update { it.copy(note = note) }

    /** Choose the bot; the search that found it is done. */
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

    /**
     * Wait for the uploads, then send. The send runs on the app's scope: when the server does
     * not answer in a few seconds the sheet closes and the message keeps retrying.
     */
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
                // Refused: ChatStore posted why; the sheet stays open to try again.
                false -> _draft.update { it.copy(sending = false) }
                true -> finish(bot, ShareOutcome.Sent(bot.name))
                null -> finish(bot, ShareOutcome.Pending(bot.name))
            }
        }
    }

    private fun finish(bot: BotListEntry, outcome: ShareOutcome) {
        // Opening the app next shows the chat the share went to.
        container.session.selectBot(bot.id)
        _outcome.value = outcome
    }

    private fun updateStaged(id: String, change: (StagedUpload) -> StagedUpload) =
        _draft.update { draft -> draft.copy(staged = draft.staged.map { if (it.id == id) change(it) else it }) }

    /** Closed without sending: what uploaded is deleted on the server too. */
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
