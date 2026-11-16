package groot.mobile.feature.code

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import groot.kit.theme.S
import groot.mobile.data.api.ApprovalRequest
import groot.mobile.data.api.TranscriptItem
import groot.mobile.data.code.CodeDisplayItem
import groot.mobile.data.code.DiffLine
import groot.mobile.data.code.describeTools
import groot.mobile.data.code.durationText
import groot.mobile.data.code.parseUnifiedDiff
import groot.mobile.data.code.turnLine
import groot.mobile.feature.chat.QuietLine
import groot.mobile.feature.chat.UserBubble
import groot.mobile.ui.brand.Accents
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.brand.Dims
import groot.mobile.ui.components.AppCard
import groot.mobile.ui.components.AppIcon
import groot.mobile.ui.components.Chip
import groot.mobile.ui.components.Field
import groot.mobile.ui.components.Markdown
import groot.mobile.ui.components.PrimaryButton
import groot.mobile.ui.components.SecondaryButton

/** What a transcript row can ask of the screen. */
class CodeRowActions(
    val readOnly: Boolean,
    /** The id of the error notice that offers recovery (nothing came after it). */
    val recoverableId: String?,
    val recovery: List<String>,
    val onAllow: (requestId: String, allow: Boolean) -> Unit,
    val onAnswer: (requestId: String, answers: Map<String, String>) -> Unit,
    val onRecover: (String) -> Unit,
    val onOpenThread: (String) -> Unit,
)

/** One row of the transcript, or a folded run of tool calls. */
@Composable
fun CodeRow(item: CodeDisplayItem, actions: CodeRowActions, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(vertical = S.xs)) {
        when (item) {
            is CodeDisplayItem.Group -> ToolGroup(item, actions)
            is CodeDisplayItem.Row -> when (val row = item.item) {
                is TranscriptItem.User -> UserBubble(
                    text = row.text,
                    attachments = emptyList(),
                    author = null,
                    onOpenImage = {},
                    onSaveFile = {},
                    footnote = attachmentNote(row.attachments.size),
                )
                is TranscriptItem.Assistant -> Markdown(row.text)
                is TranscriptItem.Thinking -> Thinking(row.text, live = false)
                is TranscriptItem.Report -> Labelled("From ${row.from}") { Markdown(row.text) }
                is TranscriptItem.Job -> QuietLine(row.text + (row.exitCode?.let { " (exit $it)" } ?: ""))
                is TranscriptItem.Notice -> NoticeRow(row, actions)
                is TranscriptItem.Turn -> turnLine(row)?.let { QuietLine(it) }
                is TranscriptItem.Request -> RequestCard(row, actions)
                is TranscriptItem.Tool -> ToolRow(row, actions)
            }
        }
    }
}

private fun attachmentNote(count: Int): String? = when (count) {
    0 -> null
    1 -> "1 attachment"
    else -> "$count attachments"
}

@Composable
private fun Labelled(label: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(S.xs)) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        content()
    }
}

/** Thinking: one muted line, open for the whole text. Live thinking shows its last lines. */
@Composable
fun Thinking(text: String, live: Boolean) {
    var open by rememberSaveable { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClickLabel = if (open) "Hide thinking" else "Show thinking") { open = !open },
        verticalArrangement = Arrangement.spacedBy(S.xs),
    ) {
        Text(if (live) "Thinking…" else "Thought", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (open || live) {
            Text(
                if (open) text else text.lines().takeLast(LIVE_THINKING_LINES).joinToString("\n"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** An error, warning or note from the harness; the last error offers Retry, Resume or Continue. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NoticeRow(notice: TranscriptItem.Notice, actions: CodeRowActions) {
    val color = when (notice.level) {
        "error" -> MaterialTheme.colorScheme.error
        "warning" -> Accents.warning
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Dims.fieldRadius))
            .background(MaterialTheme.colorScheme.surfaceContainerLow)
            .padding(S.md),
        verticalArrangement = Arrangement.spacedBy(S.sm),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(S.sm)) {
            AppIcon(if (notice.level == "info") AppIcons.Info else AppIcons.Alert, null, tint = color, size = Dims.iconSmall)
            Text(notice.text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
        }
        if (notice.code == "usage_limit" && notice.resetsAt != null) {
            Text("Resets at ${notice.resetsAt}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (!actions.readOnly && notice.id == actions.recoverableId && actions.recovery.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm)) {
                for (action in actions.recovery) {
                    SecondaryButton(action.replaceFirstChar { it.uppercase() }, onClick = { actions.onRecover(action) }, icon = AppIcons.Refresh)
                }
            }
        }
    }
}

/** A run of finished tool calls as one line: "Ran 3 commands, edited 2 files"; open, each call. */
@Composable
private fun ToolGroup(group: CodeDisplayItem.Group, actions: CodeRowActions) {
    var open by rememberSaveable(group.key) { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(S.xs)) {
        Row(
            Modifier.fillMaxWidth().clickable(role = Role.Button) { open = !open }.padding(vertical = S.xs),
            horizontalArrangement = Arrangement.spacedBy(S.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AppIcon(if (open) AppIcons.ChevronDown else AppIcons.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, size = Dims.iconSmall)
            Text(describeTools(group.tools), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (open) {
            Column(Modifier.padding(start = S.lg), verticalArrangement = Arrangement.spacedBy(S.xs)) {
                for (item in group.items) {
                    when (item) {
                        is TranscriptItem.Tool -> ToolRow(item, actions)
                        is TranscriptItem.Thinking -> Thinking(item.text, live = false)
                        else -> Unit
                    }
                }
            }
        }
    }
}

/** One tool call: its gist on a line; open, its command, output, exit code or diff. */
@Composable
private fun ToolRow(tool: TranscriptItem.Tool, actions: CodeRowActions) {
    var open by rememberSaveable(tool.id) { mutableStateOf(false) }
    val running = tool.status == "running"
    Column(verticalArrangement = Arrangement.spacedBy(S.xs)) {
        Row(
            Modifier.fillMaxWidth().clickable(role = Role.Button) { open = !open }.padding(vertical = S.xs),
            horizontalArrangement = Arrangement.spacedBy(S.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val tint = when (tool.status) {
                "error", "denied" -> MaterialTheme.colorScheme.error
                "running" -> Accents.warning
                else -> MaterialTheme.colorScheme.onSurfaceVariant
            }
            AppIcon(toolIcon(tool.tool), null, tint = tint, size = Dims.iconSmall)
            Text(
                toolTitle(tool),
                style = MaterialTheme.typography.bodyMedium,
                fontFamily = if (tool.tool == "bash") FontFamily.Monospace else null,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            val trailing = listOfNotNull(
                tool.diff?.let { diffStat(it) },
                tool.exitCode?.takeIf { it != 0 }?.let { "exit $it" },
                if (running) "running" else tool.durationMs?.let(::durationText),
                "denied".takeIf { tool.status == "denied" },
            ).joinToString(" · ")
            if (trailing.isNotEmpty()) Text(trailing, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (tool.tool == "todo" && tool.input.isNotBlank()) TodoList(tool.input)
        if (tool.childThreadId != null) {
            SecondaryButton("Open ${tool.childTitle ?: "subagent"}", onClick = { actions.onOpenThread(tool.childThreadId) }, icon = AppIcons.ChevronRight)
        }
        if (open || (running && tool.live && !tool.output.isNullOrBlank())) {
            if (open && tool.tool != "todo" && tool.input.isNotBlank() && tool.input != tool.summary) CodeBlock(tool.input, maxLines = if (open) MAX_OPEN_LINES else 3)
            if (tool.diff != null) {
                DiffView(parseUnifiedDiff(tool.diff), maxLines = MAX_OPEN_LINES)
            } else if (!tool.output.isNullOrBlank()) {
                val output = if (open) tool.output else tool.output.lines().takeLast(LIVE_OUTPUT_LINES).joinToString("\n")
                CodeBlock(output, maxLines = if (open) MAX_OPEN_LINES else LIVE_OUTPUT_LINES)
            }
        }
    }
}

private fun toolTitle(tool: TranscriptItem.Tool): String {
    val gist = tool.diffPath ?: tool.summary.ifBlank { tool.name }
    return when (tool.tool) {
        "bash" -> "$ $gist"
        "edit" -> "Edit $gist"
        "read" -> "Read $gist"
        "search" -> "Search $gist"
        "web" -> "Web $gist"
        "subagent" -> "Subagent: $gist"
        "message_user", "message_parent" -> gist
        "todo" -> "Plan"
        else -> if (gist == tool.name) gist else "${tool.name}: $gist"
    }
}

private fun toolIcon(kind: String) = when (kind) {
    "bash" -> AppIcons.Terminal
    "edit" -> AppIcons.Pencil
    "read" -> AppIcons.File
    "search" -> AppIcons.Search
    "web", "browser" -> AppIcons.Globe
    "image" -> AppIcons.Image
    "todo" -> AppIcons.Tasks
    "subagent" -> AppIcons.Users
    "mcp" -> AppIcons.Plug
    else -> AppIcons.Code
}

private fun diffStat(diff: String): String {
    val lines = parseUnifiedDiff(diff)
    return "+${lines.count { it.kind == DiffLine.Kind.Added }} −${lines.count { it.kind == DiffLine.Kind.Removed }}"
}

/** Claude Code's TodoWrite as a checklist. */
@Composable
private fun TodoList(input: String) {
    val todos = remember(input) {
        runCatching {
            val array = org.json.JSONObject(input).optJSONArray("todos") ?: return@runCatching emptyList()
            (0 until array.length()).mapNotNull { array.optJSONObject(it) }.map { it.optString("content") to it.optString("status") }
        }.getOrDefault(emptyList())
    }
    Column(Modifier.padding(start = S.lg), verticalArrangement = Arrangement.spacedBy(S.xxs)) {
        for ((content, status) in todos) {
            Row(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalAlignment = Alignment.CenterVertically) {
                AppIcon(
                    if (status == "completed") AppIcons.Check else if (status == "in_progress") AppIcons.Play else AppIcons.ChevronRight,
                    null,
                    tint = if (status == "in_progress") MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                    size = Dims.iconSmall,
                )
                Text(
                    content,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (status == "completed") MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                    fontWeight = if (status == "in_progress") FontWeight.SemiBold else null,
                )
            }
        }
    }
}

/** Monospace text in a quiet box that scrolls sideways. */
@Composable
fun CodeBlock(text: String, modifier: Modifier = Modifier, maxLines: Int = Int.MAX_VALUE) {
    SelectionContainer {
        Text(
            text,
            style = MaterialTheme.typography.bodySmall,
            fontFamily = FontFamily.Monospace,
            maxLines = maxLines,
            overflow = TextOverflow.Ellipsis,
            softWrap = false,
            modifier = modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Dims.fieldRadius))
                .background(MaterialTheme.colorScheme.surfaceContainerLow)
                .horizontalScroll(rememberScrollState())
                .padding(S.sm),
        )
    }
}

/** Diff lines: removed in red, added in green, gaps as muted dividers. Scrolls sideways. */
@Composable
fun DiffView(lines: List<DiffLine>, modifier: Modifier = Modifier, maxLines: Int = Int.MAX_VALUE, onLongPress: ((DiffLine) -> Unit)? = null) {
    val added = Accents.success.copy(alpha = DIFF_TINT)
    val removed = MaterialTheme.colorScheme.error.copy(alpha = DIFF_TINT)
    val shown = if (lines.size > maxLines) lines.take(maxLines) else lines
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Dims.fieldRadius))
            .background(MaterialTheme.colorScheme.surfaceContainerLow)
            .horizontalScroll(rememberScrollState())
            .padding(vertical = S.xs),
    ) {
        for (line in shown) DiffRow(line, if (line.kind == DiffLine.Kind.Added) added else if (line.kind == DiffLine.Kind.Removed) removed else Color.Transparent, onLongPress)
        if (lines.size > shown.size) {
            Text("${lines.size - shown.size} more lines", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = S.sm))
        }
    }
}

@Composable
private fun DiffRow(line: DiffLine, background: Color, onLongPress: ((DiffLine) -> Unit)?) {
    val number = (line.newLine ?: line.oldLine)?.toString().orEmpty()
    val sign = when (line.kind) {
        DiffLine.Kind.Added -> "+"
        DiffLine.Kind.Removed -> "-"
        else -> " "
    }
    Row(
        Modifier
            .background(background)
            .then(if (onLongPress != null && line.kind != DiffLine.Kind.Gap) Modifier.clickable(role = Role.Button, onClickLabel = "Comment") { onLongPress(line) } else Modifier)
            .padding(horizontal = S.sm),
    ) {
        if (line.kind == DiffLine.Kind.Gap) {
            Text(line.text, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = S.xxs))
        } else {
            Text(
                number.padStart(LINE_NUMBER_WIDTH) + " " + sign + " " + line.text,
                style = MaterialTheme.typography.bodySmall,
                fontFamily = FontFamily.Monospace,
                softWrap = false,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

/** An approval (Allow / Deny) or the harness's questions; once answered, one line says how. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RequestCard(row: TranscriptItem.Request, actions: CodeRowActions) {
    val open = row.status == "open" && !actions.readOnly
    if (!open) {
        val gist = when (val request = row.request) {
            is ApprovalRequest.Tool -> request.summary.ifBlank { request.name }
            is ApprovalRequest.Questions -> request.questions.firstOrNull()?.question.orEmpty()
        }
        QuietLine("${row.status.replaceFirstChar { it.uppercase() }}: $gist")
        return
    }
    AppCard(Modifier.border(Dims.hairline, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(Dims.cardRadius))) {
        Column(verticalArrangement = Arrangement.spacedBy(S.md)) {
            when (val request = row.request) {
                is ApprovalRequest.Tool -> {
                    Text("Allow ${request.name}?", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                    request.reason?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    CodeBlock(request.summary.ifBlank { request.input }, maxLines = 12)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
                        PrimaryButton("Allow", onClick = { actions.onAllow(row.id, true) })
                        SecondaryButton("Deny", onClick = { actions.onAllow(row.id, false) })
                    }
                }
                is ApprovalRequest.Questions -> QuestionsForm(row.id, request, actions)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun QuestionsForm(requestId: String, request: ApprovalRequest.Questions, actions: CodeRowActions) {
    val picked = remember(requestId) { mutableStateMapOf<String, Set<String>>() }
    val typed = remember(requestId) { mutableStateMapOf<String, String>() }
    for (question in request.questions) {
        Column(verticalArrangement = Arrangement.spacedBy(S.sm)) {
            question.header?.let { Text(it.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            Text(question.question, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
                for ((label, _) in question.options) {
                    val chosen = picked[question.question].orEmpty()
                    Chip(label, selected = label in chosen, onClick = {
                        picked[question.question] = when {
                            label in chosen -> chosen - label
                            question.multiSelect -> chosen + label
                            else -> setOf(label)
                        }
                    })
                }
            }
            question.options.firstOrNull { it.first in picked[question.question].orEmpty() }?.second?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Field(typed[question.question].orEmpty(), { typed[question.question] = it }, placeholder = "Or type an answer")
        }
    }
    val answers = request.questions.associate { q ->
        q.question to (typed[q.question]?.trim()?.takeIf { it.isNotEmpty() } ?: picked[q.question].orEmpty().joinToString(", "))
    }
    PrimaryButton("Send", enabled = answers.values.all { it.isNotEmpty() }, onClick = { actions.onAnswer(requestId, answers) })
}

private const val LIVE_THINKING_LINES = 3
private const val LIVE_OUTPUT_LINES = 6
private const val MAX_OPEN_LINES = 400
private const val LINE_NUMBER_WIDTH = 4
private const val DIFF_TINT = 0.18f
