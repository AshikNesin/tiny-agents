package groot.mobile.data.api

import org.json.JSONObject

/*
 * The app's wire types outside the chat transcript, as the server declares them in the
 * web app's shared/api folder. Dates arrive as ISO strings and are held as epoch milliseconds.
 */

data class SessionUser(val id: Int, val email: String, val name: String?) {
    companion object {
        fun from(json: JSONObject) = SessionUser(json.int("id"), json.string("email"), json.stringOrNull("name"))
    }
}

// ---- Bots -------------------------------------------------------------------------------

/** One bot as the drawer lists it. */
data class BotListEntry(
    val id: String,
    val conversationId: String,
    val name: String,
    val description: String,
    val modelId: String?,
    val lastMessagePreview: String?,
    val lastActivityAt: Long,
    val lastReadAt: Long?,
    val unread: Boolean,
    val replying: Boolean,
    val approvals: Int,
    val questions: Int,
    val pinnedAt: Long?,
) {
    /** Something waits on the owner in this bot's chat. */
    val needsYou: Boolean get() = approvals + questions > 0

    companion object {
        fun from(json: JSONObject) = BotListEntry(
            id = json.string("id"),
            conversationId = json.string("conversationId"),
            name = json.string("name"),
            description = json.string("description"),
            modelId = json.stringOrNull("modelId"),
            lastMessagePreview = json.stringOrNull("lastMessagePreview"),
            lastActivityAt = json.instant("lastActivityAt"),
            lastReadAt = json.instantOrNull("lastReadAt"),
            unread = json.bool("unread"),
            replying = json.bool("replying"),
            approvals = json.int("approvals"),
            questions = json.int("questions"),
            pinnedAt = json.instantOrNull("pinnedAt"),
        )
    }
}

/** A bot with everything its editor shows. */
data class Bot(
    val id: String,
    val name: String,
    val description: String,
    val systemPrompt: String,
    val modelId: String?,
    val conversationId: String,
    val lastReadAt: Long?,
    val memoryEnabled: Boolean,
    val autoReview: Boolean,
    val yoloByDefault: Boolean,
    val pinnedAt: Long?,
    /** "shared" or "own". */
    val browserProfile: String,
    /** Tool name to "allow", "ask" or "off"; tools without an entry use their default. */
    val toolPermissions: Map<String, String>,
    val skillIds: List<String>,
    val connectionIds: List<String>,
    val guestIds: List<Int>,
) {
    companion object {
        fun from(json: JSONObject) = Bot(
            id = json.string("id"),
            name = json.string("name"),
            description = json.string("description"),
            systemPrompt = json.string("systemPrompt"),
            modelId = json.stringOrNull("modelId"),
            conversationId = json.string("conversationId"),
            lastReadAt = json.instantOrNull("lastReadAt"),
            memoryEnabled = json.bool("memoryEnabled", true),
            autoReview = json.bool("autoReview"),
            yoloByDefault = json.bool("yoloByDefault"),
            pinnedAt = json.instantOrNull("pinnedAt"),
            browserProfile = json.string("browserProfile", "shared"),
            toolPermissions = json.stringMap("toolPermissions"),
            skillIds = json.arr("skillIds").strings(),
            connectionIds = json.arr("connectionIds").strings(),
            guestIds = json.arr("guestIds").ints(),
        )
    }
}

/** What the bot editor sends; a null field is left out (unchanged on update). */
data class BotDraft(
    val name: String? = null,
    val description: String? = null,
    val systemPrompt: String? = null,
    val modelId: String? = null,
    val toolPermissions: Map<String, String>? = null,
    val skillIds: List<String>? = null,
    val connectionIds: List<String>? = null,
    val guestIds: List<Int>? = null,
    val memoryEnabled: Boolean? = null,
    val autoReview: Boolean? = null,
    val yoloByDefault: Boolean? = null,
    val browserProfile: String? = null,
) {
    fun toJson(): JSONObject = jsonOfNotNull(
        "name" to name, "description" to description, "systemPrompt" to systemPrompt, "modelId" to modelId,
        "toolPermissions" to toolPermissions, "skillIds" to skillIds, "connectionIds" to connectionIds,
        "guestIds" to guestIds, "memoryEnabled" to memoryEnabled, "autoReview" to autoReview,
        "yoloByDefault" to yoloByDefault, "browserProfile" to browserProfile,
    )
}

/** A chat the bot ran on before a "New chat". */
data class PastChat(
    val id: String,
    val title: String?,
    val startedAt: Long,
    val endedAt: Long,
    val lastMessagePreview: String?,
    val messageCount: Int,
) {
    companion object {
        fun from(json: JSONObject) = PastChat(
            id = json.string("id"),
            title = json.stringOrNull("title"),
            startedAt = json.instant("startedAt"),
            endedAt = json.instant("endedAt"),
            lastMessagePreview = json.stringOrNull("lastMessagePreview"),
            messageCount = json.int("messageCount"),
        )
    }
}

data class PastChatView(val chat: PastChat, val state: ChatState, val runs: List<RoutineRunCard>) {
    companion object {
        fun from(json: JSONObject) = PastChatView(
            chat = PastChat.from(json.objOrNull("chat") ?: JSONObject()),
            state = ChatState.from(json.objOrNull("state") ?: JSONObject()),
            runs = json.arr("runs").mapObjects(RoutineRunCard::from),
        )
    }
}

// ---- Models and capabilities ------------------------------------------------------------

data class CatalogModel(
    val id: String,
    val name: String,
    val providerName: String,
    val upstreamId: String,
    val vision: Boolean,
    val reasoning: Boolean,
    val enabled: Boolean,
    val available: Boolean,
    val unavailableReason: String?,
    val note: String?,
) {
    companion object {
        fun from(json: JSONObject) = CatalogModel(
            id = json.string("id"),
            name = json.string("name"),
            providerName = json.string("providerName"),
            upstreamId = json.string("upstreamId"),
            vision = json.bool("vision"),
            reasoning = json.bool("reasoning"),
            enabled = json.bool("enabled", true),
            available = json.bool("available", true),
            unavailableReason = json.stringOrNull("unavailableReason"),
            note = json.stringOrNull("note"),
        )
    }
}

data class ProviderSummary(val id: String, val name: String, val kind: String, val status: String, val enabled: Boolean, val modelCount: Int)

data class ModelsResponse(
    val models: List<CatalogModel>,
    val defaultModelId: String?,
    /** Some chat model can run now; false disables sending. */
    val canAnswer: Boolean,
    val providers: List<ProviderSummary>,
) {
    companion object {
        val Empty = ModelsResponse(emptyList(), null, true, emptyList())

        fun from(json: JSONObject) = ModelsResponse(
            models = json.arr("models").mapObjects(CatalogModel::from),
            defaultModelId = json.stringOrNull("defaultModelId"),
            canAnswer = json.bool("canAnswer", true),
            providers = json.arr("providers").mapObjects {
                ProviderSummary(it.string("id"), it.string("name"), it.string("kind"), it.string("status"), it.bool("enabled", true), it.int("modelCount"))
            },
        )
    }
}

data class ToolInfo(
    val name: String,
    /** Past-tense label for the transcript ("Searched the web"). */
    val label: String,
    /** Imperative phrase completing "<bot> wants to …". */
    val askLabel: String?,
    val description: String,
    val readOnly: Boolean,
    val allowByDefault: Boolean,
    val askOnly: Boolean,
    val unattendedOnly: Boolean,
) {
    /** The permission the tool runs with when the bot sets none. */
    val defaultPermission: String
        get() = if (askOnly) "ask" else if (readOnly || allowByDefault) "allow" else "ask"
}

/** A toolkit, the skills library or a connection, as a bot's settings list it. */
data class Capability(
    val id: String,
    /** "toolkit", "skills" or "connection". */
    val kind: String,
    val name: String,
    val description: String,
    val tools: List<ToolInfo>,
    val setupHint: String?,
    /** Switched by the app itself, never a choice in a bot's settings. */
    val auto: Boolean,
) {
    companion object {
        fun from(json: JSONObject) = Capability(
            id = json.string("id"),
            kind = json.string("kind"),
            name = json.string("name"),
            description = json.string("description"),
            tools = json.arr("tools").mapObjects { t ->
                ToolInfo(
                    name = t.string("name"),
                    label = t.string("label"),
                    askLabel = t.stringOrNull("askLabel"),
                    description = t.string("description"),
                    readOnly = t.bool("readOnly"),
                    allowByDefault = t.bool("allowByDefault"),
                    askOnly = t.bool("askOnly"),
                    unattendedOnly = t.bool("unattendedOnly"),
                )
            },
            setupHint = json.stringOrNull("setupHint"),
            auto = json.bool("auto"),
        )
    }
}

// ---- Live views -------------------------------------------------------------------------

/** A bot's browser or computer, as the chat's live view polls it. */
data class LiveStatus(
    /** Computer only: false without a sandbox VM. Always true for a browser. */
    val configured: Boolean,
    val setupHint: String?,
    val active: Boolean,
    val starting: Boolean,
    /** "installing" during the one-time VM setup, else "starting". */
    val phase: String?,
    val error: String?,
    /** "agent" or "human"; null while closed. */
    val driver: String?,
    /** Browser only: "vnc" streams, "headless" has no live view. */
    val mode: String?,
    val url: String?,
    val scale: Double?,
    val width: Int?,
    val height: Int?,
    /** What a bot asked the owner to do while it waits for a hand-back. */
    val takeover: String?,
) {
    /** There is a picture to stream: a desktop, or a browser that is not headless. */
    val viewable: Boolean get() = active && mode != "headless"

    companion object {

        fun from(json: JSONObject) = LiveStatus(
            configured = json.bool("configured", true),
            setupHint = json.stringOrNull("setupHint"),
            active = json.bool("active"),
            starting = json.bool("starting"),
            phase = json.stringOrNull("phase"),
            error = json.stringOrNull("error"),
            driver = json.stringOrNull("driver"),
            mode = json.stringOrNull("mode"),
            url = json.stringOrNull("url"),
            scale = json.doubleOrNull("scale"),
            width = json.intOrNull("width"),
            height = json.intOrNull("height"),
            takeover = json.stringOrNull("takeover"),
        )
    }
}

/** One browser or desktop on the Browser and Computer pages: a profile and who uses it. */
data class LiveProfile(
    /** "shared", or "bot-<id>". */
    val profile: String,
    val label: String,
    val botNames: List<String>,
    val status: LiveStatus,
)

data class LiveProfileList(
    /** False when this server has no live view of this kind. */
    val available: Boolean,
    val setupHint: String?,
    val width: Int?,
    val height: Int?,
    val profiles: List<LiveProfile>,
) {
    companion object {
        /** `GET /browser` (`browsers`, `liveView`) or `GET /computer` (`desktops`, `configured`). */
        fun from(json: JSONObject): LiveProfileList {
            val rows = if (json.has("browsers")) json.arr("browsers") else json.arr("desktops")
            val available = if (json.has("liveView")) json.bool("liveView") else json.bool("configured", true)
            return LiveProfileList(
                available = available,
                setupHint = json.stringOrNull("setupHint"),
                width = json.intOrNull("width"),
                height = json.intOrNull("height"),
                profiles = rows.mapObjects { row ->
                    LiveProfile(
                        profile = row.string("profile"),
                        label = row.string("label"),
                        botNames = row.arr("bots").mapObjects { it.string("name") },
                        status = LiveStatus.from(row).copy(configured = available),
                    )
                },
            )
        }
    }
}

/** A one-time viewer ticket: a WebSocket path on the server and its pixel density. */
data class VncTicket(val path: String, val scale: Double)

data class DesktopApp(val id: String, val name: String)

// ---- Terminal ---------------------------------------------------------------------------

/** One tmux-backed tab on the sandbox VM. */
data class TerminalTab(val name: String, val process: String?, val attached: Boolean, val createdAt: Long) {
    companion object {
        fun from(json: JSONObject) =
            TerminalTab(json.string("name"), json.stringOrNull("process"), json.bool("attached"), json.instant("createdAt"))
    }
}

data class TerminalList(
    /** "ready", "unconfigured", "unreachable" or "tmux-missing". */
    val status: String,
    val message: String?,
    val installCommand: String?,
    val tabs: List<TerminalTab>,
) {
    companion object {
        fun from(json: JSONObject): TerminalList {
            val status = json.objOrNull("status") ?: JSONObject()
            return TerminalList(
                status = status.string("kind", "ready"),
                message = status.stringOrNull("message"),
                installCommand = status.stringOrNull("installCommand"),
                tabs = json.arr("sessions").mapObjects(TerminalTab::from),
            )
        }
    }
}

// ---- Uploads ----------------------------------------------------------------------------

/** One page of an upload's extracted text, for the preview. */
data class UploadText(val status: String, val error: String?, val page: Int, val pages: Int, val text: String?, val rows: List<List<String>>, val entries: List<String>)

// ---- Routines ---------------------------------------------------------------------------

/** When a routine fires: once at an instant, on a cron expression, or every N minutes. */
sealed interface Schedule {
    data class Once(val at: String) : Schedule
    data class Cron(val expr: String) : Schedule
    data class Interval(val minutes: Int) : Schedule

    fun toJson(): JSONObject = when (this) {
        is Once -> jsonOf("kind" to "once", "at" to at)
        is Cron -> jsonOf("kind" to "cron", "expr" to expr)
        is Interval -> jsonOf("kind" to "interval", "minutes" to minutes)
    }

    companion object {
        fun from(json: JSONObject?): Schedule = when (json?.string("kind")) {
            "once" -> Once(json.string("at"))
            "interval" -> Interval(json.int("minutes", 60))
            else -> Cron(json?.string("expr", "0 9 * * *") ?: "0 9 * * *")
        }
    }
}

data class Routine(
    val id: String,
    val botId: String,
    val botName: String,
    val name: String,
    val prompt: String,
    val schedule: Schedule,
    val scheduleDescription: String,
    val enabled: Boolean,
    val nextRunAt: Long?,
    val done: Boolean,
    val blockedStreak: Int,
    val pausedReason: String?,
) {
    /** "scheduled", "struggling", "auto_paused", "done" or "paused" (shared/machines/routine.ts). */
    val state: String
        get() = when {
            enabled -> if (blockedStreak > 0) "struggling" else "scheduled"
            pausedReason != null -> "auto_paused"
            done -> "done"
            else -> "paused"
        }

    companion object {
        fun from(json: JSONObject) = Routine(
            id = json.string("id"),
            botId = json.string("botId"),
            botName = json.string("botName"),
            name = json.string("name"),
            prompt = json.string("prompt"),
            schedule = Schedule.from(json.objOrNull("schedule")),
            scheduleDescription = json.string("scheduleDescription"),
            enabled = json.bool("enabled"),
            nextRunAt = json.instantOrNull("nextRunAt"),
            done = json.bool("done"),
            blockedStreak = json.int("blockedStreak"),
            pausedReason = json.stringOrNull("pausedReason"),
        )
    }
}

data class RoutineRun(
    val id: String,
    val routineId: String,
    val scheduledFor: Long,
    val status: String,
    val trigger: String,
    val finishedAt: Long?,
    val output: String?,
    val error: String?,
    val routineName: String?,
    val botName: String?,
) {
    companion object {
        fun from(json: JSONObject) = RoutineRun(
            id = json.string("id"),
            routineId = json.string("routineId"),
            scheduledFor = json.instant("scheduledFor"),
            status = json.string("status"),
            trigger = json.string("trigger"),
            finishedAt = json.instantOrNull("finishedAt"),
            output = json.stringOrNull("output"),
            error = json.stringOrNull("error"),
            routineName = json.stringOrNull("routineName"),
            botName = json.stringOrNull("botName"),
        )
    }
}

// ---- Tasks, skills, memory --------------------------------------------------------------

data class OwnerTask(
    val id: String,
    val title: String,
    val description: String,
    /** "todo", "in_progress" or "done". */
    val status: String,
    /** "low", "medium", "high" or "urgent". */
    val priority: String,
    val dueAt: Long?,
    val completedAt: Long?,
    val createdAt: Long,
) {
    companion object {
        fun from(json: JSONObject) = OwnerTask(
            id = json.string("id"),
            title = json.string("title"),
            description = json.string("description"),
            status = json.string("status", "todo"),
            priority = json.string("priority", "medium"),
            dueAt = json.instantOrNull("dueAt"),
            completedAt = json.instantOrNull("completedAt"),
            createdAt = json.instant("createdAt"),
        )
    }
}

data class Skill(
    val id: String,
    val name: String,
    val description: String,
    val body: String,
    val fileCount: Int,
    val source: String,
    val sourceUrl: String?,
    val botIds: List<String>,
) {
    companion object {
        fun from(json: JSONObject) = Skill(
            id = json.string("id"),
            name = json.string("name"),
            description = json.string("description"),
            body = json.string("body"),
            fileCount = json.arr("files").length(),
            source = json.string("source", "manual"),
            sourceUrl = json.stringOrNull("sourceUrl"),
            botIds = json.arr("botIds").strings(),
        )
    }
}

data class Memory(
    val id: String,
    val botId: String,
    val text: String,
    /** "preference", "fact", "goal" or "habit". */
    val category: String,
    /** "active", "superseded", "archived", "expired" or "deleted". */
    val status: String,
    val source: String,
    val createdAt: Long,
) {
    companion object {
        fun from(json: JSONObject) = Memory(
            id = json.string("id"),
            botId = json.string("botId"),
            text = json.string("text"),
            category = json.string("category", "fact"),
            status = json.string("status", "active"),
            source = json.string("source", "manual"),
            createdAt = json.instant("createdAt"),
        )
    }
}

// ---- Connections ------------------------------------------------------------------------

data class ConnectionTool(
    val name: String,
    /** As the server names it; the id in tool routes. */
    val serverName: String,
    val label: String,
    val description: String,
    val readOnly: Boolean,
    val enabled: Boolean,
)

/** An MCP server the bots can use. */
data class Connection(
    val id: String,
    val name: String,
    val url: String,
    val authType: String,
    /** "connecting", "connected", "error" or "needs_auth". */
    val status: String,
    val error: String?,
    val tools: List<ConnectionTool>,
    val botIds: List<String>,
) {
    companion object {
        fun from(json: JSONObject) = Connection(
            id = json.string("id"),
            name = json.string("name"),
            url = json.string("url"),
            authType = json.string("authType", "none"),
            status = json.string("status", "connecting"),
            error = json.stringOrNull("error"),
            tools = json.arr("tools").mapObjects { t ->
                ConnectionTool(t.string("name"), t.string("serverName"), t.string("label"), t.string("description"), t.bool("readOnly"), t.bool("enabled", true))
            },
            botIds = json.arr("botIds").strings(),
        )
    }
}

// ---- Vault ------------------------------------------------------------------------------

/** A vault item's metadata and policy: never a value. */
data class VaultItem(
    val handle: String,
    /** "login", "card", "identity" or "api_key". */
    val kind: String,
    val audience: String,
    val label: String,
    val username: String?,
    val origins: List<String>,
    val hosts: List<String>,
    /** "every_use", "per_conversation" or "allowed". */
    val approval: String,
    val cardBrand: String?,
    val cardLast4: String?,
    val hasTotp: Boolean,
    val disabled: Boolean,
    val lastUsedAt: Long?,
    val lastUsedBy: String?,
) {
    companion object {
        fun from(json: JSONObject): VaultItem {
            val card = json.objOrNull("card")
            return VaultItem(
                handle = json.string("handle"),
                kind = json.string("kind"),
                audience = json.string("audience", "bots"),
                label = json.string("label"),
                username = json.stringOrNull("username"),
                origins = json.arr("origins").strings(),
                hosts = json.arr("hosts").strings(),
                approval = json.string("effectiveApproval", json.string("approval", "every_use")),
                cardBrand = card?.stringOrNull("brand"),
                cardLast4 = card?.stringOrNull("last4"),
                hasTotp = json.bool("hasTotp"),
                disabled = json.bool("disabled"),
                lastUsedAt = json.instantOrNull("lastUsedAt"),
                lastUsedBy = json.stringOrNull("lastUsedBy"),
            )
        }
    }
}

data class VaultAuditEvent(val at: Long, val tool: String, val target: String, val outcome: String, val reason: String?)

data class VaultItemDetail(val item: VaultItem, val title: String, val fields: List<String>, val canReveal: Boolean, val events: List<VaultAuditEvent>) {
    companion object {
        fun from(json: JSONObject) = VaultItemDetail(
            item = VaultItem.from(json.objOrNull("item") ?: JSONObject()),
            title = json.string("title"),
            fields = json.arr("fields").strings(),
            canReveal = json.objOrNull("capabilities")?.bool("reveal") ?: false,
            events = json.arr("events").mapObjects {
                VaultAuditEvent(it.instant("at"), it.string("tool"), it.string("target"), it.string("outcome"), it.stringOrNull("reason"))
            },
        )
    }
}

/** A step-up token for `X-Vault-Step-Up`, valid until [expiresAt] (epoch ms). */
data class StepUpToken(val token: String, val expiresAt: Long)

/** A bot's credential request as the sign-in sheet shows it: metadata only. */
data class CredentialRequestView(
    val taskId: Int,
    val botName: String?,
    val origin: String,
    val title: String,
    val purpose: String,
    val fields: List<CredentialField>,
    val savedHandle: String?,
    val expiresAt: Long,
) {
    companion object {
        fun from(json: JSONObject) = CredentialRequestView(
            taskId = json.int("taskId"),
            botName = json.objOrNull("bot")?.stringOrNull("name"),
            origin = json.string("origin"),
            title = json.string("title"),
            purpose = json.string("purpose"),
            fields = json.arr("fields").mapObjects { f ->
                CredentialField(f.string("key"), f.string("label"), f.string("type", "text"), f.bool("required"))
            },
            savedHandle = json.stringOrNull("savedHandle"),
            expiresAt = json.long("expiresAt"),
        )
    }
}

// ---- People -----------------------------------------------------------------------------

/** Someone the owner shares bots with. */
data class Guest(val id: Int, val email: String, val name: String?, val botIds: List<String>) {
    companion object {
        fun from(json: JSONObject) = Guest(json.int("id"), json.string("email"), json.stringOrNull("name"), json.arr("botIds").strings())
    }
}

/** `POST /notifications/devices` (`apps/web/src/shared/api/push.ts`, `PushDeviceBody`). */
data class PushDeviceBody(
    val endpoint: String,
    val p256dh: String,
    val auth: String,
    /** "fcm": the app registers through Google's embedded distributor only. */
    val distributor: String,
    val label: String?,
    val appVersion: String?,
) {
    fun toJson(): JSONObject = jsonOfNotNull(
        "endpoint" to endpoint,
        "keys" to jsonOf("p256dh" to p256dh, "auth" to auth),
        "distributor" to distributor,
        "label" to label,
        "appVersion" to appVersion,
    )
}
