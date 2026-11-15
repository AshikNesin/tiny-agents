package groot.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.github.takahirom.roborazzi.captureRoboImage
import groot.kit.theme.GrootTheme
import groot.kit.theme.ThemeMode
import groot.mobile.data.Session
import groot.mobile.data.api.BotListEntry
import groot.mobile.data.api.SessionUser
import groot.mobile.data.chat.ChatView
import groot.mobile.feature.about.AboutScreen
import groot.mobile.feature.auth.AuthScreen
import groot.mobile.feature.auth.AuthState
import groot.mobile.feature.bots.BotEditor
import groot.mobile.feature.chat.ChatContent
import groot.mobile.feature.home.AppDrawer
import groot.mobile.feature.home.HomeTopBar
import groot.mobile.feature.live.LIVE_KEYS
import groot.mobile.feature.live.LiveBody
import groot.mobile.feature.live.LiveLink
import groot.mobile.feature.live.linkLabel
import groot.mobile.feature.manage.RoutinesScreen
import groot.mobile.feature.manage.TasksScreen
import groot.mobile.feature.settings.SettingsScreen
import groot.mobile.feature.share.ShareDraft
import groot.mobile.feature.chat.StagedUpload
import groot.mobile.data.PickedFile
import groot.mobile.data.api.AttachmentRef
import android.net.Uri
import groot.mobile.feature.share.ShareSheet
import groot.mobile.feature.terminal.TERMINAL_KEYS
import groot.mobile.feature.terminal.TerminalLink
import groot.mobile.feature.terminal.TerminalTabs
import groot.mobile.ui.brand.BrandPalette
import groot.mobile.ui.components.KeyBar
import groot.mobile.ui.components.Loadable
import groot.mobile.ui.components.LocalAvatars
import groot.mobile.ui.components.LocalContainer
import groot.mobile.ui.components.ScreenScaffold
import groot.mobile.data.api.LiveStatus
import tinyagents.terminal.TerminalColors
import tinyagents.terminal.TerminalEmulator
import tinyagents.vnc.Keysyms
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import kotlinx.coroutines.runBlocking
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasClickAction

/**
 * Renders the app's screens with sample data to PNGs for review: `pnpm screenshots`
 * (`./gradlew :app:recordRoborazziDebug`) writes them to app/build/outputs/roborazzi.
 * Not a golden-image gate (RFC 0001 Q9); a normal test run only checks they render.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w412dp-h915dp-xxhdpi")
class ScreenshotTest {
    @get:Rule
    val compose = createComposeRule()

    @Test fun authServerDark() = capture("auth_server_dark", ThemeMode.Dark) { AuthScreen(AuthState(), {}, { _, _, _ -> }, {}) }

    @Test fun authSignInLight() = capture("auth_sign_in_light", ThemeMode.Light) {
        AuthScreen(AuthState(serverUrl = "https://agents.example.com"), {}, { _, _, _ -> }, {})
    }

    @Test fun chatDark() = capture("chat_dark", ThemeMode.Dark) { Chat(sampleBots[0], sampleChatView()) }

    @Test fun chatLight() = capture("chat_light", ThemeMode.Light) { Chat(sampleBots[0], sampleChatView()) }

    @Test fun chatQuestionDark() = capture("chat_question_dark", ThemeMode.Dark) {
        Chat(sampleBots[1], sampleChatView(sampleQuestionMessages), draft = "Also include last week's numbers")
    }

    @Test fun chatEmptyDark() = capture("chat_empty_dark", ThemeMode.Dark) {
        Chat(sampleBots[4], sampleChatView(emptyList(), busy = false))
    }

    @Test fun chatRoutineRunsDark() = capture("chat_routine_runs_dark", ThemeMode.Dark) { Chat(sampleBots[1], sampleRoutineChatView()) }

    @Test fun chatRoutineRunsOpenDark() = capture(
        "chat_routine_runs_open_dark",
        ThemeMode.Dark,
        act = { compose.onNode(hasClickAction() and hasContentDescription("ran 24", substring = true)).performClick() },
    ) { Chat(sampleBots[1], sampleRoutineChatView()) }

    @Test fun chatRoutineRunsLight() = capture("chat_routine_runs_light", ThemeMode.Light) { Chat(sampleBots[1], sampleRoutineChatView()) }

    @Test fun chatApprovalsDark() = capture("chat_approvals_dark", ThemeMode.Dark) {
        Chat(sampleBots[2], sampleChatView(sampleApprovalMessages, busy = false))
    }

    @Test fun chatApprovalsLight() = capture("chat_approvals_light", ThemeMode.Light) {
        Chat(sampleBots[2], sampleChatView(sampleApprovalMessages, busy = false))
    }

    @Test fun drawerDark() = capture("drawer_dark", ThemeMode.Dark) { Drawer() }

    @Test fun drawerLight() = capture("drawer_light", ThemeMode.Light) { Drawer() }

    @Test
    @Config(qualifiers = "w412dp-h1240dp-xxhdpi")
    fun settingsDark() = capture("settings_dark", ThemeMode.Dark) {
        SettingsScreen(
            themeMode = ThemeMode.Dark,
            onThemeModeChange = {},
            session = Session("https://agents.example.com", "token", SessionUser(1, "ashik@example.com", "Ashik")),
            guest = false,
            onSignOut = {},
            onOpenPeople = {},
            onResetData = {},
            buildInfo = fakeBuildInfo,
            onNavigateUp = {},
            onOpenAbout = {},
        )
    }

    @Test fun aboutDark() = capture("about_dark", ThemeMode.Dark) { AboutScreen(buildInfo = fakeBuildInfo, onNavigateUp = {}) }

    @Test
    @Config(qualifiers = "w412dp-h1600dp-xxhdpi")
    fun botEditorDark() = capture("bot_editor_dark", ThemeMode.Dark) {
        ScreenScaffold(title = "Edit bot", onBack = {}) { BotEditor(sampleEditorData, sampleEditorBotsState, onSave = {}, onDelete = {}) }
    }

    @Test fun botEditorNewLight() = capture("bot_editor_new_light", ThemeMode.Light) {
        ScreenScaffold(title = "New bot", onBack = {}) { BotEditor(sampleEditorData.copy(bot = null), sampleEditorBotsState, onSave = {}, onDelete = {}) }
    }

    @Test fun tasksDark() = capture("tasks_dark", ThemeMode.Dark) { Tasks(Loadable.Ready(sampleTasks)) }

    @Test fun tasksLight() = capture("tasks_light", ThemeMode.Light) { Tasks(Loadable.Ready(sampleTasks), title = "Call the bank") }

    @Test fun tasksEmptyDark() = capture("tasks_empty_dark", ThemeMode.Dark) { Tasks(Loadable.Ready(emptyList())) }

    @Test fun routinesDark() = capture("routines_dark", ThemeMode.Dark) { Routines(Loadable.Ready(sampleRoutines)) }

    @Test fun routinesLight() = capture("routines_light", ThemeMode.Light) { Routines(Loadable.Ready(sampleRoutines)) }

    @Test fun routinesFailedDark() = capture("routines_failed_dark", ThemeMode.Dark) { Routines(Loadable.Failed("Could not reach the server.")) }

    @Test fun liveClosedDark() = capture("live_closed_dark", ThemeMode.Dark) { Live("Travel Planner's browser", liveStatus(), isBrowser = true) }

    @Test fun liveNotSetUpDark() = capture("live_not_set_up_dark", ThemeMode.Dark) {
        Live("Computer", liveStatus(configured = false, setupHint = "Set SANDBOX_HOST on the server to give bots a desktop."), isBrowser = false)
    }

    @Test fun liveInstallingDark() = capture("live_installing_dark", ThemeMode.Dark) { Live("Ops's computer", liveStatus(starting = true, phase = "installing"), isBrowser = false) }

    @Test fun liveErrorLight() = capture("live_error_light", ThemeMode.Light) {
        Live("Travel Planner's browser", liveStatus(error = "Chrome did not start on the VM within 30s"), isBrowser = true)
    }

    @Test fun terminalDark() = capture("terminal_dark", ThemeMode.Dark) { Terminal(TerminalColors.dark().copy(background = MaterialTheme.colorScheme.background)) }

    @Test fun terminalLight() = capture("terminal_light", ThemeMode.Light) { Terminal(TerminalColors.light().copy(background = MaterialTheme.colorScheme.background)) }

    @Test
    @Config(qualifiers = "w412dp-h200dp-xxhdpi")
    fun keyBarsDark() = capture("key_bars_dark", ThemeMode.Dark) {
        Column(Modifier.background(MaterialTheme.colorScheme.background)) {
            KeyBar(keys = TERMINAL_KEYS, held = setOf(TERMINAL_KEYS[2].id), onKey = {})
            KeyBar(keys = LIVE_KEYS, held = setOf(Keysyms.Control_L), onKey = {})
        }
    }

    @Test fun shareDark() = capture("share_dark", ThemeMode.Dark) { Share(sampleShareDraft) }

    @Test fun shareLight() = capture("share_light", ThemeMode.Light) { Share(sampleShareDraft) }

    @Test fun shareLinkUploadingDark() = capture("share_link_uploading_dark", ThemeMode.Dark) {
        Share(
            sampleShareDraft.copy(
                botId = null,
                query = "r",
                note = "Which of these fits a long weekend?",
                sharedText = "Cheap flights to Goa\nhttps://example.com/flights/goa",
                staged = listOf(sampleShareDraft.staged[0].copy(ref = null), sampleShareDraft.staged[1].copy(ref = null, error = "Files can be up to 25 MB.")),
            ),
        )
    }

    @Test fun shareSignedOutDark() = capture("share_signed_out_dark", ThemeMode.Dark) { Share(sampleShareDraft, signedIn = false) }

    @Composable
    private fun Share(draft: ShareDraft, signedIn: Boolean = true) {
        ShareSheet(
            signedIn = signedIn,
            bots = sampleBotsState,
            draft = draft,
            onQueryChange = {},
            onSelect = {},
            onClearBot = {},
            onNoteChange = {},
            onRemoveStaged = {},
            onRemoveSharedText = {},
            onAttach = {},
            onSend = {},
            onRetry = {},
            onCancel = {},
            onOpenApp = {},
        )
    }

    private fun capture(name: String, mode: ThemeMode, act: () -> Unit = {}, content: @Composable () -> Unit) {
        val container = ApplicationProvider.getApplicationContext<GrootMobileApp>().container
        // Loaded up front: the avatar's first frame reads the cache, and the shot is taken on idle.
        val avatars = fakeAvatarStore().also { store -> runBlocking { sampleBots.forEach { store.load(it.name) } } }
        compose.setContent {
            GrootTheme(mode = mode, palette = BrandPalette) {
                CompositionLocalProvider(
                    LocalContainer provides container,
                    LocalAvatars provides avatars,
                    LocalContentColor provides MaterialTheme.colorScheme.onBackground,
                    content = content,
                )
            }
        }
        compose.waitForIdle()
        act()
        compose.waitForIdle()
        compose.onRoot().captureRoboImage("build/outputs/roborazzi/$name.png")
    }

    @Composable
    private fun Chat(bot: BotListEntry, view: ChatView, draft: String = "") {
        Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
            HomeTopBar(bot = bot, bots = sampleBotsState, onMenu = {}, onTitle = {}, onNewChat = {})
            ChatContent(
                bot = bot,
                view = view,
                canAnswer = true,
                guest = false,
                actions = sampleActions(bot.name),
                draft = draft,
                staged = emptyList(),
                listState = rememberLazyListState(),
                onDraftChange = {},
                onAttach = {},
                onRemoveStaged = {},
                onSend = {},
                onStop = {},
                onWithdraw = {},
                onLoadOlder = {},
                onOpenImage = {},
                onSaveFile = {},
                onCopy = {},
                onOpenLive = {},
                onYoloOff = {},
            )
        }
    }

    @Composable
    private fun Drawer() = AppDrawer(
        bots = sampleBotsState,
        selectedBotId = "b1",
        user = SessionUser(1, "ashik@example.com", "Ashik"),
        onSelectBot = {},
        onNewBot = {},
        onNavigate = {},
        onRetry = {},
        now = { FIXED_NOW },
    )

    @Composable
    private fun Tasks(state: Loadable<List<groot.mobile.data.api.OwnerTask>>, title: String = "") = TasksScreen(
        state = state,
        showDone = false,
        onShowDoneChange = {},
        title = title,
        onTitleChange = {},
        onAdd = {},
        onToggle = {},
        onOpen = {},
        onRetry = {},
        onBack = {},
    )

    @Composable
    private fun Routines(state: Loadable<List<groot.mobile.data.api.Routine>>) =
        RoutinesScreen(state = state, canCreate = true, onCreate = {}, onOpen = {}, onRetry = {}, onBack = {})

    @Composable
    private fun Live(title: String, status: LiveStatus, isBrowser: Boolean) {
        ScreenScaffold(title = title, subtitle = linkLabel(status, LiveLink.Idle), onBack = {}) {
            LiveBody(status, loadError = null, guest = false, isBrowser = isBrowser, onStart = {}) {}
        }
    }

    @Composable
    private fun Terminal(colors: TerminalColors) {
        val emulator = remember { TerminalEmulator(cols = 48, rows = 30, reply = {}).apply { feed(SAMPLE_TERMINAL_OUTPUT.toByteArray()) } }
        var version by remember { mutableLongStateOf(emulator.version) }
        ScreenScaffold(title = "Terminal", subtitle = "ta-term-2", onBack = {}) {
            TerminalTabs(
                tabs = sampleTerminalTabs,
                active = "ta-term-2",
                link = TerminalLink.Live,
                emulator = emulator,
                version = version,
                fontSize = 12f,
                colors = colors,
                held = emptySet(),
                keyboard = false,
                onSelect = {},
                onClose = {},
                onInput = {},
                onSizeChanged = { cols, rows ->
                    emulator.resize(cols, rows)
                    version = emulator.version
                },
                onTap = {},
                onReconnect = {},
                onKey = {},
            )
        }
    }
}

/** Android types (Uri) need Robolectric: kept out of TestFixtures, which plain JVM tests load. The share sheet with a CSV and a PDF shared to Researcher. */
private val sampleShareDraft = ShareDraft(
    botId = "b2",
    staged = listOf(
        StagedUpload(
            "s1",
            PickedFile(Uri.parse("content://files/artha-net-worth.csv"), "artha-net-worth.csv", "text/csv", 797),
            ref = AttachmentRef("up1", "file", "artha-net-worth.csv", "text/csv", 797),
        ),
        StagedUpload(
            "s2",
            PickedFile(Uri.parse("content://files/statement.pdf"), "Bank statement October.pdf", "application/pdf", 120_000),
            ref = AttachmentRef("up2", "file", "Bank statement October.pdf", "application/pdf", 120_000),
        ),
    ),
)
