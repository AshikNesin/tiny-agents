package groot.mobile.feature.share

import android.graphics.Bitmap
import android.net.Uri
import android.util.Size
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.data.BotsState
import groot.mobile.data.ViewerRole
import groot.mobile.data.api.BotListEntry
import groot.mobile.feature.chat.StagedUpload
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.brand.Dims
import groot.mobile.ui.components.AppIcon
import groot.mobile.ui.components.BotAvatar
import groot.mobile.ui.components.DISABLED_ALPHA
import groot.mobile.ui.components.EmptyState
import groot.mobile.ui.components.IconBtn
import groot.mobile.ui.components.LoadingBox
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun ShareRoute(
    container: AppContainer,
    viewModel: ShareViewModel,
    onDone: (ShareOutcome) -> Unit,
    onCancel: () -> Unit,
    onOpenApp: () -> Unit,
) {
    val session by container.session.state.collectAsStateWithLifecycle()
    val bots by container.bots.state.collectAsStateWithLifecycle()
    val draft by viewModel.draft.collectAsStateWithLifecycle()
    val outcome by viewModel.outcome.collectAsStateWithLifecycle()
    LaunchedEffect(outcome) { outcome?.let(onDone) }
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(container) {
        container.notices.messages.collect { message ->
            snackbar.currentSnackbarData?.dismiss()
            snackbar.showSnackbar(message)
        }
    }
    val pickFiles = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { viewModel.attach(it) }
    ShareSheet(
        signedIn = session.signedIn,
        bots = bots,
        draft = draft,
        snackbar = snackbar,
        onQueryChange = viewModel::setQuery,
        onSelect = viewModel::select,
        onClearBot = viewModel::clearBot,
        onNoteChange = viewModel::setNote,
        onRemoveStaged = viewModel::removeStaged,
        onRemoveSharedText = viewModel::removeSharedText,
        onAttach = { pickFiles.launch(arrayOf("*/*")) },
        onSend = { bots.bot(draft.botId)?.let { bot -> viewModel.send(bot) } },
        onRetry = { container.scope.launch { container.bots.refresh() } },
        onCancel = onCancel,
        onOpenApp = onOpenApp,
    )
}

@Composable
fun ShareSheet(
    signedIn: Boolean,
    bots: BotsState,
    draft: ShareDraft,
    onQueryChange: (String) -> Unit,
    onSelect: (String) -> Unit,
    onClearBot: () -> Unit,
    onNoteChange: (String) -> Unit,
    onRemoveStaged: (String) -> Unit,
    onRemoveSharedText: () -> Unit,
    onAttach: () -> Unit,
    onSend: () -> Unit,
    onRetry: () -> Unit,
    onCancel: () -> Unit,
    onOpenApp: () -> Unit,
    snackbar: SnackbarHostState = remember { SnackbarHostState() },
) {
    Box(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.scrim.copy(alpha = SCRIM_ALPHA))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClickLabel = "Cancel", onClick = onCancel),
        contentAlignment = Alignment.BottomCenter,
    ) {
        Column(
            Modifier
                .statusBarsPadding()
                .padding(top = S.xxl)
                .widthIn(max = Dims.contentMaxWidth)
                .fillMaxSize()
                .clip(RoundedCornerShape(topStart = Dims.sheetRadius, topEnd = Dims.sheetRadius))
                .background(MaterialTheme.colorScheme.surfaceContainerLow)
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = {})
                .navigationBarsPadding()
                .imePadding(),
        ) {
            ShareHeader(onCancel)
            val selected = bots.bot(draft.botId)
            when {
                !signedIn -> EmptyState(
                    title = "Sign in to share",
                    body = "Open Tiny Agents and sign in to your server, then share again.",
                    icon = AppIcons.Brand,
                    actionLabel = "Open Tiny Agents",
                    onAction = onOpenApp,
                    modifier = Modifier.weight(1f),
                )
                bots.loading && bots.bots.isEmpty() -> LoadingBox(Modifier.weight(1f))
                bots.error != null && bots.bots.isEmpty() -> EmptyState(
                    title = "Could not reach your server",
                    body = bots.error,
                    icon = AppIcons.Alert,
                    actionLabel = "Try again",
                    onAction = onRetry,
                    modifier = Modifier.weight(1f),
                )
                bots.bots.isEmpty() -> EmptyState(
                    title = if (bots.role == ViewerRole.Guest) "Nothing shared with you yet" else "No bots yet",
                    body = if (bots.role == ViewerRole.Guest) "When the owner shares a bot with you, you can share to it here." else "Create a bot in Tiny Agents, then share to it.",
                    icon = AppIcons.Brand,
                    actionLabel = "Open Tiny Agents",
                    onAction = onOpenApp,
                    modifier = Modifier.weight(1f),
                )
                else -> {
                    ToField(selected = selected, query = draft.query, onQueryChange = onQueryChange, onClear = onClearBot)
                    BotList(
                        bots = filterBots(bots.sorted, draft.query),
                        query = draft.query,
                        selectedId = selected?.id,
                        onSelect = onSelect,
                        modifier = Modifier.weight(1f),
                    )
                    ShareComposer(
                        draft = draft,
                        canSend = draft.canSend && selected != null,
                        placeholder = if (selected != null) "Add a note for ${selected.name}" else "Add a note",
                        onNoteChange = onNoteChange,
                        onRemoveStaged = onRemoveStaged,
                        onRemoveSharedText = onRemoveSharedText,
                        onAttach = onAttach,
                        onSend = onSend,
                    )
                }
            }
        }
        SnackbarHost(snackbar, Modifier.navigationBarsPadding().imePadding()) { data ->
            Snackbar(
                snackbarData = data,
                containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                contentColor = MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

@Composable
private fun ShareHeader(onCancel: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = S.sm, vertical = S.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconBtn(AppIcons.Close, "Cancel", onCancel, background = MaterialTheme.colorScheme.surfaceContainer)
        Text(
            "Share to a bot",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
            modifier = Modifier.weight(1f),
        )
        Spacer(Modifier.size(Dims.iconButton))
    }
}

@Composable
private fun ToField(selected: BotListEntry?, query: String, onQueryChange: (String) -> Unit, onClear: () -> Unit) {
    Row(
        Modifier
            .padding(horizontal = S.lg, vertical = S.xs)
            .fillMaxWidth()
            .defaultMinSize(minHeight = Dims.composerMinHeight)
            .clip(RoundedCornerShape(Dims.composerRadius))
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .border(Dims.hairline, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(Dims.composerRadius))
            .padding(horizontal = S.lg, vertical = S.sm),
        horizontalArrangement = Arrangement.spacedBy(S.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("To:", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (selected != null) {
            Row(
                Modifier
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.surfaceContainerHigh)
                    .padding(start = S.xxs),
                horizontalArrangement = Arrangement.spacedBy(S.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BotAvatar(selected.name, size = Dims.avatarSmall)
                Text(selected.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = Dims.shareChipMaxWidth))
                IconBtn(AppIcons.Close, "Remove ${selected.name}", onClear, iconSize = Dims.iconSmall, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        val style = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface)
        BasicTextField(
            value = query,
            onValueChange = onQueryChange,
            singleLine = true,
            textStyle = style,
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Search),
            modifier = Modifier.weight(1f),
            decorationBox = { inner ->
                Box(contentAlignment = Alignment.CenterStart) {
                    if (query.isEmpty() && selected == null) {
                        Text("Search bots", style = style, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                    }
                    inner()
                }
            },
        )
    }
}

@Composable
private fun BotList(bots: List<BotListEntry>, query: String, selectedId: String?, onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
    if (bots.isEmpty()) {
        Box(modifier.fillMaxWidth().padding(S.xl), contentAlignment = Alignment.TopCenter) {
            Text("No bot is called “${query.trim()}”", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        return
    }
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(horizontal = S.sm, vertical = S.xs)) {
        items(bots, key = { it.id }) { bot ->
            val chosen = bot.id == selectedId
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(Dims.fieldRadius))
                    .background(if (chosen) MaterialTheme.colorScheme.surfaceContainer else MaterialTheme.colorScheme.surfaceContainerLow)
                    .clickable(role = Role.Button, onClickLabel = "Share to ${bot.name}") { onSelect(bot.id) }
                    .padding(horizontal = S.md, vertical = S.md),
                horizontalArrangement = Arrangement.spacedBy(S.lg),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BotAvatar(bot.name)
                Column(Modifier.weight(1f)) {
                    Text(bot.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (bot.description.isNotBlank()) {
                        Text(bot.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                if (chosen) AppIcon(AppIcons.Check, contentDescription = "Chosen", tint = MaterialTheme.colorScheme.onSurface)
            }
        }
    }
}

@Composable
private fun ShareComposer(
    draft: ShareDraft,
    canSend: Boolean,
    placeholder: String,
    onNoteChange: (String) -> Unit,
    onRemoveStaged: (String) -> Unit,
    onRemoveSharedText: () -> Unit,
    onAttach: () -> Unit,
    onSend: () -> Unit,
) {
    Column(
        Modifier
            .padding(horizontal = S.md)
            .padding(top = S.sm, bottom = S.sm)
            .fillMaxWidth()
            .clip(RoundedCornerShape(Dims.composerRadius))
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .border(Dims.hairline, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(Dims.composerRadius)),
    ) {
        val sharedText = draft.sharedText
        if (draft.staged.isNotEmpty() || sharedText != null) {
            Row(
                Modifier.horizontalScroll(rememberScrollState()).padding(start = S.md, end = S.md, top = S.md),
                horizontalArrangement = Arrangement.spacedBy(S.sm),
            ) {
                if (sharedText != null) SharedTextCard(sharedText, onRemoveSharedText)
                for (upload in draft.staged) SharedFileCard(upload, onRemove = { onRemoveStaged(upload.id) })
            }
        }
        Row(
            Modifier.fillMaxWidth().defaultMinSize(minHeight = Dims.composerMinHeight).padding(horizontal = S.sm, vertical = S.sm),
            verticalAlignment = Alignment.Bottom,
        ) {
            IconBtn(AppIcons.Paperclip, "Attach another file", onAttach, enabled = !draft.sending, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            val style = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface)
            BasicTextField(
                value = draft.note,
                onValueChange = onNoteChange,
                enabled = !draft.sending,
                textStyle = style,
                maxLines = NOTE_MAX_LINES,
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                modifier = Modifier.weight(1f).padding(horizontal = S.xs, vertical = S.sm),
                decorationBox = { inner ->
                    Box(contentAlignment = Alignment.CenterStart) {
                        if (draft.note.isEmpty()) {
                            Text(placeholder, style = style, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        inner()
                    }
                },
            )
            if (draft.sending) {
                Box(Modifier.padding(S.xxs).size(Dims.sendButton), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(Modifier.size(Dims.icon), color = MaterialTheme.colorScheme.onSurfaceVariant, strokeWidth = Dims.stroke)
                }
            } else {
                IconBtn(
                    icon = AppIcons.ArrowUp,
                    label = "Send",
                    onClick = onSend,
                    enabled = canSend,
                    tint = MaterialTheme.colorScheme.onPrimary,
                    background = MaterialTheme.colorScheme.primary.copy(alpha = if (canSend) 1f else DISABLED_ALPHA),
                    modifier = Modifier.padding(S.xxs).size(Dims.sendButton),
                )
            }
        }
    }
}

@Composable
private fun SharedFileCard(upload: StagedUpload, onRemove: () -> Unit) {
    val file = upload.file
    val isImage = file.mimeType.startsWith("image/")
    val thumbnail = if (isImage) rememberThumbnail(file.uri) else null
    ShareCard(onRemove = onRemove, removeLabel = "Remove ${file.name}") {
        if (thumbnail != null) {
            Image(thumbnail.asImageBitmap(), contentDescription = file.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        } else {
            Column(Modifier.fillMaxSize().padding(S.md), verticalArrangement = Arrangement.SpaceBetween) {
                TypeBadge(if (isImage) "IMAGE" else fileType(file.name))
                Text(file.name.substringBeforeLast('.').ifEmpty { file.name }, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
        when {
            upload.uploading -> Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.scrim.copy(alpha = UPLOADING_ALPHA)), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.size(Dims.icon), color = MaterialTheme.colorScheme.onSurface, strokeWidth = Dims.stroke)
            }
            upload.error != null -> Column(
                Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceContainerHigh).padding(S.sm),
                verticalArrangement = Arrangement.spacedBy(S.xs, Alignment.CenterVertically),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                AppIcon(AppIcons.Alert, contentDescription = null, tint = MaterialTheme.colorScheme.error, size = Dims.iconSmall)
                Text(upload.error, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error, maxLines = 3, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
            }
        }
    }
}

@Composable
private fun SharedTextCard(text: String, onRemove: () -> Unit) {
    ShareCard(onRemove = onRemove, removeLabel = "Remove the shared text", wide = true) {
        Column(Modifier.fillMaxSize().padding(S.md), verticalArrangement = Arrangement.spacedBy(S.sm)) {
            TypeBadge("TEXT")
            Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun ShareCard(onRemove: () -> Unit, removeLabel: String, wide: Boolean = false, content: @Composable () -> Unit) {
    Box(
        Modifier
            .size(width = if (wide) Dims.shareCard * 2 else Dims.shareCard, height = Dims.shareCard)
            .clip(RoundedCornerShape(Dims.fieldRadius))
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .border(Dims.hairline, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(Dims.fieldRadius)),
    ) {
        content()
        IconBtn(
            AppIcons.Close,
            removeLabel,
            onRemove,
            iconSize = Dims.iconSmall,
            background = MaterialTheme.colorScheme.surfaceContainer.copy(alpha = BADGE_ALPHA),
            modifier = Modifier.align(Alignment.TopEnd),
        )
    }
}

@Composable
private fun TypeBadge(label: String) {
    Text(
        label,
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
        modifier = Modifier
            .clip(CircleShape)
            .border(Dims.hairline, MaterialTheme.colorScheme.outlineVariant, CircleShape)
            .padding(horizontal = S.sm, vertical = S.xxs)
            .heightIn(min = Dims.iconSmall),
    )
}

internal fun fileType(name: String): String =
    name.substringAfterLast('.', "").takeIf { it.isNotEmpty() && it.length <= MAX_EXTENSION && it != name }?.uppercase() ?: "FILE"

@Composable
private fun rememberThumbnail(uri: Uri): Bitmap? {
    val context = LocalContext.current
    val px = with(LocalDensity.current) { Dims.shareCard.roundToPx() }
    val bitmap by produceState<Bitmap?>(initialValue = null, uri) {
        value = withContext(Dispatchers.IO) { runCatching { context.contentResolver.loadThumbnail(uri, Size(px, px), null) }.getOrNull() }
    }
    return bitmap
}

private const val SCRIM_ALPHA = 0.5f
private const val UPLOADING_ALPHA = 0.4f
private const val BADGE_ALPHA = 0.8f
private const val NOTE_MAX_LINES = 5
private const val MAX_EXTENSION = 5
