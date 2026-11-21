package groot.mobile.feature.chat

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.core.net.toUri
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.data.BotsState
import groot.mobile.data.api.AttachmentRef
import groot.mobile.data.api.BotListEntry
import groot.mobile.data.api.ChatMessage
import groot.mobile.data.api.MessageRole
import groot.mobile.data.api.ToolCall
import groot.mobile.data.api.ToolStatus
import groot.mobile.data.chat.ChatHealth
import groot.mobile.data.chat.ChatView
import groot.mobile.data.chat.TimelineItem
import groot.mobile.data.chat.ToolPhase
import groot.mobile.data.chat.viewOf
import groot.mobile.feature.live.LivePipWindow
import groot.mobile.ui.brand.Accents
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.brand.Dims
import groot.mobile.ui.components.AppIcon
import groot.mobile.ui.components.BotAvatar
import groot.mobile.ui.components.MenuRow
import groot.mobile.ui.components.Sheet
import groot.mobile.ui.components.StatusDot
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay

fun browserInUse(messages: List<ChatMessage>): Boolean = messages.any { message ->
    message.role == MessageRole.Assistant && message.toolCalls.any { it.name.startsWith("browser_") && viewOf(it).phase == ToolPhase.Running }
}

fun computerInUse(messages: List<ChatMessage>): Boolean = messages.any { message ->
    message.role == MessageRole.Assistant && message.toolCalls.any {
        it.name.startsWith("computer_") && (viewOf(it).phase == ToolPhase.Running || it.status == ToolStatus.AwaitingTakeover)
    }
}

@Composable
fun ChatPane(
    container: AppContainer,
    bot: BotListEntry,
    bots: BotsState,
    onOpenLive: (surface: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel: ChatViewModel = viewModel(
        key = "chat:${bot.id}",
        factory = viewModelFactory { initializer { ChatViewModel(container, bot.id) } },
    )
    LifecycleStartEffect(bot.id) {
        viewModel.show()
        onStopOrDispose { viewModel.hide() }
    }
    val view by viewModel.view.collectAsStateWithLifecycle()
    val draft by viewModel.draft.collectAsStateWithLifecycle()
    val staged by viewModel.staged.collectAsStateWithLifecycle()

    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    var viewer by remember { mutableStateOf<AttachmentRef?>(null) }
    var credentials by remember { mutableStateOf<ToolCall?>(null) }
    var attachMenu by remember { mutableStateOf(false) }

    val focus by container.links.focus.collectAsStateWithLifecycle()
    val focusTask = focus?.takeIf { it.botId == bot.id }?.taskId
    LaunchedEffect(focusTask, view.timeline, view.typing) {
        val task = focusTask ?: return@LaunchedEffect
        val index = transcriptIndexOfTask(view, task) ?: return@LaunchedEffect
        delay(FOCUS_SETTLE_MS)
        listState.animateScrollToItem(index)
        container.links.clearFocus()
    }
    LaunchedEffect(focusTask) {
        if (focusTask == null) return@LaunchedEffect
        delay(FOCUS_WAIT_MS)
        container.links.clearFocus()
    }

    val pickPhotos = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(MAX_PICK)) { viewModel.attach(it) }
    val pickFiles = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { viewModel.attach(it) }

    val pip by container.livePip.current.collectAsStateWithLifecycle()
    val pipChosen by container.appPreferences.livePip.collectAsStateWithLifecycle(false)
    val watch: (String) -> Unit = { surface -> if (pipChosen) container.livePip.open(surface, bot.id) else onOpenLive(surface) }

    val actions = remember(bot.name, bots.labels, bots.capabilities) {
        ChatActions(
            botName = bot.name,
            labels = bots.labels,
            askOnlyTools = bots.capabilities.flatMap { it.tools }.filter { it.askOnly }.map { it.name }.toSet(),
            readOnly = false,
            now = System::currentTimeMillis,
            onDecide = viewModel::decide,
            onAnswer = { taskId, answers -> viewModel.answer(taskId, answers) },
            onOpenCredentials = { credentials = it },
            onCancelCredentials = { viewModel.cancelCredentials(it) },
            onOpenComputer = { onOpenLive("computer") },
            onOpenLink = { openCardLink(container, context, it) },
        )
    }

    Box(modifier.fillMaxSize()) {
    ChatContent(
        bot = bot,
        view = view,
        canAnswer = bots.models.canAnswer,
        guest = bots.guest,
        actions = actions,
        draft = draft,
        staged = staged,
        listState = listState,
        onDraftChange = viewModel::setDraft,
        onAttach = { attachMenu = true },
        onRemoveStaged = viewModel::removeStaged,
        onSend = { whenBusy ->
            viewModel.send(whenBusy)
            scope.launch { listState.scrollToItem(0) }
        },
        onStop = viewModel::stop,
        onWithdraw = viewModel::withdraw,
        onLoadOlder = viewModel::loadOlder,
        onOpenImage = { viewer = it },
        onSaveFile = { ref -> viewModel.save(ref) { uri -> openFile(context, uri, ref.mimeType) } },
        onCopy = { copyText(context, it) },
        onOpenLive = watch,
        onYoloOff = { viewModel.setYolo(false) },
    )
    pip?.takeIf { it.botId == bot.id }?.let { target ->
        LivePipWindow(
            container = container,
            target = target,
            onExpand = {
                container.livePip.close()
                container.scope.launch { container.appPreferences.setLivePip(false) }
                onOpenLive(target.surface)
            },
            onClose = container.livePip::close,
            modifier = Modifier.imePadding().padding(start = S.sm, top = S.sm, end = S.sm, bottom = Dims.composerMinHeight + S.lg),
        )
    }
    }

    if (attachMenu) {
        Sheet(onDismiss = { attachMenu = false }) {
            MenuRow(AppIcons.Image, "Photos", summary = "Pick images from your gallery", onClick = {
                attachMenu = false
                pickPhotos.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            })
            MenuRow(AppIcons.File, "Files", summary = "PDFs, documents, spreadsheets, code, up to 25 MB each", onClick = {
                attachMenu = false
                pickFiles.launch(arrayOf("*/*"))
            })
        }
    }
    viewer?.let { ref ->
        ImageViewer(ref, onSave = { viewModel.save(ref) {} }, onDismiss = { viewer = null })
    }
    credentials?.let { call ->
        CredentialSheet(
            call = call,
            botName = bot.name,
            onSubmit = { values, save -> call.taskId?.let { taskId -> viewModel.submitCredentials(taskId, values, save) { credentials = null } } },
            onDismiss = { credentials = null },
        )
    }
}

@Composable
fun ChatContent(
    bot: BotListEntry,
    view: ChatView,
    canAnswer: Boolean,
    guest: Boolean,
    actions: ChatActions,
    draft: String,
    staged: List<StagedUpload>,
    listState: LazyListState,
    onDraftChange: (String) -> Unit,
    onAttach: () -> Unit,
    onRemoveStaged: (String) -> Unit,
    onSend: (whenBusy: String) -> Unit,
    onStop: () -> Unit,
    onWithdraw: (String) -> Unit,
    onLoadOlder: () -> Unit,
    onOpenImage: (AttachmentRef) -> Unit,
    onSaveFile: (AttachmentRef) -> Unit,
    onCopy: (String) -> Unit,
    onOpenLive: (String) -> Unit,
    onYoloOff: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxSize().imePadding()) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                view.health == ChatHealth.Loading -> CircularProgressIndicator(
                    Modifier.align(Alignment.Center).size(Dims.iconLarge),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    strokeWidth = Dims.stroke,
                )
                view.timeline.isEmpty() && !view.typing -> ChatEmpty(bot, Modifier.align(Alignment.Center))
                else -> Transcript(
                    view = view,
                    actions = actions,
                    listState = listState,
                    onLoadOlder = onLoadOlder,
                    onOpenImage = onOpenImage,
                    onSaveFile = onSaveFile,
                    onCopy = onCopy,
                )
            }
        }
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = S.md)
                .padding(bottom = S.sm)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(S.sm),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            ChatNotices(view = view, canAnswer = canAnswer, guest = guest, onOpenLive = onOpenLive, onYoloOff = onYoloOff)
            Composer(
                draft = draft,
                onDraftChange = onDraftChange,
                placeholder = "Message ${bot.name}",
                busy = view.busy,
                enabled = canAnswer,
                staged = staged,
                held = view.held,
                onAttach = onAttach,
                onRemoveStaged = onRemoveStaged,
                onSend = onSend,
                onStop = onStop,
                onWithdraw = onWithdraw,
                modifier = Modifier.widthIn(max = Dims.contentMaxWidth),
            )
        }
    }
}

@Composable
private fun ChatNotices(view: ChatView, canAnswer: Boolean, guest: Boolean, onOpenLive: (String) -> Unit, onYoloOff: () -> Unit) {
    if (view.health == ChatHealth.Reconnecting) NoticePill(text = "Reconnecting", dot = Accents.warning)
    if (!canAnswer) {
        NoticePill(text = "No model can run right now. Set one up in the web app under Settings, Models.")
    }
    if (view.yolo) {
        NoticePill(icon = true, text = "YOLO mode: tools run without asking", action = if (guest) null else "Turn off", onAction = onYoloOff)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(S.sm)) {
        if (browserInUse(view.messages)) NoticePill(text = "Browser is live", dot = Accents.success, action = "Watch", onAction = { onOpenLive("browser") })
        if (computerInUse(view.messages)) NoticePill(text = "Computer is live", dot = Accents.success, action = "Watch", onAction = { onOpenLive("computer") })
    }
}

@Composable
private fun NoticePill(
    text: String,
    dot: androidx.compose.ui.graphics.Color? = null,
    icon: Boolean = false,
    action: String? = null,
    onAction: () -> Unit = {},
) {
    Row(
        Modifier
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.surfaceContainerLow)
            .then(if (action != null) Modifier.clickable(role = Role.Button, onClickLabel = action, onClick = onAction) else Modifier)
            .padding(horizontal = S.md, vertical = S.sm),
        horizontalArrangement = Arrangement.spacedBy(S.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (dot != null) StatusDot(dot)
        if (icon) AppIcon(AppIcons.Zap, null, tint = Accents.warning, size = Dims.iconSmall)
        Text(text, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (action != null) Text(action, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun ChatEmpty(bot: BotListEntry, modifier: Modifier = Modifier) {
    Column(
        modifier.padding(S.xxl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(S.md),
    ) {
        BotAvatar(bot.name, size = Dims.avatarLarge)
        Text(bot.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
        Text(
            bot.description.ifBlank { "Ask anything to get started." },
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
fun Transcript(
    view: ChatView,
    actions: ChatActions,
    listState: LazyListState,
    onLoadOlder: () -> Unit,
    onOpenImage: (AttachmentRef) -> Unit,
    onSaveFile: (AttachmentRef) -> Unit,
    onCopy: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val items = remember(view.timeline) { view.timeline.asReversed() }
    val atBottom by remember { derivedStateOf { listState.firstVisibleItemIndex <= 1 } }
    val newestKey = items.firstOrNull()?.key
    LaunchedEffect(newestKey, view.typing) {
        if (atBottom) listState.animateScrollToItem(0)
    }
    Box(modifier.fillMaxSize()) {
        LazyColumn(
            state = listState,
            reverseLayout = true,
            contentPadding = PaddingValues(horizontal = S.lg, vertical = S.md),
            verticalArrangement = Arrangement.spacedBy(S.lg),
            modifier = Modifier.fillMaxSize(),
        ) {
            if (view.typing) item(key = "typing") { TypingDots() }
            items(items, key = { it.key }) { item ->
                when (item) {
                    is TimelineItem.Message -> Column {
                        if (item.message.id == view.unreadDividerId) QuietLine("New messages")
                        MessageView(item.message, actions, onOpenImage, onSaveFile, onCopy)
                    }
                    is TimelineItem.RoutineRuns -> RoutineRunsLine(item.runs)
                    is TimelineItem.EchoItem -> EchoBubble(item.echo, onOpenImage, onSaveFile)
                }
            }
            if (view.hasMore) {
                item(key = "older") {
                    LaunchedEffect(view.messages.firstOrNull()?.id) { onLoadOlder() }
                    Box(Modifier.fillMaxWidth().padding(S.md), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(Modifier.size(Dims.icon), color = MaterialTheme.colorScheme.onSurfaceVariant, strokeWidth = Dims.stroke)
                    }
                }
            }
        }
        if (!atBottom) {
            val scope = rememberCoroutineScope()
            Box(
                Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = S.sm)
                    .size(Dims.sendButton)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.surfaceContainerHigh)
                    .clickable(role = Role.Button, onClickLabel = "Jump to the latest message") { scope.launch { listState.animateScrollToItem(0) } },
                contentAlignment = Alignment.Center,
            ) {
                AppIcon(AppIcons.ChevronDown, "Jump to the latest message", size = Dims.iconSmall)
            }
        }
    }
}

private fun copyText(context: Context, text: String) {
    context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("Tiny Agents", text))
}

internal fun openCardLink(container: groot.mobile.AppContainer, context: Context, link: String) {
    val serverUrl = container.session.serverUrl
    val url = if (link.startsWith("/") && serverUrl != null) serverUrl + link else link
    val inApp = groot.mobile.data.parseAppLink(url, serverUrl)
    if (inApp != null) container.links.open(inApp) else openLink(context, serverUrl, link)
}

internal fun openLink(context: Context, serverUrl: String?, link: String) {
    val url = if (link.startsWith("/") && serverUrl != null) serverUrl + link else link
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: ActivityNotFoundException) {
    }
}

private fun openFile(context: Context, uri: Uri, mimeType: String) {
    try {
        context.startActivity(
            Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, mimeType)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    } catch (_: ActivityNotFoundException) {
    }
}

fun transcriptIndexOfTask(view: ChatView, taskId: Int): Int? {
    val reversed = view.timeline.asReversed()
    val at = reversed.indexOfFirst { item -> item is TimelineItem.Message && item.message.toolCalls.any { it.taskId == taskId } }
    if (at < 0) return null
    return at + if (view.typing) 1 else 0
}

private const val MAX_PICK = 10
private const val FOCUS_SETTLE_MS = 300L
private const val FOCUS_WAIT_MS = 10_000L
