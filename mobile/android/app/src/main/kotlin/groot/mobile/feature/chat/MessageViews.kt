package groot.mobile.feature.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import groot.kit.theme.S
import groot.mobile.data.api.AttachmentRef
import groot.mobile.data.api.ChatMessage
import groot.mobile.data.api.MessageRole
import groot.mobile.data.api.MessageStatus
import groot.mobile.data.chat.OutboxEntry
import groot.mobile.data.chat.ownerText
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.brand.Dims
import groot.mobile.ui.components.AppIcon
import groot.mobile.ui.components.BotAvatar
import groot.mobile.ui.components.IconBtn
import groot.mobile.ui.components.Markdown
import groot.mobile.ui.components.StatusDot
import java.net.URI

/** One transcript message, by role: the owner's bubble, the bot's reply, or a marker line. */
@Composable
fun MessageView(
    message: ChatMessage,
    actions: ChatActions,
    onOpenImage: (AttachmentRef) -> Unit,
    onSaveFile: (AttachmentRef) -> Unit,
    onCopy: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    when (message.role) {
        MessageRole.User ->
            if (message.peer != null) {
                PeerMessage(message, modifier)
            } else {
                UserBubble(
                    text = ownerText(message.text, message.attachments.isNotEmpty()),
                    attachments = message.attachments,
                    author = message.author?.name,
                    onOpenImage = onOpenImage,
                    onSaveFile = onSaveFile,
                    modifier = modifier,
                )
            }
        MessageRole.Assistant -> AssistantMessage(message, actions, onCopy, modifier)
        MessageRole.Marker -> QuietLine("Earlier messages were summarized to make room", modifier)
    }
}

/** The owner's message: a rounded bubble on the right, attachments above it. */
@Composable
fun UserBubble(
    text: String,
    attachments: List<AttachmentRef>,
    author: String?,
    onOpenImage: (AttachmentRef) -> Unit,
    onSaveFile: (AttachmentRef) -> Unit,
    modifier: Modifier = Modifier,
    footnote: String? = null,
    faded: Boolean = false,
) {
    Column(
        modifier = modifier.fillMaxWidth().alpha(if (faded) FADED else 1f),
        horizontalAlignment = Alignment.End,
        verticalArrangement = Arrangement.spacedBy(S.xs),
    ) {
        if (author != null) {
            Text(author, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (attachments.isNotEmpty()) MessageAttachments(attachments, onOpenImage, onSaveFile, alignEnd = true)
        if (text.isNotBlank()) {
            Box(
                Modifier
                    .widthIn(max = Dims.bubbleMaxWidth)
                    .clip(RoundedCornerShape(Dims.bubbleRadius))
                    .background(MaterialTheme.colorScheme.surfaceContainer)
                    .padding(horizontal = S.lg, vertical = S.md),
            ) {
                Text(text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurface)
            }
        }
        if (footnote != null) {
            Text(footnote, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** A message another bot delivered into this chat. */
@Composable
private fun PeerMessage(message: ChatMessage, modifier: Modifier) {
    val peer = message.peer ?: return
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(S.xs)) {
        Row(horizontalArrangement = Arrangement.spacedBy(S.xs), verticalAlignment = Alignment.CenterVertically) {
            BotAvatar(peer.name, size = Dims.icon)
            Text(
                when (peer.kind) {
                    "reply" -> "${peer.name} replied"
                    "mention" -> "Mentioned in ${peer.name}'s chat"
                    else -> "From ${peer.name}"
                },
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Box(
            Modifier
                .clip(RoundedCornerShape(Dims.cardRadius))
                .background(MaterialTheme.colorScheme.surfaceContainerLow)
                .padding(S.md),
        ) {
            Markdown(message.text, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** The bot's reply: its thinking and tool steps as quiet lines, then the answer, full width. */
@Composable
private fun AssistantMessage(message: ChatMessage, actions: ChatActions, onCopy: (String) -> Unit, modifier: Modifier) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(S.sm)) {
        if (!message.reasoning.isNullOrBlank()) Reasoning(message.reasoning, live = message.status == MessageStatus.Streaming && message.text.isEmpty())
        if (message.toolCalls.isNotEmpty()) ToolSteps(message.toolCalls, actions)
        if (message.text.isNotBlank()) Markdown(message.text)
        val sources = message.toolCalls.flatMap { it.sources }.distinctBy { it.url }
        if (sources.isNotEmpty() && message.status != MessageStatus.Streaming) {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(S.sm)) {
                for (source in sources.take(MAX_SOURCES)) {
                    val host = runCatching { URI(source.url).host?.removePrefix("www.") }.getOrNull() ?: source.url
                    Column(
                        Modifier
                            .widthIn(max = Dims.thumbnail * 2.5f)
                            .clip(RoundedCornerShape(Dims.fieldRadius))
                            .background(MaterialTheme.colorScheme.surfaceContainer)
                            .clickable(role = Role.Button, onClickLabel = "Open $host") { actions.onOpenLink(source.url) }
                            .padding(horizontal = S.md, vertical = S.sm),
                    ) {
                        Text(source.title.ifBlank { host }, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(host, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
        when (message.status) {
            MessageStatus.Error, MessageStatus.Unanswered -> Row(horizontalArrangement = Arrangement.spacedBy(S.sm)) {
                AppIcon(AppIcons.Alert, null, tint = MaterialTheme.colorScheme.error, size = Dims.iconSmall)
                Text(
                    message.error ?: if (message.status == MessageStatus.Unanswered) "The bot did not answer." else "The reply failed.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            MessageStatus.Stopped -> Text("Stopped", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            MessageStatus.Done -> if (message.text.isNotBlank()) {
                IconBtn(
                    AppIcons.Copy,
                    "Copy reply",
                    onClick = { onCopy(message.text) },
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    iconSize = Dims.iconSmall,
                    modifier = Modifier.size(Dims.sendButton),
                )
            }
            MessageStatus.Streaming -> Unit
        }
    }
}

/** The model's thinking, folded to one line unless it is all there is to show right now. */
@Composable
private fun Reasoning(text: String, live: Boolean) {
    var open by rememberSaveable { mutableStateOf(false) }
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Column {
        Row(
            Modifier.clip(RoundedCornerShape(Dims.fieldRadius)).clickable(role = Role.Button) { open = !open }.padding(vertical = S.xs),
            horizontalArrangement = Arrangement.spacedBy(S.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AppIcon(AppIcons.Sparkle, null, tint = muted, size = Dims.iconSmall)
            Text(if (live) "Thinking" else "Thought", style = MaterialTheme.typography.bodySmall, color = muted)
            AppIcon(if (open) AppIcons.ChevronUp else AppIcons.ChevronDown, null, tint = muted, size = Dims.iconSmall)
        }
        AnimatedVisibility(open || live) {
            Text(
                text.trim(),
                style = MaterialTheme.typography.bodySmall,
                color = muted,
                maxLines = if (open) Int.MAX_VALUE else LIVE_REASONING_LINES,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(start = S.xl),
            )
        }
    }
}

/** An owner message the transcript does not hold yet: sending, or waiting for the network. */
@Composable
fun EchoBubble(echo: OutboxEntry, onOpenImage: (AttachmentRef) -> Unit, onSaveFile: (AttachmentRef) -> Unit) {
    UserBubble(
        text = echo.text,
        attachments = echo.attachments,
        author = null,
        onOpenImage = onOpenImage,
        onSaveFile = onSaveFile,
        footnote = if (echo.state == OutboxEntry.State.Offline) "Waiting for the connection" else "Sending",
        faded = true,
    )
}

/** A centred, muted line between messages: a marker, the "New messages" divider. */
@Composable
fun QuietLine(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        modifier = modifier.fillMaxWidth().padding(vertical = S.sm),
    )
}

/** Three dots pulsing in turn: the bot is working with nothing on screen to show it. */
@Composable
fun TypingDots(modifier: Modifier = Modifier) {
    val transition = rememberInfiniteTransition(label = "typing")
    Row(modifier.padding(vertical = S.sm), horizontalArrangement = Arrangement.spacedBy(S.xs)) {
        repeat(3) { index ->
            val alpha by transition.animateFloat(
                initialValue = DOT_DIM,
                targetValue = DOT_DIM,
                animationSpec = infiniteRepeatable(
                    animation = keyframes {
                        durationMillis = DOT_CYCLE_MS
                        DOT_DIM at 0
                        1f at DOT_CYCLE_MS / 6 + index * DOT_STAGGER_MS
                        DOT_DIM at DOT_CYCLE_MS / 2 + index * DOT_STAGGER_MS
                    },
                    repeatMode = RepeatMode.Restart,
                ),
                label = "dot$index",
            )
            Box(Modifier.alpha(alpha)) { StatusDot(MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}

/** A small round badge with a count (approvals waiting). */
@Composable
fun CountBadge(count: Int, modifier: Modifier = Modifier) {
    Box(
        modifier.clip(CircleShape).background(MaterialTheme.colorScheme.primary).padding(horizontal = S.sm, vertical = S.xxs),
        contentAlignment = Alignment.Center,
    ) {
        Text(count.toString(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.Bold)
    }
}

private const val FADED = 0.6f
private const val MAX_SOURCES = 8
private const val LIVE_REASONING_LINES = 3
private const val DOT_DIM = 0.3f
private const val DOT_CYCLE_MS = 1200
private const val DOT_STAGGER_MS = 160
