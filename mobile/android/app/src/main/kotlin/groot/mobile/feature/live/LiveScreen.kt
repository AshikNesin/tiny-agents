package groot.mobile.feature.live

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.data.api.LiveStatus
import groot.mobile.ui.brand.Accents
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.brand.Dims
import groot.mobile.ui.components.BarKey
import groot.mobile.ui.components.ConfirmDialog
import groot.mobile.ui.components.EmptyState
import groot.mobile.ui.components.IconBtn
import groot.mobile.ui.components.KeyBar
import groot.mobile.ui.components.LoadingBox
import groot.mobile.ui.components.MenuRow
import groot.mobile.ui.components.PrimaryButton
import groot.mobile.ui.components.RemoteKeyboard
import groot.mobile.ui.components.ScreenScaffold
import groot.mobile.ui.components.SecondaryButton
import groot.mobile.ui.components.Sheet
import groot.mobile.ui.components.StatusDot
import tinyagents.vnc.Keysyms
import tinyagents.vnc.VncView

internal fun linkLabel(status: LiveStatus?, link: LiveLink): String = when {
    status == null -> "Loading"
    !status.configured -> "Not set up"
    status.starting -> "Starting"
    !status.active -> "Closed"
    status.mode == "headless" -> "Headless"
    link == LiveLink.Live -> if (status.driver == "human") "Live, you are in control" else "Live, watching"
    link == LiveLink.Connecting -> "Connecting"
    else -> "Reconnecting"
}

internal val LIVE_KEYS = listOf(
    BarKey(Keysyms.Escape, "esc", description = "Escape"),
    BarKey(Keysyms.Tab, "tab", description = "Tab"),
    BarKey(Keysyms.Control_L, "ctrl", description = "Control", sticky = true),
    BarKey(Keysyms.Alt_L, "alt", description = "Alt", sticky = true),
    BarKey(Keysyms.Super_L, "super", description = "Super", sticky = true),
    BarKey(Keysyms.Left, icon = AppIcons.ChevronLeft, description = "Left"),
    BarKey(Keysyms.Up, icon = AppIcons.ChevronUp, description = "Up"),
    BarKey(Keysyms.Down, icon = AppIcons.ChevronDown, description = "Down"),
    BarKey(Keysyms.Right, icon = AppIcons.ChevronRight, description = "Right"),
    BarKey(Keysyms.Return, "enter", description = "Enter"),
    BarKey(Keysyms.Delete, "del", description = "Delete"),
    BarKey(Keysyms.Home, "home", description = "Home"),
    BarKey(Keysyms.End, "end", description = "End"),
    BarKey(Keysyms.PageUp, "pgup", description = "Page up"),
    BarKey(Keysyms.PageDown, "pgdn", description = "Page down"),
)

@Composable
fun LiveRoute(container: AppContainer, target: LiveTarget, title: String, onBack: () -> Unit) {
    val viewModel: LiveViewModel = viewModel(
        key = "live:${target.surface}:${target.botId}:${target.profile}",
        factory = viewModelFactory { initializer { LiveViewModel(container, target) } },
    )
    LifecycleStartEffect(viewModel) {
        viewModel.show()
        onStopOrDispose { viewModel.hide() }
    }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val status = state.status
    val density = LocalDensity.current.density
    var keyboard by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var apps by remember { mutableStateOf(false) }
    var confirmReset by remember { mutableStateOf(false) }
    var held by remember { mutableStateOf(emptySet<Int>()) }
    val noun = if (target.isBrowser) "browser" else "computer"
    val interactive = state.driving && !state.guest && state.link == LiveLink.Live

    val press: (Int) -> Unit = { keysym ->
        viewModel.vnc.sendChord(*(held.toIntArray() + keysym))
        held = emptySet()
    }

    ScreenScaffold(
        title = title,
        subtitle = linkLabel(status, state.link),
        onBack = onBack,
        actions = {
            if (interactive) IconBtn(AppIcons.Keyboard, if (keyboard) "Hide the keyboard" else "Show the keyboard", onClick = { keyboard = !keyboard })
            if (!state.guest && status != null && status.configured) IconBtn(AppIcons.More, "More", onClick = { menu = true })
        },
    ) {
        Column(Modifier.fillMaxSize().imePadding()) {
            Box(Modifier.weight(1f).fillMaxWidth()) {
                LiveBody(status, state.loadError, state.guest, target.isBrowser, onStart = viewModel::start) {
                    VncView(
                        state = viewModel.vnc,
                        interactive = interactive,
                        modifier = Modifier.fillMaxSize(),
                        onViewSize = if (target.isBrowser && !state.guest) { w, h -> viewModel.onViewSize(w, h, density) } else null,
                        background = MaterialTheme.colorScheme.background,
                    )
                    if (state.link != LiveLink.Live) {
                        Row(
                            Modifier.align(Alignment.TopCenter).padding(S.sm).background(MaterialTheme.colorScheme.surfaceContainer, MaterialTheme.shapes.small).padding(horizontal = S.md, vertical = S.xs),
                            horizontalArrangement = Arrangement.spacedBy(S.sm),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            StatusDot(Accents.warning)
                            Text(linkLabel(status, state.link), style = MaterialTheme.typography.labelMedium)
                        }
                    }
                }
                RemoteKeyboard(
                    active = keyboard && interactive,
                    onText = { text ->
                        if (held.isEmpty()) {
                            viewModel.vnc.sendText(text)
                        } else {
                            text.codePoints().forEach { press(Keysyms.fromChar(it)) }
                        }
                    },
                    onBackspace = { press(Keysyms.BackSpace) },
                )
            }
            if (status?.viewable == true) {
                if (status.takeover != null) {
                    Text(
                        "The bot asks: ${status.takeover}",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer).padding(horizontal = S.lg, vertical = S.sm),
                    )
                }
                if (interactive) {
                    KeyBar(
                        keys = LIVE_KEYS,
                        held = held,
                        onKey = { keysym ->
                            val sticky = LIVE_KEYS.first { it.id == keysym }.sticky
                            if (sticky) held = if (keysym in held) held - keysym else held + keysym else press(keysym)
                        },
                    )
                }
                if (!state.guest) {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = S.lg, vertical = S.sm).then(if (keyboard) Modifier else Modifier.navigationBarsPadding()),
                        horizontalArrangement = Arrangement.spacedBy(S.sm),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (state.driving) {
                            PrimaryButton("Hand back", onClick = { viewModel.setDriver(false) }, modifier = Modifier.weight(1f))
                        } else {
                            PrimaryButton("Take control", icon = AppIcons.Pointer, onClick = { viewModel.setDriver(true) }, modifier = Modifier.weight(1f))
                        }
                        if (!target.isBrowser && state.driving) {
                            SecondaryButton("Apps", icon = AppIcons.Grid, onClick = {
                                viewModel.loadApps()
                                apps = true
                            })
                        }
                    }
                }
            }
        }
    }

    if (menu) {
        Sheet(onDismiss = { menu = false }, title = title) {
            if (status?.active == true) {
                MenuRow(AppIcons.Maximize, "Reset zoom", onClick = {
                    menu = false
                    viewModel.vnc.resetZoom()
                })
            }
            MenuRow(
                AppIcons.Refresh,
                "Reset the $noun",
                summary = if (target.isBrowser) "Closes it and signs it out of every site" else "Closes it and clears its settings and app state; files stay",
                destructive = true,
                onClick = {
                    menu = false
                    confirmReset = true
                },
            )
        }
    }
    if (apps) {
        Sheet(onDismiss = { apps = false }, title = "Open an app") {
            val list = state.apps
            if (list == null) {
                Text("Loading", color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                for (app in list) {
                    MenuRow(AppIcons.Grid, app.name, onClick = {
                        apps = false
                        viewModel.openApp(app)
                    })
                }
            }
        }
    }
    if (confirmReset) {
        ConfirmDialog(
            title = "Reset the $noun?",
            text = if (target.isBrowser) {
                "Every bot that shares this browser is signed out of every site."
            } else {
                "Settings and open apps are cleared for every bot that shares this desktop. Files in the home folder stay."
            },
            confirmLabel = "Reset",
            destructive = true,
            onConfirm = {
                confirmReset = false
                viewModel.reset()
            },
            onDismiss = { confirmReset = false },
        )
    }
}

@Composable
fun BoxScope.LiveBody(
    status: LiveStatus?,
    loadError: String?,
    guest: Boolean,
    isBrowser: Boolean,
    onStart: () -> Unit,
    picture: @Composable BoxScope.() -> Unit,
) {
    val noun = if (isBrowser) "browser" else "computer"
    when {
        status == null && loadError != null -> EmptyState("Could not load", body = loadError, icon = AppIcons.Alert)
        status == null -> LoadingBox()
        !status.configured -> EmptyState(
            "The $noun is not set up",
            icon = if (isBrowser) AppIcons.Globe else AppIcons.Monitor,
            body = status.setupHint ?: "This server has no sandbox to run it on.",
        )
        status.starting -> Column(
            Modifier.fillMaxSize().padding(S.xxl),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(S.md, Alignment.CenterVertically),
        ) {
            CircularProgressIndicator(Modifier.size(Dims.iconLarge), color = MaterialTheme.colorScheme.onSurfaceVariant, strokeWidth = Dims.stroke)
            Text(
                if (status.phase == "installing") "Setting up the $noun" else "Opening the $noun",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                if (status.phase == "installing") "The first time takes a few minutes while it installs on the sandbox." else "This takes a few seconds.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
        !status.active -> EmptyState(
            title = if (status.error != null) "The $noun could not open" else "The $noun is closed",
            icon = if (isBrowser) AppIcons.Globe else AppIcons.Monitor,
            body = status.error ?: if (guest) "It opens when the bot next uses it." else "It opens when a bot uses it, or you can open it now.",
            actionLabel = if (guest) null else if (status.error != null) "Try again" else "Open the $noun",
            onAction = onStart,
        )
        status.mode == "headless" -> EmptyState(
            "No live view",
            icon = AppIcons.Globe,
            body = status.setupHint ?: "This browser runs headless: the bot can use it, but there is nothing to watch.",
        )
        else -> picture()
    }
}
