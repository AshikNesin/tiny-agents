package groot.mobile.feature.chat

import groot.mobile.data.chat.MentionCandidate
import groot.mobile.data.chat.MentionInsert
import groot.mobile.data.chat.MentionToken
import groot.mobile.data.chat.PickedMention
import groot.mobile.data.chat.insertMention as insertMentionInto
import groot.mobile.data.chat.resolveMentions
import groot.mobile.data.chat.trackPickedMentions
import groot.mobile.data.api.Skill
import groot.mobile.data.chat.botSkills
import android.net.Uri
import groot.kit.log.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import groot.mobile.AppContainer
import groot.mobile.data.FileActions
import groot.mobile.data.PickedFile
import groot.mobile.data.ViewerRole
import groot.mobile.data.api.AttachmentRef
import groot.mobile.data.api.OwnerAnswer
import groot.mobile.data.chat.ChatHealth
import groot.mobile.data.chat.ChatView
import groot.mobile.data.chat.OwnerSubmission
import groot.mobile.data.chat.chatView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.TimeZone
import java.util.UUID

internal enum class NewChatCommand { Send, Wait, Clear, Reset }

internal fun newChatCommand(text: String, attachments: Int, role: ViewerRole?, health: ChatHealth, empty: Boolean): NewChatCommand = when {
    attachments > 0 || text.trim() != "/new" || role == ViewerRole.Guest -> NewChatCommand.Send
    role == null || health == ChatHealth.Loading -> NewChatCommand.Wait
    empty -> NewChatCommand.Clear
    else -> NewChatCommand.Reset
}

data class StagedUpload(val id: String, val file: PickedFile, val ref: AttachmentRef? = null, val error: String? = null) {
    val uploading: Boolean get() = ref == null && error == null
}

class ChatViewModel(private val container: AppContainer, val botId: String) : ViewModel() {
    private val zoneOffsetMs = TimeZone.getDefault().rawOffset.toLong()

    val view: StateFlow<ChatView> = container.chats.sessions
        .map { it[botId] }
        .distinctUntilChanged()
        .map { session -> if (session == null) ChatView.Empty else chatView(session, zoneOffsetMs) }
        .flowOn(Dispatchers.Default)
        .stateIn(viewModelScope, SharingStarted.Eagerly, ChatView.Empty)

    private val _draft = MutableStateFlow("")
    val draft: StateFlow<String> = _draft.asStateFlow()

    private val _staged = MutableStateFlow<List<StagedUpload>>(emptyList())
    val staged: StateFlow<List<StagedUpload>> = _staged.asStateFlow()

    private var picked: List<PickedMention> = emptyList()

    private val _fillingCredentials = MutableStateFlow(false)
    val fillingCredentials: StateFlow<Boolean> = _fillingCredentials.asStateFlow()

    private val _skills = MutableStateFlow<List<Skill>>(emptyList())
    val skills: StateFlow<List<Skill>> = _skills.asStateFlow()

    fun loadSkills() {
        if (container.bots.state.value.role != ViewerRole.Owner || _skills.value.isNotEmpty()) return
        viewModelScope.launch {
            try {
                _skills.value = botSkills(container.api.skills(), container.api.bot(botId).skillIds, "")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                skipSlashSkills(e)
            }
        }
    }

    private fun skipSlashSkills(e: Exception) {
        Log.w("ChatViewModel", e) { "Slash skills not loaded" }
    }

    val mentionCandidates: List<MentionCandidate>
        get() = container.bots.state.value.bots.filter { it.id != botId }.map { MentionCandidate(it.id, it.name) }

    fun setDraft(text: String) {
        picked = trackPickedMentions(_draft.value, text, picked)
        _draft.value = text
    }

    fun insertMention(token: MentionToken, caret: Int, chosen: MentionCandidate): MentionInsert {
        val result = insertMentionInto(_draft.value, token, caret, chosen, picked)
        picked = result.picked
        _draft.value = result.text
        return result
    }

    fun show() {
        container.chats.open(botId, container.bots.state.value.bot(botId)?.lastReadAt)
        container.bots.markRead(botId)
    }

    fun hide() {
        container.chats.close(botId)
        container.bots.markRead(botId)
    }

    fun attach(uris: List<Uri>) {
        for (uri in uris) {
            if (_staged.value.size >= FileActions.MAX_ATTACHMENTS) {
                container.notices.show("A message can carry up to ${FileActions.MAX_ATTACHMENTS} attachments.")
                return
            }
            val id = UUID.randomUUID().toString()
            viewModelScope.launch {
                val file = container.files.describe(uri)
                _staged.update { it + StagedUpload(id, file) }
                try {
                    val ref = container.files.upload(file)
                    _staged.update { list -> list.map { if (it.id == id) it.copy(ref = ref) else it } }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    _staged.update { list -> list.map { if (it.id == id) it.copy(error = e.message ?: "Upload failed") else it } }
                }
            }
        }
    }

    fun removeStaged(id: String) {
        val removed = _staged.value.firstOrNull { it.id == id } ?: return
        _staged.update { list -> list.filter { it.id != id } }
        removed.ref?.let { ref -> viewModelScope.launch { runCatching { container.api.deleteUpload(ref.uploadId) } } }
    }

    fun send(whenBusy: String) {
        val text = _draft.value.trim()
        val staged = _staged.value
        if (staged.any { it.uploading }) {
            container.notices.show("Wait for the uploads to finish.")
            return
        }
        val attachments = staged.mapNotNull { it.ref }
        if (text.isEmpty() && attachments.isEmpty()) return
        val bots = container.bots.state.value
        val current = view.value
        val command = newChatCommand(
            text,
            staged.size,
            role = bots.role,
            health = current.health,
            empty = current.timeline.isEmpty() && current.held.isEmpty(),
        )
        when (command) {
            NewChatCommand.Send -> Unit
            NewChatCommand.Wait -> return
            NewChatCommand.Clear -> {
                _draft.value = ""
                return
            }
            NewChatCommand.Reset -> {
                _draft.value = ""
                newChat()
                return
            }
        }
        val mentions = resolveMentions(_draft.value, mentionCandidates, botId, picked)
        if (mentions.ambiguous.isNotEmpty()) {
            container.notices.show(ambiguousMentionHint(mentions.ambiguous))
            return
        }
        _draft.value = ""
        picked = emptyList()
        _staged.value = emptyList()
        container.scope.launch {
            val sent = container.chats.send(
                botId,
                OwnerSubmission(text = text, attachments = attachments, mentions = mentions.ids, whenBusy = whenBusy),
            )
            if (!sent) {
                if (_draft.value.isEmpty()) _draft.value = text
                if (_staged.value.isEmpty()) _staged.value = staged
            }
        }
    }

    fun stop() {
        container.chats.stop(botId)
    }

    fun withdraw(requestId: String) {
        container.chats.withdraw(botId, requestId)
    }

    fun decide(taskId: Int, approved: Boolean, alwaysAllow: String? = null, grant: Boolean = false, everyBot: Boolean = false) {
        container.chats.decideApproval(botId, taskId, approved, alwaysAllow, grant, everyBot)
    }

    fun answer(taskId: Int, answers: List<OwnerAnswer>?) = act("Could not send your answers.") {
        container.api.answerQuestions(botId, taskId, answers)
    }

    fun loadOlder() = container.chats.loadOlder(botId)

    fun setYolo(on: Boolean) {
        container.chats.setYolo(botId, on)
    }

    fun newChat() = act("Could not start a new chat.") {
        container.api.resetChat(botId)
        container.bots.refresh()
    }

    fun submitCredentials(taskId: Int, values: Map<String, String>, save: Boolean, stepUp: String?, done: () -> Unit) {
        if (!_fillingCredentials.compareAndSet(false, true)) return
        act("Could not fill the sign-in.") {
            try {
                container.api.submitCredentials(taskId, values, save, stepUp)
                done()
            } finally {
                _fillingCredentials.value = false
            }
        }
    }

    fun cancelCredentials(taskId: Int) = act("Could not cancel the request.") { container.api.cancelCredentialRequest(taskId) }

    fun save(ref: AttachmentRef, opened: (Uri) -> Unit) = act("Could not save the file.") {
        val uri = container.files.saveToDownloads(ref)
        container.notices.show("Saved ${ref.name} to Downloads")
        opened(uri)
    }

    private fun act(failure: String, block: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                container.notices.showError(e, failure)
            }
        }
    }
}

internal fun ambiguousMentionHint(names: List<String>): String =
    "More than one bot is named ${names.joinToString(", ") { "\"$it\"" }}. Type @ and pick the one you mean from the list."
