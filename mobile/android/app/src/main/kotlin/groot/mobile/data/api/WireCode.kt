package groot.mobile.data.api

import org.json.JSONObject

/*
 * Code (the owner's coding agents): the harness contracts of `packages/code/src/contracts`
 * and the project and pull request types of `apps/web/src/shared/api/code.ts`, as far as the
 * app draws them. Field names follow the server's; a field the app does not read is left out.
 */

/** Claude Code's permission modes; a harness offers only the ones it enforces. */
object PermissionModes {
    const val DEFAULT = "default"
    const val ACCEPT_EDITS = "acceptEdits"
    const val PLAN = "plan"
    const val BYPASS = "bypassPermissions"

    /** The web client's labels (`pages/code/controls.tsx`). */
    fun label(mode: String): String = when (mode) {
        DEFAULT -> "Ask"
        ACCEPT_EDITS -> "Accept edits"
        PLAN -> "Plan"
        BYPASS -> "Bypass"
        else -> mode
    }

    fun hint(mode: String): String = when (mode) {
        DEFAULT -> "Ask before edits and commands"
        ACCEPT_EDITS -> "Edit files without asking; ask before commands"
        PLAN -> "Read and plan only; no edits"
        BYPASS -> "Never ask (YOLO)"
        else -> ""
    }
}

/** What a harness really does: a missing capability hides its control. */
data class CodeCapabilities(
    val interrupt: Boolean = false,
    val steer: Boolean = false,
    val queue: Boolean = false,
    val manageQueue: Boolean = false,
    /** "retry", "resume", "continue". */
    val recovery: List<String> = emptyList(),
    val archive: Boolean = false,
    val delete: Boolean = false,
    val rename: Boolean = false,
    val fork: Boolean = false,
    val modelSwitch: Boolean = false,
    val effortLevels: List<String> = emptyList(),
    val permissionModes: List<String> = emptyList(),
    val defaultPermissionMode: String? = null,
    val diffs: Boolean = false,
    val requiresCwd: Boolean = false,
    val usageReport: Boolean = false,
) {
    companion object {
        fun from(json: JSONObject): CodeCapabilities {
            val turns = json.objOrNull("turns") ?: JSONObject()
            val threads = json.objOrNull("threads") ?: JSONObject()
            val settings = json.objOrNull("settings") ?: JSONObject()
            val workspace = json.objOrNull("workspace") ?: JSONObject()
            val extras = json.objOrNull("extras") ?: JSONObject()
            return CodeCapabilities(
                interrupt = turns.bool("interrupt"),
                steer = turns.bool("steer"),
                queue = turns.bool("queue"),
                manageQueue = turns.bool("manageQueue"),
                recovery = turns.arr("recovery").strings(),
                archive = threads.bool("archive"),
                delete = threads.bool("delete"),
                rename = threads.bool("rename"),
                fork = threads.bool("fork"),
                modelSwitch = settings.bool("modelSwitch"),
                effortLevels = settings.arr("effortLevels").strings(),
                permissionModes = settings.arr("permissionModes").strings(),
                defaultPermissionMode = settings.stringOrNull("defaultPermissionMode"),
                diffs = workspace.bool("diffs"),
                requiresCwd = workspace.bool("requiresCwd"),
                usageReport = extras.bool("usageReport"),
            )
        }
    }
}

/** One configured harness (`GET /code/status`). [state] is disabled, connecting, connected or reconnecting. */
data class CodeHarness(
    val id: String,
    val kind: String,
    val label: String,
    val state: String,
    val detail: String?,
    val capabilities: CodeCapabilities,
) {
    val connected: Boolean get() = state == "connected"

    companion object {
        fun from(json: JSONObject): CodeHarness {
            val status = json.objOrNull("status") ?: JSONObject()
            return CodeHarness(
                id = json.string("id"),
                kind = json.string("kind"),
                label = json.string("label", json.string("id")),
                state = status.string("state", "disabled"),
                detail = status.stringOrNull("detail"),
                capabilities = CodeCapabilities.from(json.objOrNull("capabilities") ?: JSONObject()),
            )
        }
    }
}

/** A thread's open pull request and its Auto-fix loop state, as the list shows it. */
data class ThreadPr(val number: Int, val loop: String)

/** One conversation with a coding agent, as the list and the header show it. */
data class CodeThreadSummary(
    /** `<instanceId>:<nativeId>`. */
    val id: String,
    val instanceId: String,
    val kind: String,
    val title: String,
    val cwd: String?,
    val model: String?,
    val parentId: String?,
    val createdAt: Long,
    val updatedAt: Long,
    val working: Boolean,
    val archived: Boolean,
    val cursor: Int,
    val preview: String? = null,
    val queuedCount: Int = 0,
    val turnInterrupted: Boolean = false,
    val repoRoot: String? = null,
    val permissionMode: String? = null,
    val externalUrl: String? = null,
    val unread: Boolean = false,
    val projectId: String? = null,
    val pr: ThreadPr? = null,
) {
    companion object {
        fun from(json: JSONObject) = CodeThreadSummary(
            id = json.string("id"),
            instanceId = json.string("instanceId"),
            kind = json.string("kind"),
            title = json.string("title"),
            cwd = json.stringOrNull("cwd"),
            model = json.stringOrNull("model"),
            parentId = json.stringOrNull("parentId"),
            createdAt = json.instant("createdAt"),
            updatedAt = json.instant("updatedAt"),
            working = json.bool("working"),
            archived = json.bool("archived"),
            cursor = json.int("cursor"),
            preview = json.stringOrNull("preview"),
            queuedCount = json.int("queuedCount"),
            turnInterrupted = json.bool("turnInterrupted"),
            repoRoot = json.stringOrNull("repoRoot"),
            permissionMode = json.stringOrNull("permissionMode"),
            externalUrl = json.stringOrNull("externalUrl"),
            unread = json.bool("unread"),
            projectId = json.stringOrNull("projectId"),
            pr = json.objOrNull("pr")?.let { ThreadPr(it.int("number"), it.string("loop")) },
        )
    }
}

data class ThreadSettings(val model: String?, val effort: String?, val permissionMode: String?) {
    companion object {
        fun from(json: JSONObject) = ThreadSettings(
            json.stringOrNull("model"),
            json.stringOrNull("effort"),
            json.stringOrNull("permissionMode"),
        )
    }
}

data class CodeQueuedMessage(val id: String, val text: String, val from: String?) {
    companion object {
        fun from(json: JSONObject) = CodeQueuedMessage(json.string("id"), json.string("text"), json.stringOrNull("from"))
    }
}

data class CodeContext(val used: Long, val max: Long?) {
    companion object {
        fun from(json: JSONObject) = CodeContext(json.long("used"), json.longOrNull("max"))
    }
}

/** A question of a harness's question request: pick one (or several) options. */
data class CodeQuestion(
    val question: String,
    val header: String?,
    val multiSelect: Boolean,
    val options: List<Pair<String, String?>>,
)

/** What a harness asks the owner mid-turn: run a tool, or answer questions. */
sealed interface ApprovalRequest {
    data class Tool(val tool: String, val name: String, val summary: String, val reason: String?, val input: String) : ApprovalRequest
    data class Questions(val questions: List<CodeQuestion>) : ApprovalRequest

    companion object {
        fun from(json: JSONObject): ApprovalRequest = if (json.string("kind") == "question") {
            Questions(
                json.arr("questions").mapObjects { q ->
                    CodeQuestion(
                        question = q.string("question"),
                        header = q.stringOrNull("header"),
                        multiSelect = q.bool("multiSelect"),
                        options = q.arr("options").mapObjects { it.string("label") to it.stringOrNull("description") },
                    )
                },
            )
        } else {
            Tool(
                tool = json.string("tool", "other"),
                name = json.string("name"),
                summary = json.string("summary"),
                reason = json.stringOrNull("reason"),
                input = inputText(json.opt("input")),
            )
        }
    }
}

/** An image or file the harness serves at `/code/harnesses/:instance/asset?ref=`. */
data class CodeAsset(val ref: String, val name: String, val image: Boolean)

/** One row of the normalized transcript. Rows have stable ids and always arrive whole. */
sealed interface TranscriptItem {
    val id: String

    data class User(override val id: String, val text: String, val attachments: List<CodeAsset>) : TranscriptItem
    data class Assistant(override val id: String, val text: String) : TranscriptItem
    data class Thinking(override val id: String, val text: String) : TranscriptItem
    data class Report(override val id: String, val from: String, val text: String) : TranscriptItem
    data class Job(override val id: String, val text: String, val exitCode: Int?) : TranscriptItem
    data class Notice(
        override val id: String,
        /** error, warning or info. */
        val level: String,
        val text: String,
        val retryable: Boolean,
        val code: String?,
        val resetsAt: String?,
    ) : TranscriptItem
    data class Turn(override val id: String, val durationMs: Long?, val costUsd: Double?) : TranscriptItem
    data class Request(
        override val id: String,
        val request: ApprovalRequest,
        /** open, allowed, denied, answered or expired. */
        val status: String,
    ) : TranscriptItem
    data class Tool(
        override val id: String,
        /** bash, edit, read, search, web, browser, image, todo, subagent, message_user, … */
        val tool: String,
        val name: String,
        val summary: String,
        /** running, done, error or denied. */
        val status: String,
        val input: String,
        val output: String?,
        val live: Boolean,
        val durationMs: Long?,
        val diff: String?,
        val diffPath: String?,
        val childThreadId: String?,
        val childTitle: String?,
        val exitCode: Int?,
        val images: List<CodeAsset>,
    ) : TranscriptItem

    companion object {
        /** A row, or null for a kind this app does not know (a newer server). */
        fun from(json: JSONObject): TranscriptItem? {
            val id = json.string("id")
            return when (json.string("kind")) {
                "user" -> User(id, json.string("text"), assets(json))
                "assistant" -> Assistant(id, json.string("text"))
                "thinking" -> Thinking(id, json.string("text"))
                "report" -> Report(id, json.string("from"), json.string("text"))
                "job" -> Job(id, json.string("text"), json.intOrNull("exitCode"))
                "notice" -> Notice(
                    id,
                    json.string("level", "info"),
                    json.string("text"),
                    json.bool("retryable"),
                    json.stringOrNull("code"),
                    json.stringOrNull("resetsAt"),
                )
                "turn" -> Turn(id, json.longOrNull("durationMs"), json.doubleOrNull("costUsd"))
                "request" -> Request(
                    id,
                    ApprovalRequest.from(json.objOrNull("request") ?: JSONObject()),
                    json.string("status", "open"),
                )
                "tool" -> {
                    val diff = json.objOrNull("diff")
                    val child = json.objOrNull("child")
                    Tool(
                        id = id,
                        tool = json.string("tool", "other"),
                        name = json.string("name"),
                        summary = json.string("summary"),
                        status = json.string("status", "done"),
                        input = inputText(json.opt("input")),
                        output = json.stringOrNull("output"),
                        live = json.bool("live"),
                        durationMs = json.longOrNull("durationMs"),
                        diff = diff?.stringOrNull("diff"),
                        diffPath = diff?.stringOrNull("path"),
                        childThreadId = child?.stringOrNull("threadId"),
                        childTitle = child?.stringOrNull("title"),
                        exitCode = json.intOrNull("exitCode"),
                        images = assets(json, "images"),
                    )
                }
                else -> null
            }
        }

        private fun assets(json: JSONObject, key: String = "attachments"): List<CodeAsset> =
            json.arr(key).mapObjects { CodeAsset(it.string("ref"), it.string("name"), it.bool("image")) }
    }
}

/** A tool's input as text to show: a string as it is, anything else as indented JSON. */
private fun inputText(value: Any?): String = when (value) {
    null, JSONObject.NULL -> ""
    is String -> value
    is JSONObject -> value.toString(2)
    is org.json.JSONArray -> value.toString(2)
    else -> value.toString()
}

/** Everything the conversation view needs, read at once. */
data class CodeThreadSnapshot(
    val thread: CodeThreadSummary,
    val items: List<TranscriptItem>,
    val settings: ThreadSettings,
    val queued: List<CodeQueuedMessage>,
    val children: List<CodeThreadSummary>,
    val context: CodeContext,
    val costUsd: Double,
) {
    companion object {
        fun from(json: JSONObject) = CodeThreadSnapshot(
            thread = CodeThreadSummary.from(json.objOrNull("thread") ?: JSONObject()),
            items = json.arr("items").mapObjects { TranscriptItem.from(it) }.filterNotNull(),
            settings = ThreadSettings.from(json.objOrNull("settings") ?: JSONObject()),
            queued = json.arr("queued").mapObjects(CodeQueuedMessage::from),
            children = json.arr("children").mapObjects(CodeThreadSummary::from),
            context = CodeContext.from(json.objOrNull("context") ?: JSONObject()),
            costUsd = json.doubleOrNull("costUsd") ?: 0.0,
        )
    }
}

/** One event of a thread's stream (`GET /code/threads/:id/events`). */
sealed interface CodeThreadEvent {
    data class Snapshot(val snapshot: CodeThreadSnapshot) : CodeThreadEvent
    data class Thread(val thread: CodeThreadSummary) : CodeThreadEvent
    data class Items(val items: List<TranscriptItem>, val cursor: Int) : CodeThreadEvent
    data class Partial(val text: String, val thinking: String) : CodeThreadEvent
    data class State(
        val working: Boolean,
        val context: CodeContext?,
        val queued: List<CodeQueuedMessage>?,
        val settings: ThreadSettings?,
        val costUsd: Double?,
    ) : CodeThreadEvent
    data class Error(val message: String) : CodeThreadEvent

    /** The thread moved to another id (a harness re-keyed it). */
    data class Moved(val to: String) : CodeThreadEvent

    companion object {
        /** An event, or null for a ping or a type this app does not know. */
        fun from(json: JSONObject): CodeThreadEvent? = when (json.string("type")) {
            "snapshot" -> json.objOrNull("snapshot")?.let { Snapshot(CodeThreadSnapshot.from(it)) }
            "thread" -> json.objOrNull("thread")?.let { Thread(CodeThreadSummary.from(it)) }
            "items" -> Items(json.arr("items").mapObjects { TranscriptItem.from(it) }.filterNotNull(), json.int("cursor"))
            "partial" -> Partial(json.string("text"), json.string("thinking"))
            "state" -> State(
                working = json.bool("working"),
                context = json.objOrNull("context")?.let(CodeContext::from),
                queued = if (json.has("queued") && !json.isNull("queued")) json.arr("queued").mapObjects(CodeQueuedMessage::from) else null,
                settings = json.objOrNull("settings")?.let(ThreadSettings::from),
                costUsd = json.doubleOrNull("costUsd"),
            )
            "error" -> Error(json.string("message", "Something went wrong."))
            "moved" -> Moved(json.string("to"))
            else -> null
        }
    }
}

/** One event of the Code list stream (`GET /code/events`). */
sealed interface CodeListEvent {
    data class Status(val states: Map<String, String>) : CodeListEvent
    data class Threads(val threads: List<CodeThreadSummary>) : CodeListEvent
    data class Error(val message: String) : CodeListEvent

    companion object {
        fun from(json: JSONObject): CodeListEvent? = when (json.string("type")) {
            "status" -> {
                val instances = json.objOrNull("instances") ?: JSONObject()
                Status(instances.keys().asSequence().associateWith { instances.optJSONObject(it)?.string("state").orEmpty() })
            }
            "list" -> Threads(json.arr("threads").mapObjects(CodeThreadSummary::from))
            "error" -> Error(json.string("message"))
            else -> null
        }
    }
}

data class CodeModel(val id: String, val label: String, val isDefault: Boolean, val ready: Boolean) {
    companion object {
        fun from(json: JSONObject) = CodeModel(
            json.string("id"),
            json.stringOrNull("label")?.takeIf { it.isNotBlank() } ?: json.string("id"),
            json.bool("isDefault"),
            json.bool("ready", true),
        )
    }
}

/** A Code project: a GitHub repository with a checkout on the sandbox. */
data class CodeProject(
    val id: String,
    val name: String,
    val repo: String,
    val baseBranch: String,
    val defaultInstanceId: String?,
) {
    companion object {
        fun from(json: JSONObject): CodeProject {
            val repo = json.objOrNull("repo") ?: JSONObject()
            return CodeProject(
                id = json.string("id"),
                name = json.string("name"),
                repo = "${repo.string("owner")}/${repo.string("name")}",
                baseBranch = json.string("baseBranch"),
                defaultInstanceId = json.stringOrNull("defaultInstanceId"),
            )
        }
    }
}

// ---- Changes ------------------------------------------------------------------------------

/** Something to review: the uncommitted changes (`working`) or one commit. */
data class GitDiff(val id: String, val message: String, val filesCount: Int, val additions: Int, val deletions: Int) {
    companion object {
        fun from(json: JSONObject) = GitDiff(
            json.string("id"),
            json.string("message"),
            json.int("filesCount"),
            json.int("additions"),
            json.int("deletions"),
        )
    }
}

/** One changed file. [hash] and [viewed] come only from a project thread's review. */
data class ChangedFile(
    val path: String,
    /** added, modified or deleted. */
    val status: String,
    val additions: Int,
    val deletions: Int,
    val generated: Boolean,
    val hash: String? = null,
    val viewed: Boolean = false,
) {
    companion object {
        fun from(json: JSONObject) = ChangedFile(
            path = json.string("path"),
            status = json.string("status", "modified"),
            additions = json.int("additions"),
            deletions = json.int("deletions"),
            generated = json.bool("isGenerated"),
            hash = json.stringOrNull("hash"),
            viewed = json.bool("viewed"),
        )
    }
}

data class FileContents(val path: String, val oldContent: String, val newContent: String) {
    companion object {
        fun from(json: JSONObject) = FileContents(json.string("path"), json.string("oldContent"), json.string("newContent"))
    }
}

// ---- Pull requests ------------------------------------------------------------------------

/** One check of a pull request: pending, success, failure or neutral. */
data class PullCheck(val name: String, val state: String, val url: String?)

data class PullReview(val author: String, val state: String)

/** An unresolved review thread: where it is and its first comment. */
data class PullThread(val id: String, val path: String, val line: Int?, val author: String, val body: String)

data class AutofixPass(val id: String, val trigger: String, val status: String, val outcome: String?, val detail: String?, val createdAt: Long)

data class PullView(
    val number: Int,
    val url: String,
    val title: String,
    /** open, closed or merged. */
    val state: String,
    val draft: Boolean,
    val headRef: String,
    val baseRef: String,
    val autofix: Boolean,
    val autoMerge: Boolean,
    val loopStatus: String,
    val loopReason: String?,
    val mergeable: String?,
    val mergeMethods: List<String>,
    val inMergeQueue: Boolean,
    val checks: List<PullCheck>,
    val reviews: List<PullReview>,
    val threads: List<PullThread>,
    val stalled: List<String>,
    val ignored: Set<String>,
    val passes: List<AutofixPass>,
) {
    companion object {
        fun from(json: JSONObject): PullView {
            val snapshot = json.objOrNull("snapshot")
            val loop = json.objOrNull("loop") ?: JSONObject()
            return PullView(
                number = json.int("number"),
                url = json.string("url"),
                title = json.string("title"),
                state = json.string("state", "open"),
                draft = json.bool("draft"),
                headRef = json.string("headRef"),
                baseRef = json.string("baseRef"),
                autofix = json.bool("autofix"),
                autoMerge = json.bool("autoMerge"),
                loopStatus = loop.string("status", "off"),
                loopReason = loop.stringOrNull("reason"),
                mergeable = snapshot?.stringOrNull("mergeable"),
                mergeMethods = snapshot?.arr("mergeMethods")?.strings().orEmpty(),
                inMergeQueue = snapshot?.bool("inMergeQueue") ?: false,
                checks = snapshot?.arr("checks")?.mapObjects { PullCheck(it.string("name"), it.string("state", "pending"), it.stringOrNull("url")) }.orEmpty(),
                reviews = snapshot?.arr("reviews")?.mapObjects {
                    PullReview(it.objOrNull("author")?.string("login").orEmpty(), it.string("state"))
                }.orEmpty(),
                threads = snapshot?.arr("threads")?.mapObjects { thread ->
                    if (thread.bool("resolved")) return@mapObjects null
                    val first = thread.arr("comments").optJSONObject(0) ?: JSONObject()
                    PullThread(
                        id = thread.string("id"),
                        path = thread.string("path"),
                        line = thread.intOrNull("line"),
                        author = first.objOrNull("author")?.string("login").orEmpty(),
                        body = first.string("body"),
                    )
                }?.filterNotNull().orEmpty(),
                stalled = json.arr("stalled").strings(),
                ignored = json.arr("ignored").strings().toSet(),
                passes = json.arr("passes").mapObjects {
                    AutofixPass(
                        it.string("id"),
                        it.string("trigger"),
                        it.string("status"),
                        it.stringOrNull("outcome"),
                        it.stringOrNull("detail"),
                        it.instant("createdAt"),
                    )
                },
            )
        }
    }
}

/** The PR tab of one thread (`GET /code/threads/:id/pr`). */
data class ThreadPulls(
    val project: CodeProject?,
    val branch: String?,
    val active: PullView?,
    val earlier: List<Pair<Int, String>>,
    /** Commits on the branch not on the base yet: what Publish would push. */
    val ahead: Int?,
    val spendUsd: Double?,
    val limitUsd: Double?,
) {
    companion object {
        fun from(json: JSONObject): ThreadPulls {
            val spend = json.objOrNull("spend") ?: JSONObject()
            return ThreadPulls(
                project = json.objOrNull("project")?.let(CodeProject::from),
                branch = json.stringOrNull("branch"),
                active = json.objOrNull("active")?.let(PullView::from),
                earlier = json.arr("earlier").mapObjects { it.int("number") to it.string("title") },
                ahead = json.intOrNull("ahead"),
                spendUsd = spend.doubleOrNull("usd"),
                limitUsd = spend.doubleOrNull("limitUsd"),
            )
        }
    }
}
