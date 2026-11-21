package groot.mobile.feature.chat

import androidx.compose.foundation.background
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import groot.kit.theme.S
import groot.mobile.data.chat.OutboxEntry
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
) {
    val canSend = enabled && (draft.isNotBlank() || staged.any { it.ref != null }) && staged.none { it.uploading }
    val showStop = busy && draft.isBlank() && staged.isEmpty()
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(S.sm)) {
        for (entry in held) HeldRow(entry, onWithdraw)
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
                    value = draft,
                    onValueChange = onDraftChange,
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
