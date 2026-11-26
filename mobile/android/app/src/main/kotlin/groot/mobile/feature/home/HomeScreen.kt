package groot.mobile.feature.home

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.data.BotsState
import groot.mobile.data.ViewerRole
import groot.mobile.data.api.BotListEntry
import groot.mobile.data.chat.ChatSession
import groot.mobile.feature.chat.ChatPane
import groot.mobile.feature.chat.ChatViewModel
import groot.mobile.navigation.Routes
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.brand.Dims
import groot.mobile.ui.components.ActionTile
import groot.mobile.ui.components.AppIcon
import groot.mobile.ui.components.BotAvatar
import groot.mobile.ui.components.ConfirmDialog
import groot.mobile.ui.components.EmptyState
import groot.mobile.ui.components.IconBtn
import groot.mobile.ui.components.LoadingBox
import groot.mobile.ui.components.MenuRow
import groot.mobile.ui.components.Sheet
import kotlinx.coroutines.launch

@Composable
fun HomeRoute(container: AppContainer, onNavigate: (String) -> Unit) {
    val viewModel: HomeViewModel = viewModel(factory = viewModelFactory { initializer { HomeViewModel(container) } })
    val bots by viewModel.bots.collectAsStateWithLifecycle()
    val selected by viewModel.selected.collectAsStateWithLifecycle()
    val session by container.session.state.collectAsStateWithLifecycle()
    val sessions by container.chats.sessions.collectAsStateWithLifecycle()
    val bot = HomeViewModel.current(bots, selected)
    val threads by viewModel.threads.collectAsStateWithLifecycle()

    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    var menu by remember { mutableStateOf(false) }
    var confirmNewChat by remember { mutableStateOf(false) }
    BackHandler(enabled = drawer.isOpen) { scope.launch { drawer.close() } }
    LaunchedEffect(drawer.isOpen) { if (drawer.isOpen) viewModel.loadThreads() }
    LifecycleStartEffect(Unit) {
        viewModel.retry()
        onStopOrDispose {}
    }

    ModalNavigationDrawer(
        drawerState = drawer,
        drawerContent = {
            AppDrawer(
                bots = bots,
                selectedBotId = bot?.id,
                user = session.user,
                onSelectBot = {
                    viewModel.select(it)
                    scope.launch { drawer.close() }
                },
                onNewBot = {
                    scope.launch { drawer.close() }
                    onNavigate(Routes.BOT_NEW)
                },
                onNavigate = {
                    scope.launch { drawer.close() }
                    onNavigate(it)
                },
                onRetry = viewModel::retry,
                threads = threads,
            )
        },
    ) {
        Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).statusBarsPadding()) {
            HomeTopBar(
                bot = bot,
                bots = bots,
                onMenu = { scope.launch { drawer.open() } },
                onTitle = { if (bot != null) menu = true },
                onNewChat = { confirmNewChat = true },
            )
            when {
                bot != null -> ChatPane(
                    container = container,
                    bot = bot,
                    bots = bots,
                    onOpenLive = { surface -> onNavigate(Routes.liveBot(surface, bot.id)) },
                )
                bots.loading -> LoadingBox()
                bots.error != null -> EmptyState(
                    title = "Could not reach your server",
                    body = bots.error,
                    icon = AppIcons.Alert,
                    actionLabel = "Try again",
                    onAction = viewModel::retry,
                )
                bots.role == ViewerRole.Guest -> EmptyState(title = "Nothing shared with you yet", body = "When the owner shares a bot with you, it shows up here.", icon = AppIcons.Brand)
                else -> EmptyState(
                    title = "Create your first bot",
                    body = "A bot is a contact you chat with. Give it a name, a model and what it should be good at.",
                    icon = AppIcons.Brand,
                    actionLabel = "New bot",
                    onAction = { onNavigate(Routes.BOT_NEW) },
                )
            }
        }
    }

    if (menu && bot != null) {
        BotMenuSheet(
            bot = bot,
            bots = bots,
            session = sessions[bot.id],
            container = container,
            onDismiss = { menu = false },
            onNavigate = {
                menu = false
                onNavigate(it)
            },
            onTogglePin = {
                menu = false
                viewModel.togglePin(bot.id)
            },
        )
    }
    if (confirmNewChat && bot != null) {
        val chat: ChatViewModel = viewModel(key = "chat:${bot.id}", factory = viewModelFactory { initializer { ChatViewModel(container, bot.id) } })
        ConfirmDialog(
            title = "Start a new chat?",
            text = "${bot.name} starts fresh. This chat moves to past chats, where you can read or continue it.",
            confirmLabel = "New chat",
            onConfirm = {
                confirmNewChat = false
                chat.newChat()
            },
            onDismiss = { confirmNewChat = false },
        )
    }
}

@Composable
internal fun HomeTopBar(bot: BotListEntry?, bots: BotsState, onMenu: () -> Unit, onTitle: () -> Unit, onNewChat: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(Dims.composerMinHeight).padding(horizontal = S.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconBtn(AppIcons.Menu, "Open the menu", onMenu, iconSize = Dims.iconLarge)
        Row(
            Modifier
                .weight(1f)
                .padding(horizontal = S.xs)
                .clip(RoundedCornerShape(Dims.fieldRadius))
                .clickable(enabled = bot != null, role = Role.Button, onClickLabel = "Bot menu", onClick = onTitle)
                .padding(horizontal = S.xs, vertical = S.xs),
            horizontalArrangement = Arrangement.spacedBy(S.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (bot != null) BotAvatar(bot.name, size = Dims.avatarTopBar)
            Column(Modifier.weight(1f, fill = false)) {
                Text(
                    bot?.name ?: "Tiny Agents",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                val status = when {
                    bot == null -> null
                    bot.replying -> "Replying\u2026"
                    bot.needsYou -> "Waiting for you"
                    else -> null
                }
                if (status != null) {
                    Text(status, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                }
            }
            if (bot != null) AppIcon(AppIcons.ChevronDown, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, size = Dims.iconSmall)
        }
        if (bot != null && bots.role == ViewerRole.Owner) IconBtn(AppIcons.Compose, "New chat", onNewChat)
    }
}

@Composable
private fun BotMenuSheet(
    bot: BotListEntry,
    bots: BotsState,
    session: ChatSession?,
    container: AppContainer,
    onDismiss: () -> Unit,
    onNavigate: (String) -> Unit,
    onTogglePin: () -> Unit,
) {
    val guest = bots.role != ViewerRole.Owner
    Sheet(onDismiss = onDismiss) {
        Row(horizontalArrangement = Arrangement.spacedBy(S.md), verticalAlignment = Alignment.CenterVertically) {
            BotAvatar(bot.name, size = Dims.avatarSheet)
            Column(Modifier.weight(1f)) {
                Text(bot.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    bots.modelName(bot.modelId),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Row(Modifier.fillMaxWidth()) {
            val tile = Modifier.weight(1f)
            ActionTile(AppIcons.Globe, "Browser", { onNavigate(Routes.liveBot("browser", bot.id)) }, tile)
            ActionTile(AppIcons.Monitor, "Computer", { onNavigate(Routes.liveBot("computer", bot.id)) }, tile)
            if (!guest) {
                ActionTile(AppIcons.History, "Past chats", { onNavigate(Routes.history(bot.id)) }, tile)
                ActionTile(AppIcons.Layers, "Memory", { onNavigate(Routes.memory(bot.id)) }, tile)
            }
        }
        if (!guest) {
            Column(verticalArrangement = Arrangement.spacedBy(S.xxs)) {
                val yolo = session?.yolo == true
                MenuRow(
                    AppIcons.Zap,
                    "YOLO mode",
                    summary = "Run tools without asking (vault uses still ask)",
                    onClick = { container.chats.setYolo(bot.id, !yolo) },
                    trailing = { Switch(checked = yolo, onCheckedChange = { container.chats.setYolo(bot.id, it) }) },
                )
                MenuRow(AppIcons.Pin, if (bot.pinnedAt != null) "Unpin" else "Pin to the top", onClick = onTogglePin)
                MenuRow(AppIcons.Pencil, "Edit bot", onClick = { onNavigate(Routes.botEdit(bot.id)) })
            }
        }
    }
}
