package groot.mobile.feature.code

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.data.api.CodeCapabilities
import groot.mobile.data.api.CodeHarness
import groot.mobile.data.api.CodeModel
import groot.mobile.data.api.CodeQueuedMessage
import groot.mobile.data.api.PermissionModes
import groot.mobile.data.code.CodeThreadState
import groot.mobile.data.code.formatTokens
import groot.mobile.data.code.formatUsd
import groot.mobile.data.code.groupTools
import groot.mobile.data.code.lastErrorId
import groot.mobile.data.code.shortPath
import groot.mobile.feature.chat.TypingDots
import groot.mobile.feature.chat.openLink
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.brand.Dims
import groot.mobile.ui.components.AppIcon
import groot.mobile.ui.components.Chip
import groot.mobile.ui.components.ConfirmDialog
import groot.mobile.ui.components.DISABLED_ALPHA
import groot.mobile.ui.components.EmptyState
import groot.mobile.ui.components.Field
import groot.mobile.ui.components.IconBtn
import groot.mobile.ui.components.LoadingBox
import groot.mobile.ui.components.Markdown
import groot.mobile.ui.components.MenuRow
import groot.mobile.ui.components.PrimaryButton
import groot.mobile.ui.components.ScreenScaffold
import groot.mobile.ui.components.Sheet
import kotlinx.coroutines.launch

@Composable
fun CodeThreadRoute(
    container: AppContainer,
    threadId: String,
    onOpenThread: (String) -> Unit,
    onChanges: () -> Unit,
    onPullRequest: () -> Unit,
    onBack: () -> Unit,
) {
    val viewModel: CodeThreadViewModel = viewModel(key = "code:$threadId", factory = CodeThreadViewModel.factory(container, threadId))
    DisposableEffect(viewModel) {
        viewModel.show()
        onDispose { viewModel.hide() }
    }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val connected by viewModel.connected.collectAsStateWithLifecycle()
    val harness by viewModel.harness.collectAsStateWithLifecycle()
    val models by viewModel.models.collectAsStateWithLifecycle()
    val draft by viewModel.draft.collectAsStateWithLifecycle()
    val closed by viewModel.closed.collectAsStateWithLifecycle()
    LaunchedEffect(closed) { if (closed) onBack() }
    LaunchedEffect(state.movedTo) { state.movedTo?.let(onOpenThread) }
    val context = LocalContext.current
    var sheet by remember { mutableStateOf<CodeSheet?>(null) }

    CodeThreadScreen(
        state = state,
        connected = connected,
        harness = harness,
        models = models,
        draft = draft,
        onDraftChange = viewModel::setDraft,
        onSend = viewModel::send,
        onStop = viewModel::stop,
        onQueued = viewModel::queued,
        actions = CodeRowActions(
            readOnly = state.thread?.archived == true,
            recoverableId = remember(state.items) { lastErrorId(state.items) },
            recovery = harness?.capabilities?.recovery.orEmpty(),
            onAllow = viewModel::allow,
            onAnswer = viewModel::answer,
            onRecover = viewModel::recover,
            onOpenThread = onOpenThread,
        ),
        onSheet = { sheet = it },
        onChanges = onChanges,
        onPullRequest = onPullRequest,
        onBack = onBack,
    )

    val caps = harness?.capabilities ?: CodeCapabilities()
    when (sheet) {
        null -> Unit
        CodeSheet.Model -> Sheet(onDismiss = { sheet = null }, title = "Model") {
            for (model in models.filter { it.ready }) {
                MenuRow(
                    AppIcons.Sparkle,
                    model.label,
                    summary = if (model.isDefault) "Default" else model.id.takeIf { it != model.label },
                    onClick = {
                        sheet = null
                        viewModel.setModel(model.id)
                    },
                    trailing = if (model.id == state.settings?.model) ({ AppIcon(AppIcons.Check, "Current") }) else null,
                )
            }
        }
        CodeSheet.Effort -> Sheet(onDismiss = { sheet = null }, title = "Reasoning") {
            for (level in listOf("default") + caps.effortLevels) {
                MenuRow(
                    AppIcons.Zap,
                    effortLabel(level),
                    onClick = {
                        sheet = null
                        viewModel.setEffort(level)
                    },
                    trailing = if ((state.settings?.effort ?: "default") == level) ({ AppIcon(AppIcons.Check, "Current") }) else null,
                )
            }
        }
        CodeSheet.Permissions -> Sheet(onDismiss = { sheet = null }, title = "Permissions") {
            for (mode in caps.permissionModes) {
                MenuRow(
                    if (mode == PermissionModes.BYPASS) AppIcons.Zap else AppIcons.Lock,
                    PermissionModes.label(mode),
                    summary = PermissionModes.hint(mode),
                    destructive = mode == PermissionModes.BYPASS,
                    onClick = {
                        sheet = null
                        viewModel.setPermissionMode(mode)
                    },
                    trailing = if (state.settings?.permissionMode == mode) ({ AppIcon(AppIcons.Check, "Current") }) else null,
                )
            }
        }
        CodeSheet.More -> Sheet(onDismiss = { sheet = null }, title = state.thread?.title) {
            val thread = state.thread
            if (caps.rename) MenuRow(AppIcons.Pencil, "Rename", onClick = { sheet = CodeSheet.Rename })
            if (caps.diffs && thread?.cwd != null) MenuRow(AppIcons.File, "Changes", summary = "What the agent changed in ${shortPath(thread.cwd)}", onClick = {
                sheet = null
                onChanges()
            })
            if (thread?.projectId != null) MenuRow(AppIcons.Share, "Pull request", onClick = {
                sheet = null
                onPullRequest()
            })
            if (caps.archive && thread != null) {
                MenuRow(AppIcons.Download, if (thread.archived) "Restore" else "Archive", summary = "With its subagents", onClick = {
                    sheet = null
                    viewModel.archive(!thread.archived) { if (!thread.archived) onBack() }
                })
            }
            thread?.externalUrl?.let { url ->
                MenuRow(AppIcons.External, "Open in ${harness?.label ?: "the harness"}", onClick = {
                    sheet = null
                    openLink(context, container.session.serverUrl, url)
                })
            }
            MenuRow(AppIcons.Globe, "Open in the web app", onClick = {
                sheet = null
                openLink(context, container.session.serverUrl, "/code/${android.net.Uri.encode(threadId)}")
            })
            if (caps.delete) MenuRow(AppIcons.Trash, "Delete", destructive = true, onClick = { sheet = CodeSheet.Delete })
        }
        CodeSheet.Rename -> {
            var title by rememberSaveable { mutableStateOf(state.thread?.title.orEmpty()) }
            Sheet(onDismiss = { sheet = null }, title = "Rename") {
                Field(title, { title = it }, placeholder = "Title")
                PrimaryButton("Save", enabled = title.isNotBlank(), onClick = {
                    sheet = null
                    viewModel.rename(title.trim())
                })
            }
        }
        CodeSheet.Delete -> ConfirmDialog(
            title = "Delete this thread?",
            text = "The conversation is deleted from ${harness?.label ?: "the harness"}. This cannot be undone.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = {
                sheet = null
                viewModel.delete()
            },
            onDismiss = { sheet = null },
        )
    }
}

enum class CodeSheet { Model, Effort, Permissions, More, Rename, Delete }

@Composable
fun CodeThreadScreen(
    state: CodeThreadState,
    connected: Boolean,
    harness: CodeHarness?,
    models: List<CodeModel>,
    draft: String,
    onDraftChange: (String) -> Unit,
    onSend: (queue: Boolean) -> Unit,
    onStop: () -> Unit,
    onQueued: (id: String, action: String) -> Unit,
    actions: CodeRowActions,
    onSheet: (CodeSheet) -> Unit,
    onChanges: () -> Unit,
    onPullRequest: () -> Unit,
    onBack: () -> Unit,
) {
    val thread = state.thread
    val caps = harness?.capabilities ?: CodeCapabilities()
    val subtitle = listOfNotNull(
        harness?.label,
        shortPath(thread?.cwd).takeIf { it.isNotEmpty() },
        when {
            state.loaded && !connected -> "Reconnecting"
            thread?.archived == true -> "Archived"
            state.working -> "Working"
            else -> null
        },
    ).joinToString(" · ")
    ScreenScaffold(
        title = thread?.title?.ifBlank { null } ?: "Thread",
        subtitle = subtitle.ifEmpty { null },
        onBack = onBack,
        actions = {
            if (thread?.projectId != null) IconBtn(AppIcons.Share, "Pull request", onPullRequest)
            if (caps.diffs && thread?.cwd != null) IconBtn(AppIcons.File, "Changes", onChanges)
            IconBtn(AppIcons.More, "More", { onSheet(CodeSheet.More) })
        },
    ) {
        when {
            !state.loaded && state.error != null -> EmptyState("Could not open the thread", body = state.error, icon = AppIcons.Alert)
            !state.loaded -> LoadingBox()
            else -> Column(Modifier.fillMaxSize().imePadding()) {
                Transcript(state, actions, Modifier.weight(1f))
                Column(
                    Modifier.fillMaxWidth().padding(horizontal = S.md).padding(bottom = S.sm).navigationBarsPadding(),
                    verticalArrangement = Arrangement.spacedBy(S.sm),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    for (queued in state.queued) QueuedRow(queued, caps.manageQueue && !actions.readOnly, onQueued)
                    if (!actions.readOnly) {
                        SettingChips(state, caps, models, onSheet)
                        CodeComposer(
                            draft = draft,
                            onDraftChange = onDraftChange,
                            working = state.working,
                            canSteer = caps.steer,
                            canQueue = caps.queue,
                            canStop = caps.interrupt,
                            onSend = onSend,
                            onStop = onStop,
                            modifier = Modifier.widthIn(max = Dims.contentMaxWidth),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun Transcript(state: CodeThreadState, actions: CodeRowActions, modifier: Modifier) {
    val shown = remember(state.items) { groupTools(state.items).asReversed() }
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    LaunchedEffect(state.items.size) { if (listState.firstVisibleItemIndex <= 1) scope.launch { listState.animateScrollToItem(0) } }
    LazyColumn(
        modifier.fillMaxWidth(),
        state = listState,
        reverseLayout = true,
        contentPadding = PaddingValues(horizontal = S.lg, vertical = S.md),
    ) {
        if (state.working) {
            item(key = "live") {
                Column(verticalArrangement = Arrangement.spacedBy(S.xs)) {
                    if (state.partialThinking.isNotBlank()) Thinking(state.partialThinking, live = true)
                    if (state.partialText.isNotBlank()) Markdown(state.partialText)
                    TypingDots()
                }
            }
        }
        items(shown, key = { it.key }) { item -> CodeRow(item, actions) }
        if (shown.isEmpty() && !state.working) {
            item(key = "empty") { Text("Nothing here yet.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}

@Composable
private fun QueuedRow(queued: CodeQueuedMessage, manage: Boolean, onQueued: (String, String) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .widthIn(max = Dims.contentMaxWidth)
            .clip(RoundedCornerShape(Dims.cardRadius))
            .background(MaterialTheme.colorScheme.surfaceContainerLow)
            .padding(start = S.lg),
        horizontalArrangement = Arrangement.spacedBy(S.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AppIcon(AppIcons.Queue, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, size = Dims.iconSmall)
        Column(Modifier.weight(1f).padding(vertical = S.sm)) {
            Text(queued.from?.let { "From $it, queued" } ?: "Queued for when this turn ends", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(queued.text, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (manage) {
            IconBtn(AppIcons.ArrowUp, "Send now", { onQueued(queued.id, "send") }, iconSize = Dims.iconSmall)
            IconBtn(AppIcons.Close, "Cancel", { onQueued(queued.id, "cancel") }, iconSize = Dims.iconSmall)
        }
    }
}

@Composable
private fun SettingChips(state: CodeThreadState, caps: CodeCapabilities, models: List<CodeModel>, onSheet: (CodeSheet) -> Unit) {
    val settings = state.settings
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(S.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (caps.modelSwitch && models.isNotEmpty()) {
            val current = models.firstOrNull { it.id == settings?.model }?.label ?: settings?.model ?: state.thread?.model ?: "Model"
            Chip(current, icon = AppIcons.Sparkle, onClick = { onSheet(CodeSheet.Model) })
        }
        if (caps.effortLevels.isNotEmpty()) {
            Chip(effortLabel(settings?.effort ?: "default"), icon = AppIcons.Zap, onClick = { onSheet(CodeSheet.Effort) })
        }
        if (caps.permissionModes.isNotEmpty()) {
            val mode = settings?.permissionMode ?: caps.defaultPermissionMode
            Chip(mode?.let(PermissionModes::label) ?: "Permissions", icon = AppIcons.Lock, onClick = { onSheet(CodeSheet.Permissions) })
        }
        val used = state.context.used
        if (used > 0) {
            val max = state.context.max
            val text = buildString {
                append(formatTokens(used))
                if (max != null && max > 0) append(" · ").append((used * 100 / max).coerceIn(0, 100)).append("%")
                if (state.costUsd > 0) append(" · ").append(formatUsd(state.costUsd))
            }
            Text(text, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

internal fun effortLabel(level: String): String = when (level) {
    "default" -> "Auto"
    "off" -> "Off"
    "minimal" -> "Minimal"
    "low" -> "Low"
    "medium" -> "Medium"
    "high" -> "High"
    "xhigh" -> "Extra high"
    "max" -> "Max"
    else -> level
}

@Composable
fun CodeComposer(
    draft: String,
    onDraftChange: (String) -> Unit,
    working: Boolean,
    canSteer: Boolean,
    canQueue: Boolean,
    canStop: Boolean,
    onSend: (queue: Boolean) -> Unit,
    onStop: () -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = if (working) "Steer the agent" else "Reply",
) {
    val canSend = draft.isNotBlank()
    val showStop = working && !canSend && canStop
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Dims.composerRadius))
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .border(Dims.hairline, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(Dims.composerRadius))
            .defaultMinSize(minHeight = Dims.composerMinHeight)
            .padding(start = S.lg, end = S.sm, top = S.sm, bottom = S.sm),
        verticalAlignment = Alignment.Bottom,
    ) {
        val style = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface)
        BasicTextField(
            value = draft,
            onValueChange = onDraftChange,
            textStyle = style,
            maxLines = MAX_LINES,
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            modifier = Modifier.weight(1f).padding(vertical = S.sm),
            decorationBox = { inner ->
                Box(contentAlignment = Alignment.CenterStart) {
                    if (draft.isEmpty()) Text(placeholder, style = style, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                    inner()
                }
            },
        )
        if (working && canSend && canQueue && canSteer) {
            IconBtn(AppIcons.Queue, "Queue for when this turn ends", onClick = { onSend(true) }, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        val active = showStop || canSend
        IconBtn(
            icon = if (showStop) AppIcons.Stop else AppIcons.ArrowUp,
            label = when {
                showStop -> "Stop"
                working && canSteer -> "Steer"
                working -> "Queue"
                else -> "Send"
            },
            onClick = { if (showStop) onStop() else onSend(working && !canSteer) },
            enabled = active,
            tint = MaterialTheme.colorScheme.onPrimary,
            background = MaterialTheme.colorScheme.primary.copy(alpha = if (active) 1f else DISABLED_ALPHA),
            modifier = Modifier.padding(S.xxs).size(Dims.sendButton),
        )
    }
}

private const val MAX_LINES = 6
