package groot.mobile.feature.terminal

import android.content.ClipboardManager
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import groot.kit.theme.GrootTheme
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.data.api.TerminalTab
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.components.AppIcon
import groot.mobile.ui.components.BarKey
import groot.mobile.ui.components.ConfirmDialog
import groot.mobile.ui.components.EmptyState
import groot.mobile.ui.components.IconBtn
import groot.mobile.ui.components.KeyBar
import groot.mobile.ui.components.LoadingBox
import groot.mobile.ui.components.MenuRow
import groot.mobile.ui.components.RemoteKeyboard
import groot.mobile.ui.components.ScreenScaffold
import groot.mobile.ui.components.Sheet
import groot.mobile.ui.brand.Dims
import tinyagents.terminal.TerminalColors
import tinyagents.terminal.TerminalEmulator
import tinyagents.terminal.TerminalInput
import tinyagents.terminal.TerminalKey
import tinyagents.terminal.TerminalView
import tinyagents.terminal.TerminalViewState
import tinyagents.terminal.rememberTerminalViewState

internal sealed interface TermKeyAction {
    data class Key(val key: TerminalKey) : TermKeyAction
    data class Bytes(val text: String) : TermKeyAction
    data object Ctrl : TermKeyAction
    data object Alt : TermKeyAction
}

internal val TERMINAL_KEYS: List<BarKey<TermKeyAction>> = listOf(
    BarKey(TermKeyAction.Key(TerminalKey.ESCAPE), "esc", description = "Escape"),
    BarKey(TermKeyAction.Key(TerminalKey.TAB), "tab", description = "Tab"),
    BarKey(TermKeyAction.Ctrl, "ctrl", description = "Control", sticky = true),
    BarKey(TermKeyAction.Alt, "alt", description = "Alt", sticky = true),
    BarKey(TermKeyAction.Key(TerminalKey.UP), icon = AppIcons.ChevronUp, description = "Arrow up"),
    BarKey(TermKeyAction.Key(TerminalKey.DOWN), icon = AppIcons.ChevronDown, description = "Arrow down"),
    BarKey(TermKeyAction.Key(TerminalKey.LEFT), icon = AppIcons.ChevronLeft, description = "Arrow left"),
    BarKey(TermKeyAction.Key(TerminalKey.RIGHT), icon = AppIcons.ChevronRight, description = "Arrow right"),
    BarKey(TermKeyAction.Bytes("\u0003"), "^C", description = "Control C"),
    BarKey(TermKeyAction.Bytes("\u0004"), "^D", description = "Control D"),
    BarKey(TermKeyAction.Bytes("\u001a"), "^Z", description = "Control Z"),
    BarKey(TermKeyAction.Bytes("\u000c"), "^L", description = "Control L"),
    BarKey(TermKeyAction.Bytes("\u0012"), "^R", description = "Control R"),
    BarKey(TermKeyAction.Bytes("|"), "|", description = "Pipe"),
    BarKey(TermKeyAction.Bytes("/"), "/", description = "Slash"),
    BarKey(TermKeyAction.Bytes("\\"), "\\", description = "Backslash"),
    BarKey(TermKeyAction.Bytes("~"), "~", description = "Tilde"),
    BarKey(TermKeyAction.Bytes("-"), "-", description = "Minus"),
    BarKey(TermKeyAction.Key(TerminalKey.HOME), "home", description = "Home"),
    BarKey(TermKeyAction.Key(TerminalKey.END), "end", description = "End"),
    BarKey(TermKeyAction.Key(TerminalKey.PAGE_UP), "pgup", description = "Page up"),
    BarKey(TermKeyAction.Key(TerminalKey.PAGE_DOWN), "pgdn", description = "Page down"),
)

@Composable
fun TerminalRoute(container: AppContainer, onBack: () -> Unit) {
    val viewModel: TerminalViewModel = viewModel(factory = viewModelFactory { initializer { TerminalViewModel(container) } })
    LifecycleStartEffect(viewModel) {
        viewModel.show()
        onStopOrDispose { viewModel.hide() }
    }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val viewState = rememberTerminalViewState()
    var keyboard by rememberSaveable { mutableStateOf(true) }
    var menu by remember { mutableStateOf(false) }
    var held by remember { mutableStateOf(emptySet<TermKeyAction>()) }
    var fontSize by rememberSaveable { mutableFloatStateOf(DEFAULT_FONT_SP) }
    val background = MaterialTheme.colorScheme.background
    val dark = GrootTheme.isDark
    val colors = remember(dark, background) {
        (if (dark) TerminalColors.dark() else TerminalColors.light()).copy(background = background)
    }
    val ctrl = TermKeyAction.Ctrl in held
    val alt = TermKeyAction.Alt in held

    val type: (ByteArray) -> Unit = { bytes ->
        viewModel.send(bytes)
        viewState.scrollToBottom()
        held = emptySet()
    }

    ScreenScaffold(
        title = "Terminal",
        subtitle = when {
            state.status != "ready" -> null
            state.active == null -> "No tabs"
            else -> when (state.link) {
                TerminalLink.Live -> viewModel.emulator.title.ifBlank { state.active }
                TerminalLink.Connecting -> "Connecting"
                TerminalLink.Reconnecting -> "Reconnecting"
                TerminalLink.Ended -> "Session ended"
                TerminalLink.Idle -> state.active
            }
        },
        onBack = onBack,
        actions = {
            if (state.status == "ready") {
                IconBtn(AppIcons.Keyboard, if (keyboard) "Hide the keyboard" else "Show the keyboard", onClick = { keyboard = !keyboard })
                IconBtn(AppIcons.Plus, "New tab", onClick = viewModel::newTab)
                IconBtn(AppIcons.More, "More", onClick = { menu = true })
            }
        },
    ) {
        when {
            state.status == null && state.loadError != null -> EmptyState("Could not load", body = state.loadError, icon = AppIcons.Alert, actionLabel = "Try again", onAction = viewModel::refresh)
            state.status == null -> LoadingBox()
            state.status == "unconfigured" -> EmptyState(
                "The terminal is not set up",
                icon = AppIcons.Terminal,
                body = "This server has no sandbox to open a shell on. Set SANDBOX_HOST on the server.",
            )
            state.status == "unreachable" -> EmptyState(
                "The sandbox is unreachable",
                icon = AppIcons.Alert,
                body = state.message,
                actionLabel = "Try again",
                onAction = viewModel::refresh,
            )
            state.status == "tmux-missing" -> EmptyState(
                "tmux is not installed on the sandbox",
                icon = AppIcons.Terminal,
                body = state.installCommand?.let { "Run this on the sandbox, then try again:\n$it" },
                actionLabel = "Try again",
                onAction = viewModel::refresh,
            )
            state.tabs.isEmpty() -> EmptyState(
                "No tabs open",
                icon = AppIcons.Terminal,
                body = "A tab is a shell on the sandbox that keeps running when you leave.",
                actionLabel = "New tab",
                onAction = viewModel::newTab,
            )
            else -> TerminalTabs(
                tabs = state.tabs,
                active = state.active,
                link = state.link,
                emulator = viewModel.emulator,
                version = state.version,
                fontSize = fontSize,
                colors = colors,
                held = held,
                keyboard = keyboard,
                onSelect = viewModel::select,
                onClose = { viewModel.closeTab(it) },
                onInput = viewModel::send,
                onSizeChanged = viewModel::resize,
                onTap = { keyboard = true },
                onReconnect = viewModel::reconnect,
                onKey = { action ->
                    when (action) {
                        TermKeyAction.Ctrl, TermKeyAction.Alt -> held = if (action in held) held - action else held + action
                        is TermKeyAction.Key -> type(TerminalInput.key(action.key, ctrl = ctrl, alt = alt, applicationCursor = viewModel.emulator.applicationCursorKeys))
                        is TermKeyAction.Bytes -> type(TerminalInput.text(action.text, ctrl = ctrl, alt = alt))
                    }
                },
                viewState = viewState,
            ) {
                RemoteKeyboard(
                    active = keyboard && state.link == TerminalLink.Live,
                    onText = { text -> type(TerminalInput.text(text.replace('\n', '\r'), ctrl = ctrl, alt = alt)) },
                    onBackspace = { type(TerminalInput.key(TerminalKey.BACKSPACE, ctrl = ctrl, alt = alt)) },
                )
            }
        }
    }

    if (menu) {
        Sheet(onDismiss = { menu = false }, title = "Terminal") {
            MenuRow(AppIcons.Copy, "Paste", summary = "Type what is on the clipboard", onClick = {
                menu = false
                val clip = context.getSystemService(ClipboardManager::class.java)?.primaryClip?.getItemAt(0)?.coerceToText(context)?.toString()
                if (!clip.isNullOrEmpty()) type(TerminalInput.paste(clip, viewModel.emulator.bracketedPaste))
            })
            MenuRow(AppIcons.Plus, "Larger text", onClick = { fontSize = (fontSize + 1f).coerceAtMost(MAX_FONT_SP) })
            MenuRow(AppIcons.ChevronDown, "Smaller text", onClick = { fontSize = (fontSize - 1f).coerceAtLeast(MIN_FONT_SP) })
            MenuRow(AppIcons.Refresh, "Reconnect", onClick = {
                menu = false
                viewModel.reconnect()
            })
            state.active?.let { name ->
                MenuRow(AppIcons.Close, "Close this tab", destructive = true, onClick = {
                    menu = false
                    viewModel.closeTab(name)
                })
            }
        }
    }
    state.busyTab?.let { name ->
        ConfirmDialog(
            title = "Close the tab?",
            text = "${state.busyProcess ?: "Something"} is still running in it. Closing the tab stops it.",
            confirmLabel = "Close it",
            destructive = true,
            onConfirm = { viewModel.closeTab(name, force = true) },
            onDismiss = viewModel::dismissBusy,
        )
    }
}

@Composable
internal fun TerminalTabs(
    tabs: List<TerminalTab>,
    active: String?,
    link: TerminalLink,
    emulator: TerminalEmulator,
    version: Long,
    fontSize: Float,
    colors: TerminalColors,
    held: Set<TermKeyAction>,
    keyboard: Boolean,
    onSelect: (String) -> Unit,
    onClose: (String) -> Unit,
    onInput: (ByteArray) -> Unit,
    onSizeChanged: (cols: Int, rows: Int) -> Unit,
    onTap: () -> Unit,
    onReconnect: () -> Unit,
    onKey: (TermKeyAction) -> Unit,
    viewState: TerminalViewState = rememberTerminalViewState(),
    overlay: @Composable BoxScope.() -> Unit = {},
) {
    Column(Modifier.fillMaxSize().imePadding()) {
        TabStrip(tabs, active, onSelect = onSelect, onClose = onClose)
        Box(Modifier.weight(1f).fillMaxWidth().background(colors.background)) {
            TerminalView(
                emulator = emulator,
                version = version,
                modifier = Modifier.fillMaxSize().padding(horizontal = S.xs),
                fontSize = fontSize.sp,
                colors = colors,
                onInput = onInput,
                onSizeChanged = onSizeChanged,
                onTap = onTap,
                state = viewState,
            )
            if (link == TerminalLink.Ended) {
                Text(
                    "Session ended. Tap to reconnect.",
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier
                        .align(Alignment.Center)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.surfaceContainerHigh)
                        .clickable(role = Role.Button, onClick = onReconnect)
                        .padding(horizontal = S.lg, vertical = S.md),
                )
            }
            overlay()
        }
        KeyBar(
            keys = TERMINAL_KEYS,
            held = held,
            modifier = if (keyboard) Modifier else Modifier.navigationBarsPadding(),
            onKey = onKey,
        )
    }
}

@Composable
private fun TabStrip(tabs: List<TerminalTab>, active: String?, onSelect: (String) -> Unit, onClose: (String) -> Unit) {
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = S.sm, vertical = S.xs),
        horizontalArrangement = Arrangement.spacedBy(S.xs),
    ) {
        tabs.forEachIndexed { index, tab ->
            val selected = tab.name == active
            Row(
                Modifier
                    .clip(CircleShape)
                    .background(if (selected) MaterialTheme.colorScheme.surfaceContainerHigh else MaterialTheme.colorScheme.background)
                    .clickable(role = Role.Tab) { onSelect(tab.name) }
                    .padding(start = S.md, end = S.xs, top = S.xs, bottom = S.xs),
                horizontalArrangement = Arrangement.spacedBy(S.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "${index + 1} ${tab.process ?: "shell"}",
                    style = MaterialTheme.typography.labelMedium.copy(fontFamily = FontFamily.Monospace),
                    color = if (selected) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Box(
                    Modifier.clip(CircleShape).clickable(role = Role.Button, onClickLabel = "Close tab ${index + 1}") { onClose(tab.name) }.padding(S.xs),
                ) {
                    AppIcon(AppIcons.Close, "Close tab ${index + 1}", tint = MaterialTheme.colorScheme.onSurfaceVariant, size = Dims.iconSmall)
                }
            }
        }
    }
}

private const val DEFAULT_FONT_SP = 12f
private const val MIN_FONT_SP = 8f
private const val MAX_FONT_SP = 20f
