package groot.mobile.data.chat

import groot.mobile.data.api.Capability
import groot.mobile.data.api.ToolCall
import java.net.URI
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.roundToLong

data class ToolLabels(
    val done: Map<String, String> = emptyMap(),
    val ask: Map<String, String> = emptyMap(),
) {
    companion object {
        fun of(capabilities: List<Capability>): ToolLabels {
            val tools = capabilities.flatMap { it.tools }
            return ToolLabels(
                done = tools.associate { it.name to it.label },
                ask = tools.mapNotNull { tool -> tool.askLabel?.let { tool.name to it } }.toMap(),
            )
        }
    }
}

private val MCP_NAME = Regex("^mcp__([a-z0-9-]+)__(.+)$")

fun toolLabel(labels: ToolLabels, name: String): String {
    labels.done[name]?.let { return it }
    MCP_NAME.find(name)?.let { match ->
        val pretty = match.groupValues[2].replace('_', ' ').split(' ')
            .joinToString(" ") { word -> word.replaceFirstChar { it.titlecase(Locale.ROOT) } }
        return "$pretty via ${match.groupValues[1]}"
    }
    return name.replace('_', ' ')
}

fun toolAskLabel(labels: ToolLabels, name: String): String = labels.ask[name] ?: "use ${toolLabel(labels, name)}"

private const val SUMMARY_LENGTH = 60
private val TELLING_ARGS = listOf("title", "query", "url", "name", "id", "to", "text")

fun argSummary(call: ToolCall): String {
    for (key in TELLING_ARGS) {
        val value = call.args[key]
        if (value is String && value.isNotBlank()) return value.trim().take(SUMMARY_LENGTH)
    }
    val first = call.args.values.firstOrNull()
    return if (first is String) first.take(SUMMARY_LENGTH) else ""
}

fun stepTitle(call: ToolCall, labels: ToolLabels): String {
    val summary = argSummary(call)
    if (call.name == "load_skill") return "Using skill $summary"
    return toolLabel(labels, call.name) + if (summary.isNotEmpty()) " “$summary”" else ""
}

private const val PAYLOAD_FOLD = 120

fun approvalPayload(call: ToolCall): String {
    for (key in listOf("instructions", "append")) {
        val value = call.args[key]
        if (value is String && value.isNotBlank()) return value
    }
    return argSummary(call)
}

data class ApprovalFact(val label: String, val value: String)

data class ApprovalText(
    val title: String,
    val facts: List<ApprovalFact>,
    val foldedPayload: String?,
)

private fun newBotFacts(args: Map<String, Any?>): List<ApprovalFact> {
    fun text(key: String) = (args[key] as? String)?.trim().orEmpty()
    val instructions = text("instructions")
    return buildList {
        if (text("description").isNotEmpty()) add(ApprovalFact("Description", text("description")))
        add(ApprovalFact("Model", text("model").ifEmpty { "default model" }))
        if (instructions.length <= PAYLOAD_FOLD) add(ApprovalFact("Instructions", instructions.ifEmpty { "(none)" }))
    }
}

fun approvalText(call: ToolCall, botName: String, labels: ToolLabels): ApprovalText {
    val ask = toolAskLabel(labels, call.name)
    val summary = argSummary(call)
    val payload = approvalPayload(call)
    return ApprovalText(
        title = "$botName wants to $ask" + if (summary.isNotEmpty()) ": “$summary”" else "",
        facts = if (call.name == "create_bot") newBotFacts(call.args) else emptyList(),
        foldedPayload = payload.takeIf { it.length > PAYLOAD_FOLD },
    )
}

fun expiryText(expiresAt: Long?, now: Long): String {
    if (expiresAt == null) return ""
    val minutes = max(0, ceil((expiresAt - now) / 60_000.0).toInt())
    return " Expires in ${if (minutes == 1) "1 minute" else "$minutes minutes"}."
}

data class VaultApprovalText(val title: String, val command: String?, val description: String)

fun vaultApprovalText(call: ToolCall, botName: String, now: Long): VaultApprovalText {
    val vault = requireNotNull(call.vault)
    val what = if (vault.cardBrand != null) "${vault.cardBrand} ••${vault.cardLast4.orEmpty()}" else vault.label
    val expiry = expiryText(call.expiresAt, now)
    if (vault.tool == "run_command") {
        val verb = if (vault.env.size == 1) "is" else "are"
        val hosts = vault.hosts.joinToString(", ").ifEmpty { "nothing" }
        return VaultApprovalText(
            title = "$botName wants to run a command with $what",
            command = vault.target,
            description = "${vault.env.joinToString(", ")} $verb set for this command only, and it can reach only $hosts. " +
                "$botName never sees the value, but the command can use it: check what it does.$expiry",
        )
    }
    val verb = when (vault.tool) {
        "browser_fill_secret" -> "fill"
        "browser_enter_code" -> "enter a code from"
        "computer_fill_secret" -> "type"
        "http_request" -> "send"
        else -> "use"
    }
    val where = if (vault.tool == "http_request") "to ${vault.target}" else "on ${vault.target}"
    val into = when (vault.tool) {
        "http_request" -> "into the request"
        "computer_fill_secret" -> "into that window on the computer, and only if it is in front"
        else -> "into the page"
    }
    val who = vault.username?.let { "As $it. " }.orEmpty()
    return VaultApprovalText(
        title = "$botName wants to $verb $what $where",
        command = null,
        description = "${who}The value goes straight $into; $botName never sees it.$expiry",
    )
}

fun credentialRequestText(call: ToolCall, botName: String, now: Long): Pair<String, String> {
    val credentials = requireNotNull(call.credentials)
    val host = runCatching { URI(credentials.origin).host }.getOrNull() ?: credentials.origin
    return "$botName needs you on $host" to
        "${credentials.title}. What you type is filled into the page and never shown to $botName.${expiryText(call.expiresAt, now)}"
}

fun approvalNote(note: String?, approval: String?): String? {
    if (note == null && approval != "approved" && approval != "auto" && approval != "yolo") return null
    val lead = note.orEmpty()
    val sep = if (note != null) " · " else ""
    return when (approval) {
        "approved" -> if (note != null) "$note · approved by you" else lead
        "auto" -> "$lead${sep}auto-approved"
        "yolo" -> "$lead${sep}auto-approved (YOLO)"
        else -> lead
    }.ifEmpty { null }
}

fun formatDuration(ms: Long): String =
    if (ms < 1000) "${max(1, ms)}ms" else String.format(Locale.ROOT, "%.1fs", ms / 1000.0)

fun formatWait(ms: Long): String {
    val seconds = (ms / 1000.0).roundToLong()
    if (seconds < 60) return "${max(1, seconds)}s"
    val minutes = seconds / 60
    if (minutes < 60) return if (seconds % 60 != 0L) "${minutes}m ${seconds % 60}s" else "${minutes}m"
    return if (minutes % 60 != 0L) "${minutes / 60}h ${minutes % 60}m" else "${minutes / 60}h"
}

fun durationText(call: ToolCall): String? {
    val duration = call.durationMs ?: return null
    val waited = call.waitedMs?.takeIf { it > 0 }?.let { " · waited ${formatWait(it)} for you" }.orEmpty()
    return formatDuration(duration) + waited
}

sealed interface ToolStep {
    data class Single(val call: ToolCall, val index: Int) : ToolStep
    data class Group(val calls: List<ToolCall>, val index: Int) : ToolStep
}

fun toolSteps(calls: List<ToolCall>, readOnly: Boolean = false): List<ToolStep> {
    val steps = mutableListOf<ToolStep>()
    var run = mutableListOf<ToolCall>()
    var start = 0
    fun flush() {
        if (run.size >= 2) {
            steps.add(ToolStep.Group(run, start))
        } else {
            run.forEachIndexed { k, call -> steps.add(ToolStep.Single(call, start + k)) }
        }
        run = mutableListOf()
    }
    calls.forEachIndexed { i, call ->
        if (!viewOf(call, readOnly).foldable) {
            flush()
            steps.add(ToolStep.Single(call, i))
        } else {
            if (run.isEmpty()) start = i
            run.add(call)
        }
    }
    flush()
    return steps
}

fun describeCalls(calls: List<ToolCall>, labels: ToolLabels): String {
    val counts = LinkedHashMap<String, Int>()
    for (call in calls) {
        val label = if (call.name == "load_skill") "Used a skill" else toolLabel(labels, call.name)
        counts[label] = (counts[label] ?: 0) + 1
    }
    return counts.entries.mapIndexed { i, (label, n) ->
        val part = if (n > 1) "$label ×$n" else label
        if (i == 0) part else part.replaceFirstChar { it.lowercase(Locale.ROOT) }
    }.joinToString(", ")
}

data class GroupText(val title: String, val failed: String?, val duration: String?)

fun groupText(calls: List<ToolCall>, labels: ToolLabels): GroupText {
    val failed = calls.count { viewOf(it).phase == ToolPhase.Failed }
    val duration = calls.sumOf { it.durationMs ?: 0L }
    return GroupText(
        title = describeCalls(calls, labels),
        failed = if (failed > 0) "· $failed failed" else null,
        duration = if (duration > 0) formatDuration(duration) else null,
    )
}
