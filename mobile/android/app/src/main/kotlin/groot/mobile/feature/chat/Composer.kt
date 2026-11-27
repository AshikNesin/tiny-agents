package groot.mobile.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import groot.kit.theme.S
import groot.mobile.data.chat.MentionCandidate
import groot.mobile.data.chat.MentionInsert
import groot.mobile.data.chat.MentionToken
import groot.mobile.data.chat.OutboxEntry
import groot.mobile.data.chat.activeMentionToken
import groot.mobile.data.chat.mentionMatches
import groot.mobile.data.api.Skill
import groot.mobile.data.chat.activeSkillQuery
import groot.mobile.data.chat.insertSkill
import groot.mobile.ui.components.BotAvatar
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.brand.Dims
import groot.mobile.ui.components.AppIcon
import groot.mobile.ui.components.DISABLED_ALPHA
import groot.mobile.ui.components.IconBtn

@Composable
fun Composer(
    draft: String,
    onDraftChange: (String) -> Unit,
    placeholder: String,
    busy: Boolean,
    enabled: Boolean,
    staged: List<StagedUpload>,
    held: List<OutboxEntry>,
    onAttach: () -> Unit,
    onRemoveStaged: (String) -> Unit,
    onSend: (whenBusy: String) -> Unit,
    onStop: () -> Unit,
    onWithdraw: (String) -> Unit,
    modifier: Modifier = Modifier,
    mentionCandidates: List<MentionCandidate> = emptyList(),
    onInsertMention: ((MentionToken, Int, MentionCandidate) -> MentionInsert)? = null,
    skills: List<Skill> = emptyList(),
) {
    var field by remember { mutableStateOf(TextFieldValue(draft, TextRange(draft.length))) }
    val value = if (field.text == draft) field else TextFieldValue(draft, TextRange(draft.length))
    var dismissedAt by remember { mutableStateOf<Int?>(null) }
    val token = if (onInsertMention != null && value.selection.collapsed) activeMentionToken(value.text, value.selection.start) else null
    val matches = token?.takeIf { it.start != dismissedAt }?.let { mentionMatches(mentionCandidates, it.query).take(MAX_MENTIONS) }.orEmpty()
    val skillQuery = if (skills.isNotEmpty() && value.selection.collapsed) activeSkillQuery(value.text, value.selection.start) else null
    val skillMatches = skillQuery?.takeIf { dismissedAt != SKILL_DISMISSED }?.let { q -> skills.filter { it.name.startsWith(q) }.take(MAX_MENTIONS) }.orEmpty()
    val canSend = enabled && (draft.isNotBlank() || staged.any { it.ref != null }) && staged.none { it.uploading }
    val showStop = busy && draft.isBlank() && staged.isEmpty()
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(S.sm)) {
        for (entry in held) HeldRow(entry, onWithdraw)
        if (token != null && matches.isNotEmpty() && onInsertMention != null) {
            MentionList(matches, onPick = { chosen ->
                val result = onInsertMention(token, value.selection.start, chosen)
                field = TextFieldValue(result.text, TextRange(result.caret))
            }, onDismiss = { dismissedAt = token.start })
        }
        if (skillMatches.isNotEmpty()) {
            SkillList(skillMatches, onPick = { chosen ->
                val result = insertSkill(value.text, value.selection.start, chosen.name)
                field = TextFieldValue(result.text, TextRange(result.caret))
                onDraftChange(result.text)
            }, onDismiss = { dismissedAt = SKILL_DISMISSED })
        }
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Dims.composerRadius))
                .background(MaterialTheme.colorScheme.surfaceContainer)
                .border(Dims.hairline, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(Dims.composerRadius)),
        ) {
            if (staged.isNotEmpty()) {
                Row(
                    Modifier.horizontalScroll(rememberScrollState()).padding(start = S.md, end = S.md, top = S.md),
                    horizontalArrangement = Arrangement.spacedBy(S.sm),
                ) {
                    for (upload in staged) StagedChip(upload, onRemove = { onRemoveStaged(upload.id) })
                }
            }
            Row(
                Modifier.fillMaxWidth().defaultMinSize(minHeight = Dims.composerMinHeight).padding(horizontal = S.sm, vertical = S.sm),
                verticalAlignment = Alignment.Bottom,
            ) {
                IconBtn(AppIcons.Paperclip, "Attach a file", onAttach, enabled = enabled, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                val style = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface)
                BasicTextField(
                    value = value,
                    onValueChange = { next ->
                        field = next
                        if (next.text != draft) onDraftChange(next.text)
                    },
                    enabled = enabled,
                    textStyle = style,
                    maxLines = MAX_LINES,
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                    modifier = Modifier.weight(1f).padding(horizontal = S.xs, vertical = S.sm),
                    decorationBox = { inner ->
                        Box(contentAlignment = Alignment.CenterStart) {
                            if (draft.isEmpty()) {
                                Text(placeholder, style = style, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            inner()
                        }
                    },
                )
                if (busy && canSend) {
                    IconBtn(AppIcons.Queue, "Queue for after this reply", onClick = { onSend("followUp") }, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                val active = showStop || canSend
                IconBtn(
                    icon = if (showStop) AppIcons.Stop else AppIcons.ArrowUp,
                    label = if (showStop) "Stop the reply" else if (busy) "Steer the reply" else "Send",
                    onClick = { if (showStop) onStop() else onSend("steer") },
                    enabled = active,
                    tint = MaterialTheme.colorScheme.onPrimary,
                    background = MaterialTheme.colorScheme.primary.copy(alpha = if (active) 1f else DISABLED_ALPHA),
                    modifier = Modifier.padding(S.xxs).size(Dims.sendButton),
                )
            }
        }
    }
}

@Composable
private fun MentionList(matches: List<MentionCandidate>, onPick: (MentionCandidate) -> Unit, onDismiss: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Dims.cardRadius))
            .background(MaterialTheme.colorScheme.surfaceContainerHigh),
    ) {
        Row(Modifier.fillMaxWidth().padding(start = S.md), verticalAlignment = Alignment.CenterVertically) {
            Text("Mention a bot", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
            IconBtn(AppIcons.Close, "Close suggestions", onDismiss, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for (bot in matches) {
            Row(
                Modifier.fillMaxWidth().clickable(role = Role.Button) { onPick(bot) }.padding(horizontal = S.md, vertical = S.sm),
                horizontalArrangement = Arrangement.spacedBy(S.md),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BotAvatar(bot.name)
                Text(bot.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

private const val SKILL_DISMISSED = -1

@Composable
private fun SkillList(matches: List<Skill>, onPick: (Skill) -> Unit, onDismiss: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Dims.cardRadius))
            .background(MaterialTheme.colorScheme.surfaceContainerHigh),
    ) {
        Row(Modifier.fillMaxWidth().padding(start = S.md), verticalAlignment = Alignment.CenterVertically) {
            Text("Use a skill", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
            IconBtn(AppIcons.Close, "Close suggestions", onDismiss, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for (skill in matches) {
            Row(
                Modifier.fillMaxWidth().clickable(role = Role.Button) { onPick(skill) }.padding(horizontal = S.md, vertical = S.sm),
                horizontalArrangement = Arrangement.spacedBy(S.md),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                AppIcon(AppIcons.Sparkle, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, size = Dims.iconSmall)
                Column(Modifier.weight(1f)) {
                    Text(skill.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (skill.description.isNotBlank()) {
                        Text(skill.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}

@Composable
private fun HeldRow(entry: OutboxEntry, onWithdraw: (String) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Dims.cardRadius))
            .background(MaterialTheme.colorScheme.surfaceContainerLow)
            .padding(start = S.lg),
        horizontalArrangement = Arrangement.spacedBy(S.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AppIcon(AppIcons.Queue, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, size = Dims.iconSmall)
        Column(Modifier.weight(1f).padding(vertical = S.sm)) {
            Text(
                if (entry.state == OutboxEntry.State.Steering) "Joins this reply" else "Queued for the next reply",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                entry.text.ifBlank { "${entry.attachments.size} attachment(s)" },
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        IconBtn(AppIcons.Close, "Cancel this message", onClick = { onWithdraw(entry.requestId) }, iconSize = Dims.iconSmall)
    }
}

private const val MAX_LINES = 6
private const val MAX_MENTIONS = 5
