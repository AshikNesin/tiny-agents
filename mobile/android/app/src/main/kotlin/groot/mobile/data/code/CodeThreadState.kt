package groot.mobile.data.code

import groot.mobile.data.api.CodeContext
import groot.mobile.data.api.CodeQueuedMessage
import groot.mobile.data.api.CodeThreadEvent
import groot.mobile.data.api.CodeThreadSnapshot
import groot.mobile.data.api.CodeThreadSummary
import groot.mobile.data.api.PullView
import groot.mobile.data.api.ThreadSettings
import groot.mobile.data.api.TranscriptItem

data class CodeThreadState(
    val loaded: Boolean = false,
    val error: String? = null,
    val thread: CodeThreadSummary? = null,
    val items: List<TranscriptItem> = emptyList(),
    val settings: ThreadSettings? = null,
    val queued: List<CodeQueuedMessage> = emptyList(),
    val children: List<CodeThreadSummary> = emptyList(),
    val working: Boolean = false,
    val context: CodeContext = CodeContext(0, null),
    val costUsd: Double = 0.0,
    val partialText: String = "",
    val partialThinking: String = "",
    val cursor: Int = 0,
    val movedTo: String? = null,
)

fun CodeThreadState.withSnapshot(snapshot: CodeThreadSnapshot): CodeThreadState = CodeThreadState(
    loaded = true,
    thread = snapshot.thread,
    items = snapshot.items,
    settings = snapshot.settings,
    queued = snapshot.queued,
    children = snapshot.children,
    working = snapshot.thread.working,
    context = snapshot.context,
    costUsd = snapshot.costUsd,
    cursor = snapshot.thread.cursor,
)

fun reduceCodeThread(state: CodeThreadState, event: CodeThreadEvent): CodeThreadState = when (event) {
    is CodeThreadEvent.Snapshot -> state.withSnapshot(event.snapshot)
    is CodeThreadEvent.Items -> {
        val items = state.items.toMutableList()
        val index = HashMap<String, Int>(items.size).apply { items.forEachIndexed { i, item -> put(item.id, i) } }
        for (item in event.items) {
            val at = index[item.id]
            if (at != null) {
                items[at] = item
            } else {
                index[item.id] = items.size
                items.add(item)
            }
        }
        val done = event.items.any { it is TranscriptItem.Assistant || it is TranscriptItem.Turn }
        state.copy(
            items = items,
            cursor = maxOf(state.cursor, event.cursor),
            partialText = if (done) "" else state.partialText,
            partialThinking = if (done) "" else state.partialThinking,
        )
    }
    is CodeThreadEvent.Thread -> state.copy(thread = event.thread, cursor = maxOf(state.cursor, event.thread.cursor))
    is CodeThreadEvent.Partial -> state.copy(partialText = event.text, partialThinking = event.thinking)
    is CodeThreadEvent.State -> state.copy(
        working = event.working,
        context = event.context ?: state.context,
        queued = event.queued ?: state.queued,
        settings = event.settings ?: state.settings,
        costUsd = event.costUsd ?: state.costUsd,
        partialText = if (event.working) state.partialText else "",
        partialThinking = if (event.working) state.partialThinking else "",
        thread = state.thread?.copy(working = event.working),
    )
    is CodeThreadEvent.Error -> state.copy(error = event.message)
    is CodeThreadEvent.Moved -> state.copy(movedTo = event.to)
}

sealed interface CodeDisplayItem {
    val key: String

    data class Row(val item: TranscriptItem) : CodeDisplayItem {
        override val key: String get() = item.id
    }

    data class Group(val tools: List<TranscriptItem.Tool>, val items: List<TranscriptItem>) : CodeDisplayItem {
        override val key: String get() = "group:${tools.first().id}"
    }
}

private fun standsAlone(tool: TranscriptItem.Tool): Boolean =
    tool.status == "running" ||
        tool.tool in setOf("subagent", "message_user", "message_parent", "todo") ||
        tool.images.isNotEmpty()

fun groupTools(items: List<TranscriptItem>): List<CodeDisplayItem> {
    val out = ArrayList<CodeDisplayItem>()
    var run = ArrayList<TranscriptItem>()
    fun flush() {
        var end = run.size
        while (end > 0 && run[end - 1] is TranscriptItem.Thinking) end--
        val body = run.subList(0, end)
        val tools = body.filterIsInstance<TranscriptItem.Tool>()
        if (tools.size >= 2) out.add(CodeDisplayItem.Group(tools, body.toList())) else body.forEach { out.add(CodeDisplayItem.Row(it)) }
        run.subList(end, run.size).forEach { out.add(CodeDisplayItem.Row(it)) }
        run = ArrayList()
    }
    for (item in items) {
        when {
            item is TranscriptItem.Tool && !standsAlone(item) -> run.add(item)
            item is TranscriptItem.Thinking && run.isNotEmpty() -> run.add(item)
            else -> {
                flush()
                out.add(CodeDisplayItem.Row(item))
            }
        }
    }
    flush()
    return out
}

fun describeTools(tools: List<TranscriptItem.Tool>): String {
    fun count(kind: String) = tools.count { it.tool == kind }
    fun plural(n: Int, one: String, many: String) = "$n ${if (n == 1) one else many}"
    val bash = count("bash")
    val edit = count("edit")
    val read = count("read")
    val search = count("search")
    val browser = count("browser")
    val other = tools.size - bash - edit - read - search - browser
    val parts = buildList {
        if (bash > 0) add("ran ${plural(bash, "command", "commands")}")
        if (edit > 0) add("edited ${plural(edit, "file", "files")}")
        if (read > 0) add("read ${plural(read, "file", "files")}")
        if (search > 0) add("searched ${plural(search, "time", "times")}")
        if (browser > 0) add("used the browser ${plural(browser, "time", "times")}")
        if (other > 0) add("used ${plural(other, "tool", "tools")}")
    }
    val failed = tools.count { it.status == "error" }
    val text = parts.joinToString(", ").replaceFirstChar { it.uppercase() }
    return if (failed > 0) "$text · $failed failed" else text
}

fun lastErrorId(items: List<TranscriptItem>): String? {
    for (item in items.asReversed()) {
        when (item) {
            is TranscriptItem.Notice -> if (item.level == "error") return item.id
            is TranscriptItem.Assistant, is TranscriptItem.Tool, is TranscriptItem.User -> return null
            else -> Unit
        }
    }
    return null
}

fun turnLine(turn: TranscriptItem.Turn): String? {
    val parts = listOfNotNull(
        turn.durationMs?.let { "Worked for ${durationText(it)}" },
        turn.costUsd?.takeIf { it > 0 }?.let(::formatUsd),
    )
    return parts.takeIf { it.isNotEmpty() }?.joinToString(" · ")
}

fun durationText(ms: Long): String = when {
    ms < 1_000 -> "${ms}ms"
    ms < 60_000 -> "${ms / 1_000}s"
    ms < 3_600_000 -> "${ms / 60_000}m ${(ms % 60_000) / 1_000}s"
    else -> "${ms / 3_600_000}h ${(ms % 3_600_000) / 60_000}m"
}

fun formatUsd(value: Double): String = when {
    value == 0.0 -> "$0"
    value < 0.01 -> "$" + String.format(java.util.Locale.ROOT, "%.4f", value)
    value < 1 -> "$" + String.format(java.util.Locale.ROOT, "%.3f", value)
    value < 100 -> "$" + String.format(java.util.Locale.ROOT, "%.2f", value)
    else -> "$" + Math.round(value)
}

fun formatTokens(tokens: Long): String = when {
    tokens >= 999_500_000 -> String.format(java.util.Locale.ROOT, "%.1fB", tokens / 1e9)
    tokens >= 999_500 -> String.format(java.util.Locale.ROOT, "%.1fM", tokens / 1e6)
    tokens >= 1_000 -> String.format(java.util.Locale.ROOT, "%.0fk", tokens / 1e3)
    else -> tokens.toString()
}

fun shortPath(path: String?): String {
    if (path.isNullOrBlank()) return ""
    val parts = path.split('/').filter { it.isNotEmpty() }
    return if (parts.size <= 2) path else "…/" + parts.takeLast(2).joinToString("/")
}

data class CodeStatusSection(val group: String, val label: String, val rows: List<CodeThreadSummary>)

private val STATUS_SECTIONS = listOf(
    "needs-you" to "Needs you",
    "working" to "Working",
    "review" to "In review",
    "done" to "Done",
)

private fun groupOf(row: CodeThreadSummary): String = row.statusGroup ?: if (row.working) "working" else "done"

fun codeStatusSections(rows: List<CodeThreadSummary>): List<CodeStatusSection> {
    val newestFirst = rows.filter { it.reviewId == null }.sortedByDescending { it.updatedAt }
    return STATUS_SECTIONS
        .map { (group, label) -> CodeStatusSection(group, label, newestFirst.filter { groupOf(it) == group }) }
        .filter { it.rows.isNotEmpty() }
}

data class RewindPoint(val at: String, val turn: Int, val turns: Int, val text: String)

fun lastTurn(items: List<TranscriptItem>): RewindPoint? {
    val starts = mutableListOf<TranscriptItem.User>()
    var open = false
    for (item in items) {
        if (item is TranscriptItem.Turn) open = false
        if (item !is TranscriptItem.User || open) continue
        open = true
        starts += item
    }
    val last = starts.lastOrNull() ?: return null
    return RewindPoint(last.forkAt ?: last.id, starts.size - 1, starts.size, last.text)
}

enum class CodeWorkflow(val wire: String, val label: String) {
    FixCi("fix_ci", "Fix CI"),
    AddressComments("address_comments", "Address comments"),
    ResolveConflicts("resolve_conflicts", "Resolve conflicts"),
}

fun codeWorkflows(pr: PullView): List<CodeWorkflow> = listOfNotNull(
    CodeWorkflow.FixCi.takeIf { pr.checks.any { it.state == "failure" } },
    CodeWorkflow.AddressComments.takeIf { pr.threads.any { it.id !in pr.ignored } },
    CodeWorkflow.ResolveConflicts.takeIf { pr.mergeable == "conflicting" },
)
