package groot.mobile

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.github.takahirom.roborazzi.captureRoboImage
import groot.kit.theme.GrootTheme
import groot.kit.theme.ThemeMode
import groot.mobile.data.api.BotStreamEvent
import groot.mobile.data.api.ChatState
import groot.mobile.data.api.MessageRole
import groot.mobile.data.api.RoutineRunCard
import groot.mobile.data.api.ToolStatus
import groot.mobile.data.api.VaultUse
import groot.mobile.data.chat.ChatAction
import groot.mobile.data.chat.ChatSession
import groot.mobile.data.chat.ToolLabels
import groot.mobile.data.chat.chatView
import groot.mobile.data.chat.reduceChat
import groot.mobile.feature.chat.ChatActions
import groot.mobile.feature.chat.ChatContent
import groot.mobile.feature.home.HomeTopBar
import groot.mobile.ui.brand.BrandPalette
import groot.mobile.ui.components.LocalAvatars
import groot.mobile.ui.components.LocalContainer
import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w412dp-h892dp-xxhdpi")
class DemoPhoneScreenshotTest {
    @get:Rule
    val compose = createComposeRule()

    @Test fun travelPlannerApproval() = film(bars = true, suffix = "")

    @Test fun travelPlannerApprovalBare() = film(bars = false, suffix = "-bare")

    private fun film(bars: Boolean, suffix: String) {
        val container = ApplicationProvider.getApplicationContext<GrootMobileApp>().container
        val avatars = fakeAvatarStore().also { store -> runBlocking { store.load(BOT) } }
        var session by mutableStateOf(waitingSession())
        var approvals by mutableStateOf(1)
        val actions = ChatActions(
            botName = BOT,
            labels = LABELS,
            askOnlyTools = emptySet(),
            readOnly = false,
            now = { NOW },
            onDecide = { _, approved, _, _ ->
                if (approved) {
                    session = approvedSession(session)
                    approvals = 0
                }
            },
            onAnswer = { _, _ -> },
            onOpenCredentials = {},
            onCancelCredentials = {},
            onOpenComputer = {},
            onOpenLink = {},
        )
        compose.setContent {
            GrootTheme(mode = ThemeMode.Light, palette = BrandPalette) {
                CompositionLocalProvider(
                    LocalContainer provides container,
                    LocalAvatars provides avatars,
                    LocalContentColor provides MaterialTheme.colorScheme.onBackground,
                ) {
                    PhoneScreen(bars) {
                        val bot = bot("travel", BOT, description = "Plans trips and watches fares", approvals = approvals, minutesAgo = 0)
                        HomeTopBar(bot = bot, bots = sampleBotsState, onMenu = {}, onTitle = {}, onNewChat = {})
                        ChatContent(
                            bot = bot,
                            view = chatView(session),
                            canAnswer = true,
                            guest = false,
                            actions = actions,
                            draft = "",
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
            }
        }
        compose.waitForIdle()
        val positions = StringBuilder("{\n")
        positions.append(shot("chat-waiting$suffix", WAITING_NODES))
        compose.onNode(hasText("Approve") and hasClickAction()).performClick()
        compose.waitForIdle()
        positions.append(",\n").append(shot("chat-approved$suffix", APPROVED_NODES)).append("\n}\n")
        File("$OUT/positions$suffix.json").writeText(positions.toString())
    }

    private fun shot(name: String, nodes: List<Pair<String, SemanticsMatcher>>): String {
        compose.onRoot().captureRoboImage("$OUT/$name.png")
        val root = compose.onRoot().fetchSemanticsNode()
        val density = root.layoutInfo.density.density
        val lines = nodes.mapNotNull { (key, matcher) ->
            val found = compose.onAllNodes(matcher).fetchSemanticsNodes()
            found.firstOrNull()?.let { "    \"$key\": ${rect(it, density)}" }
        }
        return "  \"$name\": {\n    \"density\": $density,\n" + lines.joinToString(",\n") + "\n  }"
    }

    private fun rect(node: SemanticsNode, density: Float): String {
        val b: Rect = node.boundsInRoot
        fun dp(v: Float) = "%.1f".format(java.util.Locale.ROOT, v / density)
        return "{\"px\": {\"x\": ${b.left.toInt()}, \"y\": ${b.top.toInt()}, \"w\": ${b.width.toInt()}, \"h\": ${b.height.toInt()}}, " +
            "\"dp\": {\"x\": ${dp(b.left)}, \"y\": ${dp(b.top)}, \"w\": ${dp(b.width)}, \"h\": ${dp(b.height)}}}"
    }

    private companion object {
        const val OUT = "build/outputs/roborazzi/demo-launch"
        const val BOT = "Travel Planner"

        val CLOCK: String = System.getenv("DEMO_CLOCK") ?: "6:42"

        const val RUN_FINISHED = FIXED_NOW + 103 * 60_000 + 20_000
        const val REPLY_AT = RUN_FINISHED + 20_000
        const val CARD_AT = RUN_FINISHED + 30_000
        const val NOW = CARD_AT + 20_000

        val LABELS = ToolLabels(
            done = mapOf("browser_fill_secret" to "Filled a saved login"),
            ask = mapOf("browser_fill_secret" to "fill a saved login"),
        )

        val RUN = RoutineRunCard(
            id = "run-1",
            routineId = "morning-fare-check",
            routineName = "Morning fare check",
            status = "succeeded",
            trigger = "schedule",
            scheduledFor = RUN_FINISHED,
            finishedAt = RUN_FINISHED,
            output = null,
            error = null,
        )

        val REPLY = message(
            "e2",
            MessageRole.Assistant,
            "Goa fares dropped ₹4,200. The 6:15 AM nonstop on Friday is ₹5,840, under your ₹6,000 limit, so I'm booking two seats.",
        ).copy(createdAt = REPLY_AT)

        val FILL = tool("browser_fill_secret", mapOf("handle" to "visa", "field" to "card"), status = ToolStatus.AwaitingApproval, taskId = 71, durationMs = null).copy(
            vault = VaultUse(
                handle = "visa",
                label = "Visa ••4242",
                kind = "card",
                tool = "browser_fill_secret",
                target = "flights.example.com",
                cardBrand = "Visa",
                cardLast4 = "4242",
                username = null,
                grantable = false,
                env = emptyList(),
                hosts = emptyList(),
            ),
            expiresAt = CARD_AT + 10 * 60_000,
        )

        val ASK = message("e3", MessageRole.Assistant, "", toolCalls = listOf(FILL)).copy(createdAt = CARD_AT)

        fun waitingSession(): ChatSession =
            reduceChat(ChatSession(), ChatAction.Stream(BotStreamEvent.Snapshot(ChatState(listOf(REPLY, ASK), busy = true, queued = emptyList(), hasMore = false))))
                .let { reduceChat(it, ChatAction.Stream(BotStreamEvent.RoutineRuns(listOf(RUN)))) }

        fun approvedSession(session: ChatSession): ChatSession {
            val done = FILL.copy(status = ToolStatus.Done, approval = "approved", durationMs = 1_200, waitedMs = 9_000, expiresAt = null)
            return reduceChat(session, ChatAction.Stream(BotStreamEvent.Upsert(ASK.copy(toolCalls = listOf(done)))))
                .let { reduceChat(it, ChatAction.Stream(BotStreamEvent.Busy(false))) }
        }

        val WAITING_NODES = listOf(
            "approveButton" to (hasText("Approve") and hasClickAction()),
            "denyButton" to (hasText("Deny") and hasClickAction()),
            "cardTitle" to hasText("Travel Planner wants to fill", substring = true),
            "cardBody" to hasText("The value goes straight", substring = true),
            "vaultLabel" to hasText("Vault"),
            "reply" to hasText("Goa fares dropped", substring = true),
            "routineLine" to hasContentDescription("Morning fare check", substring = true),
            "topBarTitle" to hasText(BOT),
            "topBarStatus" to hasText("Waiting for you"),
            "composerPlaceholder" to hasText("Message $BOT"),
            "stopButton" to hasContentDescription("Stop the reply"),
        )

        val APPROVED_NODES = listOf(
            "settledLine" to hasText("Filled a saved login", substring = true),
            "reply" to hasText("Goa fares dropped", substring = true),
            "routineLine" to hasContentDescription("Morning fare check", substring = true),
            "topBarTitle" to hasText(BOT),
            "composerPlaceholder" to hasText("Message $BOT"),
            "sendButton" to hasContentDescription("Send"),
        )
    }

    @Composable
    private fun PhoneScreen(bars: Boolean, app: @Composable () -> Unit) {
        Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
            if (bars) StatusBar()
            Column(Modifier.weight(1f).fillMaxWidth()) { app() }
            if (bars) GestureHandle()
        }
    }

    @Composable
    private fun StatusBar() {
        val ink = MaterialTheme.colorScheme.onBackground
        Row(
            Modifier.fillMaxWidth().height(36.dp).padding(horizontal = 24.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(CLOCK, color = ink, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            Spacer(Modifier.weight(1f))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                WifiGlyph(ink)
                SignalGlyph(ink)
                BatteryGlyph(ink)
            }
        }
    }

    @Composable
    private fun WifiGlyph(ink: Color) = Canvas(Modifier.size(16.dp)) {
        val r = size.width * 0.72f
        val center = Offset(size.width / 2, size.height * 0.86f)
        drawArc(ink, startAngle = 225f, sweepAngle = 90f, useCenter = true, topLeft = Offset(center.x - r, center.y - r), size = Size(r * 2, r * 2))
    }

    @Composable
    private fun SignalGlyph(ink: Color) = Canvas(Modifier.size(16.dp)) {
        val pad = size.width * 0.12f
        val path = Path().apply {
            moveTo(size.width - pad, pad)
            lineTo(size.width - pad, size.height - pad)
            lineTo(pad, size.height - pad)
            close()
        }
        drawPath(path, ink)
    }

    @Composable
    private fun BatteryGlyph(ink: Color) = Canvas(Modifier.width(10.dp).height(16.dp)) {
        val cap = size.height * 0.1f
        drawRoundRect(ink, topLeft = Offset(size.width * 0.3f, 0f), size = Size(size.width * 0.4f, cap * 1.5f), cornerRadius = CornerRadius(cap / 2))
        drawRoundRect(ink, topLeft = Offset(0f, cap), size = Size(size.width, size.height - cap), cornerRadius = CornerRadius(size.width * 0.2f))
    }

    @Composable
    private fun GestureHandle() {
        Box(Modifier.fillMaxWidth().height(24.dp), contentAlignment = Alignment.Center) {
            Box(Modifier.width(108.dp).height(4.dp).background(MaterialTheme.colorScheme.onBackground, CircleShape))
        }
    }
}
