package groot.mobile.data.code

import groot.mobile.data.api.CodeContext
import groot.mobile.data.api.CodeQueuedMessage
import groot.mobile.data.api.CodeThreadEvent
import groot.mobile.data.api.CodeThreadSnapshot
import groot.mobile.data.api.CodeThreadSummary
import groot.mobile.data.api.ThreadSettings
import groot.mobile.data.api.TranscriptItem

/**
 * One Code thread, live: a port of the web client's `lib/code/use-thread.ts`. The stream starts
 * with a full snapshot and then upserts rows by id, so a replay or reconnect never loses or
 * duplicates a row.
 */
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
    /** Text and thinking the model is streaming right now (not yet a row). */
    val partialText: String = "",
    val partialThinking: String = "",
    val cursor: Int = 0,
    /** The thread now lives under another id. */
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

/** Apply one thread event. */
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
        // A finished message replaces the streaming tail.
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

// ---- Transcript presentation (`lib/code/transcript.ts`) -----------------------------------

/** What the transcript draws: a row, or a run of finished tool calls folded into one line. */
sealed interface CodeDisplayItem {
    val key: String

    data class Row(val item: TranscriptItem) : CodeDisplayItem {
        override val key: String get() = item.id
    }

    /** Two or more finished tool calls (and the thinking between them). */
    data class Group(val tools: List<TranscriptItem.Tool>, val items: List<TranscriptItem>) : CodeDisplayItem {
        override val key: String get() = "group:${tools.first().id}"
    }
}

/** Tools that stand on their own: running ones, subagents, messages, plans and screenshots. */
private fun standsAlone(tool: TranscriptItem.Tool): Boolean =
    tool.status == "running" ||
        tool.tool in setOf("subagent", "message_user", "message_parent", "todo") ||
        tool.images.isNotEmpty()

/** Fold runs of two or more finished tool calls (and the thinking between them) into one group. */
fun groupTools(items: List<TranscriptItem>): List<CodeDisplayItem> {
    val out = ArrayList<CodeDisplayItem>()
    var run = ArrayList<TranscriptItem>()
    fun flush() {
        // Thinking after the last tool belongs to what follows, not the group.
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

/** "Ran 3 commands, edited 2 files" for a group's line. */
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

/** The id of the last error notice when nothing followed it: the one that offers recovery. */
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

/** "Worked for 12s · $0.04" under a finished turn. */
fun turnLine(turn: TranscriptItem.Turn): String? {
    val parts = listOfNotNull(
        turn.durationMs?.let { "Worked for ${durationText(it)}" },
        turn.costUsd?.takeIf { it > 0 }?.let(::formatUsd),
    )
    return parts.takeIf { it.isNotEmpty() }?.joinToString(" · ")
}

/** "850ms", "12s", "3m 4s", "1h 2m". */
fun durationText(ms: Long): String = when {
    ms < 1_000 -> "${ms}ms"
    ms < 60_000 -> "${ms / 1_000}s"
    ms < 3_600_000 -> "${ms / 60_000}m ${(ms % 60_000) / 1_000}s"
    else -> "${ms / 3_600_000}h ${(ms % 3_600_000) / 60_000}m"
}

/** "$0", "$0.0042", "$0.161", "$12.35" (the web client's `formatUsd`). */
fun formatUsd(value: Double): String = when {
    value == 0.0 -> "$0"
    value < 0.01 -> "$" + String.format(java.util.Locale.ROOT, "%.4f", value)
    value < 1 -> "$" + String.format(java.util.Locale.ROOT, "%.3f", value)
    value < 100 -> "$" + String.format(java.util.Locale.ROOT, "%.2f", value)
    else -> "$" + Math.round(value)
}

/** "12k", "2.5M". */
fun formatTokens(tokens: Long): String = when {
    tokens >= 999_500_000 -> String.format(java.util.Locale.ROOT, "%.1fB", tokens / 1e9)
    tokens >= 999_500 -> String.format(java.util.Locale.ROOT, "%.1fM", tokens / 1e6)
    tokens >= 1_000 -> String.format(java.util.Locale.ROOT, "%.0fk", tokens / 1e3)
    else -> tokens.toString()
}

/** "…/app/src" style: the last two path segments. */
fun shortPath(path: String?): String {
    if (path.isNullOrBlank()) return ""
    val parts = path.split('/').filter { it.isNotEmpty() }
    return if (parts.size <= 2) path else "…/" + parts.takeLast(2).joinToString("/")
}

// ---- The list (`lib/code/list.ts`) --------------------------------------------------------

/** A thread and its subagents; [busy] and [unread] count the subagents too. */
data class CodeListNode(val row: CodeThreadSummary, val children: List<CodeListNode>, val busy: Boolean, val unread: Boolean)

data class CodeListSections(val working: List<CodeListNode>, val recent: List<CodeListNode>)

/** Parent to children, newest first; a subagent whose parent is not listed stands on its own. */
fun buildCodeTree(rows: List<CodeThreadSummary>): List<CodeListNode> {
    val ids = rows.map { it.id }.toSet()
    val byParent = rows.filter { it.parentId != null && it.parentId in ids && it.parentId != it.id }.groupBy { it.parentId!! }
    fun node(row: CodeThreadSummary, depth: Int): CodeListNode {
        val children = if (depth > MAX_DEPTH) emptyList() else byParent[row.id].orEmpty().map { node(it, depth + 1) }.sortedByDescending { it.row.updatedAt }
        return CodeListNode(row, children, row.working || children.any { it.busy }, row.unread || children.any { it.unread })
    }
    return rows.filter { it.parentId == null || it.parentId !in ids || it.parentId == it.id }
        .map { node(it, 0) }
        .sortedByDescending { it.row.updatedAt }
}

/** Working now on top, then recent, narrowed to one harness when [instanceId] is set. */
fun buildCodeSections(rows: List<CodeThreadSummary>, instanceId: String? = null): CodeListSections {
    val tree = buildCodeTree(rows.filter { instanceId == null || it.instanceId == instanceId })
    return CodeListSections(tree.filter { it.busy }, tree.filter { !it.busy })
}

/** Working directories threads used, most recent first: the New thread screen offers them. */
fun recentDirectories(rows: List<CodeThreadSummary>, limit: Int = 6): List<String> =
    rows.sortedByDescending { it.updatedAt }.mapNotNull { it.cwd?.takeIf(String::isNotBlank) }.distinct().take(limit)

private const val MAX_DEPTH = 20
