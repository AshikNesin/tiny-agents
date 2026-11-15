package groot.mobile.feature.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import groot.kit.theme.S
import groot.mobile.data.api.OwnerAnswer
import groot.mobile.data.api.OwnerQuestion
import groot.mobile.data.api.ToolCall
import groot.mobile.data.chat.ToolCard
import groot.mobile.data.chat.ToolLabels
import groot.mobile.data.chat.ToolPhase
import groot.mobile.data.chat.ToolStep
import groot.mobile.data.chat.approvalNote
import groot.mobile.data.chat.approvalText
import groot.mobile.data.chat.argSummary
import groot.mobile.data.chat.credentialRequestText
import groot.mobile.data.chat.durationText
import groot.mobile.data.chat.groupText
import groot.mobile.data.chat.stepTitle
import groot.mobile.data.chat.toolSteps
import groot.mobile.data.chat.vaultApprovalText
import groot.mobile.data.chat.viewOf
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.brand.Dims
import groot.mobile.ui.components.AppCard
import groot.mobile.ui.components.AppIcon
import groot.mobile.ui.components.Chip
import groot.mobile.ui.components.Field
import groot.mobile.ui.components.PrimaryButton
import groot.mobile.ui.components.SecondaryButton

/** What a transcript's cards can do; a past chat passes [readOnly] and no handlers fire. */
class ChatActions(
    val botName: String,
    val labels: ToolLabels,
    /** Tools that can never be set to "always allow". */
    val askOnlyTools: Set<String>,
    val readOnly: Boolean,
    val now: () -> Long,
    val onDecide: (taskId: Int, approved: Boolean, alwaysAllow: String?, grant: Boolean) -> Unit,
    val onAnswer: (taskId: Int, answers: List<OwnerAnswer>?) -> Unit,
    val onOpenCredentials: (ToolCall) -> Unit,
    val onCancelCredentials: (taskId: Int) -> Unit,
    val onOpenComputer: () -> Unit,
    val onOpenLink: (String) -> Unit,
)

/** A message's tool calls: cards for what waits on the owner, quiet trace lines for the rest. */
@Composable
fun ToolSteps(calls: List<ToolCall>, actions: ChatActions, modifier: Modifier = Modifier) {
    val steps = remember(calls, actions.readOnly) { toolSteps(calls, actions.readOnly) }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(S.xs)) {
        for (step in steps) {
            when (step) {
                is ToolStep.Single -> ToolStepRow(step.call, actions)
                is ToolStep.Group -> ToolGroupRow(step.calls, actions)
            }
        }
    }
}

@Composable
private fun ToolStepRow(call: ToolCall, actions: ChatActions) {
    val view = viewOf(call, actions.readOnly)
    when (view.card) {
        ToolCard.Approval -> ApprovalCard(call, actions)
        ToolCard.VaultApproval -> VaultApprovalCard(call, actions)
        ToolCard.Credentials -> CredentialsCard(call, actions)
        ToolCard.Takeover -> TakeoverCard(call, actions)
        ToolCard.Question -> QuestionCard(call, actions)
        ToolCard.AskedQuestions -> AskedQuestions(call, view.note)
        ToolCard.BotHandoff -> TraceLine(
            call = call,
            title = "Messaged ${(call.args["to"] as? String) ?: (call.args["bot"] as? String) ?: "another bot"}",
            actions = actions,
        )
        ToolCard.CodeHandoff -> CodeHandoffCard(call, actions)
        null -> TraceLine(call, stepTitle(call, actions.labels), actions)
    }
}

/** One quiet line per call: a status mark, what it did, how it went. Tap to read its output. */
@Composable
private fun TraceLine(call: ToolCall, title: String, actions: ChatActions) {
    val view = viewOf(call, actions.readOnly)
    var open by rememberSaveable(call.id, call.name) { mutableStateOf(false) }
    val note = approvalNote(view.note, call.approval)
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Column(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .clip(RoundedCornerShape(Dims.fieldRadius))
                .clickable(enabled = call.output != null, role = Role.Button, onClickLabel = "Show output") { open = !open }
                .padding(vertical = S.xs),
            horizontalArrangement = Arrangement.spacedBy(S.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            when (view.phase) {
                ToolPhase.Pending, ToolPhase.Running ->
                    CircularProgressIndicator(Modifier.size(Dims.iconSmall), color = muted, strokeWidth = Dims.stroke)
                ToolPhase.Waiting -> AppIcon(AppIcons.Clock, null, tint = muted, size = Dims.iconSmall)
                ToolPhase.Done -> AppIcon(AppIcons.Check, null, tint = muted, size = Dims.iconSmall)
                ToolPhase.Failed -> AppIcon(
                    if (call.status.wire == "error") AppIcons.Alert else AppIcons.Ban,
                    null,
                    tint = if (call.status.wire == "error") MaterialTheme.colorScheme.error else muted,
                    size = Dims.iconSmall,
                )
            }
            Text(
                text = listOfNotNull(title, note, durationText(call)).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                color = muted,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            if (call.output != null) {
                AppIcon(if (open) AppIcons.ChevronUp else AppIcons.ChevronDown, null, tint = muted, size = Dims.iconSmall)
            }
        }
        AnimatedVisibility(open && call.output != null) {
            Text(
                call.output.orEmpty(),
                style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                color = muted,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(Dims.fieldRadius))
                    .background(MaterialTheme.colorScheme.surfaceContainer)
                    .padding(S.md),
            )
        }
    }
}

/** A run of finished calls folded into one line; tap to see each. */
@Composable
private fun ToolGroupRow(calls: List<ToolCall>, actions: ChatActions) {
    var open by rememberSaveable(calls.size, calls.firstOrNull()?.id) { mutableStateOf(false) }
    val text = groupText(calls, actions.labels)
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Column(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .clip(RoundedCornerShape(Dims.fieldRadius))
                .clickable(role = Role.Button, onClickLabel = "Show steps") { open = !open }
                .padding(vertical = S.xs),
            horizontalArrangement = Arrangement.spacedBy(S.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AppIcon(AppIcons.Check, null, tint = muted, size = Dims.iconSmall)
            Text(
                listOfNotNull(listOfNotNull(text.title, text.failed).joinToString(" "), text.duration).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                color = muted,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            AppIcon(if (open) AppIcons.ChevronUp else AppIcons.ChevronDown, null, tint = muted, size = Dims.iconSmall)
        }
        AnimatedVisibility(open) {
            Column(Modifier.padding(start = S.lg)) {
                for (call in calls) TraceLine(call, stepTitle(call, actions.labels), actions)
            }
        }
    }
}

@Composable
private fun CardFrame(content: @Composable () -> Unit) {
    AppCard(
        modifier = Modifier
            .padding(vertical = S.xs)
            .border(Dims.hairline, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(Dims.cardRadius)),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(S.md)) { content() }
    }
}

@Composable
private fun CardTitle(text: String) {
    Text(text, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
}

@Composable
private fun CardBody(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ApprovalCard(call: ToolCall, actions: ChatActions) {
    val taskId = call.taskId ?: return
    val text = remember(call, actions.botName, actions.labels) { approvalText(call, actions.botName, actions.labels) }
    var expanded by rememberSaveable(taskId) { mutableStateOf(false) }
    CardFrame {
        CardTitle(text.title)
        for (fact in text.facts) {
            Column {
                Text(fact.label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(fact.value, style = MaterialTheme.typography.bodyMedium)
            }
        }
        if (text.foldedPayload != null) {
            Text(
                text.foldedPayload,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = if (expanded) Int.MAX_VALUE else 4,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                if (expanded) "Show less" else "Read more",
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.clickable(role = Role.Button) { expanded = !expanded },
            )
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
            PrimaryButton("Approve", onClick = { actions.onDecide(taskId, true, null, false) })
            SecondaryButton("Deny", onClick = { actions.onDecide(taskId, false, null, false) })
            if (call.name !in actions.askOnlyTools) {
                SecondaryButton("Always allow", onClick = { actions.onDecide(taskId, true, call.name, false) })
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun VaultApprovalCard(call: ToolCall, actions: ChatActions) {
    val taskId = call.taskId ?: return
    val vault = call.vault ?: return
    val text = remember(call, actions.botName) { vaultApprovalText(call, actions.botName, actions.now()) }
    CardFrame {
        Row(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalAlignment = Alignment.CenterVertically) {
            AppIcon(AppIcons.Key, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Vault", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        CardTitle(text.title)
        if (text.command != null) {
            Text(
                text.command,
                style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(Dims.fieldRadius))
                    .background(MaterialTheme.colorScheme.surfaceContainerHigh)
                    .horizontalScroll(rememberScrollState())
                    .padding(S.md),
            )
        }
        CardBody(text.description)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
            PrimaryButton("Approve", onClick = { actions.onDecide(taskId, true, null, false) })
            SecondaryButton("Deny", onClick = { actions.onDecide(taskId, false, null, false) })
            if (vault.grantable) {
                SecondaryButton("For this chat", onClick = { actions.onDecide(taskId, true, null, true) })
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CredentialsCard(call: ToolCall, actions: ChatActions) {
    val taskId = call.taskId ?: return
    val (title, description) = remember(call, actions.botName) { credentialRequestText(call, actions.botName, actions.now()) }
    CardFrame {
        CardTitle(title)
        CardBody(description)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
            PrimaryButton("Sign in", onClick = { actions.onOpenCredentials(call) }, icon = AppIcons.Lock)
            SecondaryButton("Not now", onClick = { actions.onCancelCredentials(taskId) })
        }
    }
}

@Composable
private fun TakeoverCard(call: ToolCall, actions: ChatActions) {
    val takeover = call.takeover ?: return
    CardFrame {
        CardTitle("${actions.botName} needs you on the computer")
        CardBody(takeover.reason)
        PrimaryButton("Open the computer", onClick = actions.onOpenComputer, icon = AppIcons.Monitor)
    }
}

@Composable
private fun CodeHandoffCard(call: ToolCall, actions: ChatActions) {
    val code = call.code ?: return
    CardFrame {
        Row(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalAlignment = Alignment.CenterVertically) {
            AppIcon(AppIcons.Code, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Handed to ${code.harness}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        CardTitle(code.title ?: argSummary(call).ifEmpty { "Coding task" })
        if (code.cwd != null) CardBody(code.cwd)
        SecondaryButton("Open in the web app", onClick = { actions.onOpenLink(code.url) }, icon = AppIcons.External)
    }
}

/** A bot's questions: options to pick, a line for the owner's own words, then Send or Dismiss. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun QuestionCard(call: ToolCall, actions: ChatActions) {
    val taskId = call.taskId ?: return
    val questions = call.questions ?: return
    val selected = remember(taskId) { questions.map { mutableStateListOf<String>() } }
    val texts = remember(taskId) { mutableStateListOf<String>().apply { repeat(questions.size) { add("") } } }
    CardFrame {
        Text("${actions.botName} asks", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        questions.forEachIndexed { index, question ->
            QuestionBlock(
                question = question,
                selected = selected[index],
                onToggle = { label ->
                    val picks = selected[index]
                    when {
                        label in picks -> picks.remove(label)
                        question.multiple -> picks.add(label)
                        else -> {
                            picks.clear()
                            picks.add(label)
                        }
                    }
                },
                text = texts[index],
                onText = { texts[index] = it },
            )
        }
        val answered = selected.any { it.isNotEmpty() } || texts.any { it.isNotBlank() }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
            PrimaryButton(
                "Send answers",
                enabled = answered,
                onClick = {
                    actions.onAnswer(taskId, questions.indices.map { OwnerAnswer(selected[it].toList(), texts[it].trim().ifEmpty { null }) })
                },
            )
            SecondaryButton("Dismiss", onClick = { actions.onAnswer(taskId, null) })
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun QuestionBlock(question: OwnerQuestion, selected: List<String>, onToggle: (String) -> Unit, text: String, onText: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(S.sm)) {
        CardTitle(question.question)
        if (question.description != null) CardBody(question.description)
        if (question.options.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
                for (option in question.options) {
                    Chip(option.label, onClick = { onToggle(option.label) }, selected = option.label in selected)
                }
            }
            if (question.multiple) CardBody("Pick any that apply.")
        }
        Field(
            value = text,
            onValueChange = onText,
            placeholder = if (question.options.isEmpty()) "Your answer" else "Or in your own words",
            singleLine = false,
            maxLines = 4,
        )
    }
}

/** Questions that no longer wait: what was asked and what the owner said. */
@Composable
private fun AskedQuestions(call: ToolCall, note: String?) {
    val questions = call.questions ?: return
    CardFrame {
        questions.forEachIndexed { index, question ->
            Column {
                Text(question.question, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                val answer = call.answers?.getOrNull(index)
                val said = answer?.let { (it.selected + listOfNotNull(it.text)).filter { part -> part.isNotBlank() }.joinToString(", ") }.orEmpty()
                Text(
                    said.ifEmpty { if (call.answers != null) "Skipped" else note ?: "Not answered" },
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
