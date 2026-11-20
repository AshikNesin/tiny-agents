package groot.mobile.data.api

import org.json.JSONObject

/*
 * The chat's wire types, as the server's `@tiny-agents/agent` package and
 * `apps/web/src/shared/bot-stream.ts` declare them. Field names match the wire.
 */

enum class MessageRole { User, Assistant, Marker }

enum class MessageStatus { Done, Streaming, Stopped, Error, Unanswered }

enum class ToolStatus(val wire: String) {
    Pending("pending"),
    Running("running"),
    AwaitingApproval("awaiting_approval"),
    AwaitingAnswer("awaiting_answer"),
    Done("done"),
    Error("error"),
    AwaitingCredentials("awaiting_credentials"),
    AwaitingTakeover("awaiting_takeover"),
    Denied("denied"),
    Expired("expired"),
    Interrupted("interrupted"),
    Aborted("aborted"),
    ;

    companion object {
        fun of(wire: String?): ToolStatus = entries.firstOrNull { it.wire == wire } ?: Done
    }
}

/** An image or file attached to a user message. */
data class AttachmentRef(
    val uploadId: String,
    /** "image" or "file". */
    val kind: String,
    val name: String,
    val mimeType: String,
    val size: Long,
    val width: Int? = null,
    val height: Int? = null,
    /** Files only: extraction state ("none", "pending", "ready", "failed", "unsupported"). */
    val status: String? = null,
) {
    val isImage: Boolean get() = kind == "image"

    fun toJson(): JSONObject = jsonOfNotNull(
        "uploadId" to uploadId, "kind" to kind, "name" to name, "mimeType" to mimeType,
        "size" to size, "width" to width, "height" to height, "status" to status,
    )

    companion object {
        fun from(json: JSONObject) = AttachmentRef(
            uploadId = json.string("uploadId"),
            kind = json.string("kind", "file"),
            name = json.string("name"),
            mimeType = json.string("mimeType", "application/octet-stream"),
            size = json.long("size"),
            width = json.intOrNull("width"),
            height = json.intOrNull("height"),
            status = json.stringOrNull("status"),
        )
    }
}

data class ChatAuthor(val id: Int, val name: String)

/** Trusted attribution of a cross-bot delivery. */
data class ChatPeer(val kind: String, val name: String)

/** A vault use as its approval card shows it: the item and target, never a value. */
data class VaultUse(
    val handle: String,
    val label: String,
    val kind: String,
    val tool: String,
    val target: String,
    val cardBrand: String?,
    val cardLast4: String?,
    val username: String?,
    val grantable: Boolean,
    val env: List<String>,
    val hosts: List<String>,
)

data class CredentialField(val key: String, val label: String, val type: String, val required: Boolean)

/** A `request_credentials` call as the chat shows it: metadata only. */
data class CredentialRequest(
    val status: String,
    val origin: String,
    val title: String,
    val purpose: String,
    val fields: List<CredentialField>,
    val filled: List<String>,
    val savedHandle: String?,
)

data class Takeover(val status: String, val reason: String)

data class Source(val url: String, val title: String)

data class CodeThread(val threadId: String, val harness: String, val title: String?, val cwd: String?, val url: String)

data class QuestionOption(val label: String, val description: String?)

/** One question a bot asks the owner (`ask_owner`). */
data class OwnerQuestion(
    val question: String,
    val description: String?,
    val options: List<QuestionOption>,
    val multiple: Boolean,
)

/** The owner's answer to one question; both empty means skipped. */
data class OwnerAnswer(val selected: List<String>, val text: String? = null) {
    fun toJson(): JSONObject = jsonOfNotNull("selected" to selected, "text" to text?.takeIf { it.isNotBlank() })
}

/** One tool call of an assistant turn, with its live status or result. */
data class ToolCall(
    val id: String,
    val name: String,
    val args: Map<String, Any?>,
    val status: ToolStatus,
    val output: String? = null,
    val durationMs: Long? = null,
    val waitedMs: Long? = null,
    /** Durable tool task id: what approval decisions address. */
    val taskId: Int? = null,
    /** "approved", "denied", "auto", "yolo" or "refused". */
    val approval: String? = null,
    val expiresAt: Long? = null,
    val vault: VaultUse? = null,
    val credentials: CredentialRequest? = null,
    val takeover: Takeover? = null,
    val sources: List<Source> = emptyList(),
    val code: CodeThread? = null,
    val questions: List<OwnerQuestion>? = null,
    val answers: List<OwnerAnswer>? = null,
) {
    companion object {
        fun from(json: JSONObject) = ToolCall(
            id = json.string("id"),
            name = json.string("name"),
            args = json.objOrNull("args")?.toPlainMap() ?: emptyMap(),
            status = ToolStatus.of(json.stringOrNull("status")),
            output = json.stringOrNull("output"),
            durationMs = json.longOrNull("durationMs"),
            waitedMs = json.longOrNull("waitedMs"),
            taskId = json.intOrNull("taskId"),
            approval = json.stringOrNull("approval"),
            expiresAt = json.longOrNull("expiresAt"),
            vault = json.objOrNull("vault")?.let { v ->
                val card = v.objOrNull("card")
                VaultUse(
                    handle = v.string("handle"),
                    label = v.string("label"),
                    kind = v.string("kind"),
                    tool = v.string("tool"),
                    target = v.string("target"),
                    cardBrand = card?.stringOrNull("brand"),
                    cardLast4 = card?.stringOrNull("last4"),
                    username = v.stringOrNull("username"),
                    grantable = v.bool("grantable"),
                    env = v.arr("env").strings(),
                    hosts = v.arr("hosts").strings(),
                )
            },
            credentials = json.objOrNull("credentials")?.let { c ->
                CredentialRequest(
                    status = c.string("status"),
                    origin = c.string("origin"),
                    title = c.string("title"),
                    purpose = c.string("purpose"),
                    fields = c.arr("fields").mapObjects { f ->
                        CredentialField(f.string("key"), f.string("label"), f.string("type", "text"), f.bool("required"))
                    },
                    filled = c.arr("filled").strings(),
                    savedHandle = c.stringOrNull("savedHandle"),
                )
            },
            takeover = json.objOrNull("takeover")?.let { Takeover(it.string("status"), it.string("reason")) },
            sources = json.arr("sources").mapObjects { Source(it.string("url"), it.string("title")) },
            code = json.objOrNull("code")?.let {
                CodeThread(it.string("threadId"), it.string("harness"), it.stringOrNull("title"), it.stringOrNull("cwd"), it.string("url"))
            },
            questions = if (json.has("questions") && !json.isNull("questions")) {
                json.arr("questions").mapObjects { q ->
                    OwnerQuestion(
                        question = q.string("question"),
                        description = q.stringOrNull("description"),
                        options = q.arr("options").mapObjects { o -> QuestionOption(o.string("label"), o.stringOrNull("description")) },
                        multiple = q.bool("multiple"),
                    )
                }
            } else {
                null
            },
            answers = if (json.has("answers") && !json.isNull("answers")) {
                json.arr("answers").mapObjects { a -> OwnerAnswer(a.arr("selected").strings(), a.stringOrNull("text")) }
            } else {
                null
            },
        )
    }
}

data class ChatMessage(
    /** `e<entryId>` for committed entries, `live` for the reply in flight. */
    val id: String,
    val role: MessageRole,
    val text: String,
    val attachments: List<AttachmentRef> = emptyList(),
    val requestId: String? = null,
    val peer: ChatPeer? = null,
    val author: ChatAuthor? = null,
    val toolCalls: List<ToolCall> = emptyList(),
    val reasoning: String? = null,
    val status: MessageStatus = MessageStatus.Done,
    val error: String? = null,
    val model: String? = null,
    /** Milliseconds since epoch. */
    val createdAt: Long = 0L,
    /** For markers: what happened ("compaction"). */
    val marker: String? = null,
    /** A turn the owner didn't start (issue #396): the text is the bot's own working. */
    val quiet: Boolean = false,
    /** What this message's `message_owner` calls sent the owner, in order. */
    val sent: List<String> = emptyList(),
) {
    companion object {
        fun from(json: JSONObject) = ChatMessage(
            id = json.string("id"),
            role = when (json.string("role")) {
                "user" -> MessageRole.User
                "marker" -> MessageRole.Marker
                else -> MessageRole.Assistant
            },
            text = json.string("text"),
            attachments = json.arr("attachments").mapObjects(AttachmentRef::from),
            requestId = json.stringOrNull("requestId"),
            peer = json.objOrNull("peer")?.let { ChatPeer(it.string("kind"), it.stringOrNull("name") ?: it.string("hostName")) },
            author = json.objOrNull("author")?.let { ChatAuthor(it.int("id"), it.string("name")) },
            toolCalls = json.arr("toolCalls").mapObjects(ToolCall::from),
            reasoning = json.stringOrNull("reasoning")?.takeIf { it.isNotEmpty() },
            status = when (json.string("status")) {
                "streaming" -> MessageStatus.Streaming
                "stopped" -> MessageStatus.Stopped
                "error" -> MessageStatus.Error
                "unanswered" -> MessageStatus.Unanswered
                else -> MessageStatus.Done
            },
            error = json.stringOrNull("error"),
            model = json.stringOrNull("model"),
            createdAt = json.long("createdAt"),
            marker = json.stringOrNull("marker"),
            quiet = json.bool("quiet"),
            sent = json.arr("sent").strings(),
        )
    }
}

/** An owner input the server holds while the conversation is busy. */
data class QueuedMessage(
    val requestId: String,
    /** "steer" joins the running reply; "followUp" starts the next one. */
    val mode: String,
    val text: String,
    val attachments: List<AttachmentRef> = emptyList(),
    val author: ChatAuthor? = null,
) {
    companion object {
        fun from(json: JSONObject) = QueuedMessage(
            requestId = json.string("requestId"),
            mode = json.string("mode", "followUp"),
            text = json.string("text"),
            attachments = json.arr("attachments").mapObjects(AttachmentRef::from),
            author = json.objOrNull("author")?.let { ChatAuthor(it.int("id"), it.string("name")) },
        )
    }
}

/** A chat stream's snapshot: the newest messages, and whether older ones exist. */
data class ChatState(
    val messages: List<ChatMessage>,
    val busy: Boolean,
    val queued: List<QueuedMessage>,
    val hasMore: Boolean,
) {
    companion object {
        fun from(json: JSONObject) = ChatState(
            messages = json.arr("messages").mapObjects(ChatMessage::from),
            busy = json.bool("busy"),
            queued = json.arr("queued").mapObjects(QueuedMessage::from),
            hasMore = json.bool("hasMore"),
        )
    }
}

/** A page of older messages, oldest first. */
data class ChatPage(val messages: List<ChatMessage>, val hasMore: Boolean) {
    companion object {
        fun from(json: JSONObject) = ChatPage(json.arr("messages").mapObjects(ChatMessage::from), json.bool("hasMore"))
    }
}

/** A finished routine run, shown as a quiet line in its bot's chat. */
data class RoutineRunCard(
    val id: String,
    val routineId: String,
    val routineName: String,
    /** "succeeded", "blocked", "failed", "missed" or "cancelled". */
    val status: String,
    val trigger: String,
    val scheduledFor: Long,
    val finishedAt: Long,
    val output: String?,
    val error: String?,
) {
    companion object {
        fun from(json: JSONObject) = RoutineRunCard(
            id = json.string("id"),
            routineId = json.string("routineId"),
            routineName = json.string("routineName"),
            status = json.string("status"),
            trigger = json.string("trigger"),
            scheduledFor = json.instant("scheduledFor"),
            finishedAt = json.instant("finishedAt"),
            output = json.stringOrNull("output"),
            error = json.stringOrNull("error"),
        )
    }
}

/** Every event of one bot's chat stream (`GET /bots/:id/stream`). */
sealed interface BotStreamEvent {
    data class Snapshot(val state: ChatState) : BotStreamEvent
    data class Upsert(val message: ChatMessage) : BotStreamEvent
    data class Remove(val id: String) : BotStreamEvent
    data class Delta(val id: String, val text: String?, val reasoning: String?) : BotStreamEvent
    data class Queued(val items: List<QueuedMessage>) : BotStreamEvent
    data class Busy(val busy: Boolean) : BotStreamEvent
    data class RoutineRuns(val runs: List<RoutineRunCard>) : BotStreamEvent
    data class RoutineRun(val run: RoutineRunCard) : BotStreamEvent
    data class Yolo(val on: Boolean) : BotStreamEvent
    data object Ping : BotStreamEvent
    data class StreamError(val message: String) : BotStreamEvent

    companion object {
        /** Null for an event type this build does not know: ignored, never fatal. */
        fun from(json: JSONObject): BotStreamEvent? = when (json.string("type")) {
            "snapshot" -> Snapshot(ChatState.from(json.objOrNull("state") ?: JSONObject()))
            "upsert" -> json.objOrNull("message")?.let { Upsert(ChatMessage.from(it)) }
            "remove" -> Remove(json.string("id"))
            "delta" -> Delta(json.string("id"), json.stringOrNull("text"), json.stringOrNull("reasoning"))
            "queued" -> Queued(json.arr("items").mapObjects(QueuedMessage::from))
            "busy" -> Busy(json.bool("busy"))
            "routine-runs" -> RoutineRuns(json.arr("runs").mapObjects(RoutineRunCard::from))
            "routine-run" -> json.objOrNull("run")?.let { RoutineRun(RoutineRunCard.from(it)) }
            "yolo" -> Yolo(json.bool("on"))
            "ping" -> Ping
            "error" -> StreamError(json.string("message", "error"))
            else -> null
        }
    }
}

/** Every event of the app-wide feed (`GET /events`). */
sealed interface FeedEvent {
    /** On open: every conversation that is replying right now. */
    data class BusySnapshot(val busy: Set<String>) : FeedEvent

    data class Activity(val conversation: String, val busy: Boolean, val approvals: Int, val questions: Int) : FeedEvent
    data class Connection(val id: String, val status: String, val error: String?) : FeedEvent
    data object ModelsChanged : FeedEvent

    companion object {
        fun from(json: JSONObject): FeedEvent? = when (json.string("type")) {
            "activity" ->
                if (json.has("conversation")) {
                    Activity(json.string("conversation"), json.bool("busy"), json.int("approvals"), json.int("questions"))
                } else {
                    BusySnapshot(json.arr("busy").strings().toSet())
                }
            "connection" -> Connection(json.string("id"), json.string("status"), json.stringOrNull("error"))
            "models.changed" -> ModelsChanged
            else -> null
        }
    }
}
