package groot.mobile

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import groot.kit.buildinfo.BuildInfo
import groot.mobile.data.AvatarStore
import groot.mobile.data.BotsState
import groot.mobile.data.api.AttachmentRef
import groot.mobile.data.api.Bot
import groot.mobile.data.api.BotListEntry
import groot.mobile.data.api.BotStreamEvent
import groot.mobile.data.api.Capability
import groot.mobile.data.api.CatalogModel
import groot.mobile.data.api.ChatMessage
import groot.mobile.data.api.ChatState
import groot.mobile.data.api.Connection
import groot.mobile.data.api.Guest
import groot.mobile.data.api.LiveStatus
import groot.mobile.data.api.MessageRole
import groot.mobile.data.api.MessageStatus
import groot.mobile.data.api.ModelsResponse
import groot.mobile.data.api.OwnerQuestion
import groot.mobile.data.api.OwnerTask
import groot.mobile.data.api.QuestionOption
import groot.mobile.data.api.QueuedMessage
import groot.mobile.data.api.Routine
import groot.mobile.data.api.RoutineRunCard
import groot.mobile.data.api.Schedule
import groot.mobile.data.api.Skill
import groot.mobile.data.api.Source
import groot.mobile.data.api.TerminalTab
import groot.mobile.data.api.ToolCall
import groot.mobile.data.api.ToolInfo
import groot.mobile.data.api.ToolStatus
import groot.mobile.data.chat.ChatAction
import groot.mobile.data.chat.ChatSession
import groot.mobile.data.chat.ChatView
import groot.mobile.data.chat.ToolLabels
import groot.mobile.data.chat.chatView
import groot.mobile.data.chat.reduceChat
import groot.mobile.feature.bots.BotEditorData
import groot.mobile.feature.chat.ChatActions
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody

/** In-memory DataStore: unit tests never touch the disk. */
class FakePreferencesDataStore : DataStore<Preferences> {
    private val state = MutableStateFlow(emptyPreferences())
    override val data: Flow<Preferences> = state

    override suspend fun updateData(transform: suspend (t: Preferences) -> Preferences): Preferences =
        transform(state.value).also { state.value = it }
}

val fakeBuildInfo = BuildInfo(versionName = "0.1.0", versionCode = 1, commit = "3a4fd6d", isDebug = true)

/** Every test date derives from this instant, never from the clock. */
const val FIXED_NOW = 1_794_700_000_000L

fun bot(
    id: String,
    name: String,
    preview: String? = null,
    description: String = "",
    unread: Boolean = false,
    replying: Boolean = false,
    approvals: Int = 0,
    pinned: Boolean = false,
    minutesAgo: Long = 5,
) = BotListEntry(
    id = id,
    conversationId = "c-$id",
    name = name,
    description = description,
    modelId = "m1",
    lastMessagePreview = preview,
    lastActivityAt = FIXED_NOW - minutesAgo * 60_000,
    lastReadAt = null,
    unread = unread,
    replying = replying,
    approvals = approvals,
    questions = 0,
    pinnedAt = if (pinned) FIXED_NOW else null,
)

val sampleBots = listOf(
    bot("b1", "Travel Planner", "Found three flights under ₹6,000. Want me to hold one?", pinned = true, replying = true, minutesAgo = 1),
    bot("b2", "Researcher", "Here is the summary of the paper you sent.", unread = true, minutesAgo = 12),
    bot("b3", "Ops", "Wants to run a command on the sandbox", approvals = 2, minutesAgo = 40),
    bot("b4", "Writer", "Draft two is ready. I tightened the intro.", minutesAgo = 180),
    bot("b5", "Finance", null, description = "Tracks invoices and reminders", minutesAgo = 3000),
)

val sampleLabels = ToolLabels(
    done = mapOf("web_search" to "Searched the web", "web_fetch" to "Read a page", "browser_open" to "Opened a page", "run_command" to "Ran a command"),
    ask = mapOf("web_search" to "search the web", "browser_open" to "open a page", "run_command" to "run a command"),
)

val sampleBotsState = BotsState(
    bots = sampleBots,
    loading = false,
    models = ModelsResponse(
        models = listOf(CatalogModel("m1", "Claude Sonnet 5.5", "Anthropic", "claude-sonnet-5-5", vision = true, reasoning = true, enabled = true, available = true, unavailableReason = null, note = null)),
        defaultModelId = "m1",
        canAnswer = true,
        providers = emptyList(),
    ),
    labels = sampleLabels,
)

fun message(
    id: String,
    role: MessageRole,
    text: String,
    toolCalls: List<ToolCall> = emptyList(),
    status: MessageStatus = MessageStatus.Done,
    attachments: List<AttachmentRef> = emptyList(),
    reasoning: String? = null,
    minutesAgo: Long = 5,
) = ChatMessage(
    id = id,
    role = role,
    text = text,
    toolCalls = toolCalls,
    status = status,
    attachments = attachments,
    reasoning = reasoning,
    createdAt = FIXED_NOW - minutesAgo * 60_000,
)

fun tool(
    name: String,
    args: Map<String, Any?> = emptyMap(),
    status: ToolStatus = ToolStatus.Done,
    taskId: Int? = null,
    durationMs: Long? = 800,
    sources: List<Source> = emptyList(),
    questions: List<OwnerQuestion>? = null,
) = ToolCall(id = "$name-${args.hashCode()}", name = name, args = args, status = status, taskId = taskId, durationMs = durationMs, sources = sources, questions = questions)

val sampleMessages = listOf(
    message("e1", MessageRole.User, "Plan a weekend in Bangalore, flying from Chennai on Friday evening.", minutesAgo = 9),
    message(
        "e2",
        MessageRole.Assistant,
        "Here is a plan that keeps Saturday free for the city.\n\n" +
            "## Flights\n- **IndiGo 6E 512**, 18:40 to 19:45, ₹4,850\n- **Air India AI 564**, 20:10 to 21:15, ₹5,320\n\n" +
            "## Stay\nA room near *Indiranagar* puts you close to the metro. I can book either flight once you pick one.",
        toolCalls = listOf(
            tool("web_search", mapOf("query" to "Chennai to Bangalore flights Friday evening"), sources = listOf(Source("https://www.google.com/travel/flights", "Google Flights"), Source("https://www.goindigo.in", "IndiGo"))),
            tool("web_fetch", mapOf("url" to "https://www.goindigo.in/flights")),
            tool("web_fetch", mapOf("url" to "https://www.airindia.com/in/en/book.html")),
        ),
        reasoning = "The user wants an evening departure, so filter after 18:00.",
        minutesAgo = 8,
    ),
    message("e3", MessageRole.User, "Book the IndiGo one.", minutesAgo = 2),
    message(
        "e4",
        MessageRole.Assistant,
        "",
        toolCalls = listOf(tool("browser_open", mapOf("url" to "https://www.goindigo.in/booking"), status = ToolStatus.AwaitingApproval, taskId = 41, durationMs = null)),
        minutesAgo = 1,
    ),
)

fun sampleSession(messages: List<ChatMessage> = sampleMessages, busy: Boolean = true, queued: List<QueuedMessage> = emptyList()): ChatSession =
    reduceChat(ChatSession(), ChatAction.Stream(BotStreamEvent.Snapshot(ChatState(messages, busy, queued, hasMore = false))))

fun sampleChatView(messages: List<ChatMessage> = sampleMessages, busy: Boolean = true, queued: List<QueuedMessage> = emptyList()): ChatView =
    chatView(sampleSession(messages, busy, queued))

val sampleQuestionMessages = listOf(
    message("e1", MessageRole.User, "Set up a weekly report for me.", minutesAgo = 3),
    message(
        "e2",
        MessageRole.Assistant,
        "",
        toolCalls = listOf(
            tool(
                "ask_owner",
                status = ToolStatus.AwaitingAnswer,
                taskId = 52,
                durationMs = null,
                questions = listOf(
                    OwnerQuestion("Which day should it arrive?", "I will schedule a routine for it.", listOf(QuestionOption("Monday", null), QuestionOption("Friday", null), QuestionOption("Sunday", null)), multiple = false),
                ),
            ),
        ),
        minutesAgo = 2,
    ),
)

fun sampleActions(botName: String = "Travel Planner") = ChatActions(
    botName = botName,
    labels = sampleLabels,
    askOnlyTools = emptySet(),
    readOnly = false,
    now = { FIXED_NOW },
    onDecide = { _, _, _, _ -> },
    onAnswer = { _, _ -> },
    onOpenCredentials = {},
    onCancelCredentials = {},
    onOpenComputer = {},
    onOpenLink = {},
)

fun task(id: String, title: String, status: String = "todo", priority: String = "medium", description: String = "", daysAgo: Long = 1) = OwnerTask(
    id = id,
    title = title,
    description = description,
    status = status,
    priority = priority,
    dueAt = null,
    completedAt = if (status == "done") FIXED_NOW - daysAgo * 3_600_000 else null,
    createdAt = FIXED_NOW - daysAgo * 86_400_000,
)

val sampleTasks = listOf(
    task("t1", "Renew the passport before the Singapore trip", priority = "urgent", description = "Appointment slots open on Mondays"),
    task("t2", "Send the Q3 invoice to Acme", status = "in_progress", priority = "high"),
    task("t3", "Book a table for Saturday dinner"),
    task("t4", "Read the paper Researcher summarised", priority = "low"),
    task("t5", "Pay the electricity bill", status = "done"),
)

fun routine(id: String, name: String, botId: String, botName: String, description: String, enabled: Boolean = true, blockedStreak: Int = 0, pausedReason: String? = null) = Routine(
    id = id,
    botId = botId,
    botName = botName,
    name = name,
    prompt = "Do the $name.",
    schedule = Schedule.Cron("0 9 * * *"),
    scheduleDescription = description,
    enabled = enabled,
    nextRunAt = if (enabled) FIXED_NOW + 3 * 3_600_000 else null,
    done = false,
    blockedStreak = blockedStreak,
    pausedReason = pausedReason,
)

val sampleRoutines = listOf(
    routine("r1", "Morning summary", "b2", "Researcher", "Every day at 09:00"),
    routine("r2", "Invoice reminders", "b5", "Finance", "Weekdays at 10:30"),
    routine("r3", "Fare watch, Chennai to Singapore", "b1", "Travel Planner", "Every 6 hours", blockedStreak = 2),
    routine("r4", "Weekly draft review", "b4", "Writer", "Fridays at 17:00", enabled = false),
    routine("r5", "Server disk check", "b3", "Ops", "Every hour", enabled = false, pausedReason = "Paused after 3 blocked runs"),
)

fun liveStatus(configured: Boolean = true, active: Boolean = false, starting: Boolean = false, phase: String? = null, error: String? = null, setupHint: String? = null) = LiveStatus(
    configured = configured,
    setupHint = setupHint,
    active = active,
    starting = starting,
    phase = phase,
    error = error,
    driver = null,
    mode = "vnc",
    url = null,
    scale = 2.0,
    width = 1280,
    height = 800,
    takeover = null,
)

val sampleTerminalTabs = listOf(
    TerminalTab("ta-term-1", "htop", attached = false, createdAt = FIXED_NOW - 3_600_000),
    TerminalTab("ta-term-2", null, attached = true, createdAt = FIXED_NOW - 60_000),
)

/** A shell session in colour: a prompt, ls output and a failing command. */
const val SAMPLE_TERMINAL_OUTPUT =
    "\u001b[1;32mexedev@sandbox\u001b[0m:\u001b[1;34m~/project\u001b[0m$ ls --color\r\n" +
        "\u001b[1;34msrc\u001b[0m  \u001b[1;34mtests\u001b[0m  package.json  \u001b[1;32mrun.sh\u001b[0m  README.md\r\n" +
        "\u001b[1;32mexedev@sandbox\u001b[0m:\u001b[1;34m~/project\u001b[0m$ pnpm test\r\n" +
        "\u001b[32m\u2713\u001b[0m chat reducer (14 tests)\r\n" +
        "\u001b[31m\u2717\u001b[0m terminal resize \u001b[2m(1 failed)\u001b[0m\r\n" +
        "\u001b[33mwarn\u001b[0m 2 tests were skipped\r\n" +
        "\u001b[1;32mexedev@sandbox\u001b[0m:\u001b[1;34m~/project\u001b[0m$ "

private fun toolInfo(name: String, label: String, askLabel: String, readOnly: Boolean = false, askOnly: Boolean = false) =
    ToolInfo(name, label, askLabel, "", readOnly = readOnly, allowByDefault = false, askOnly = askOnly, unattendedOnly = false)

val sampleCapabilities = listOf(
    Capability("web", "toolkit", "Web", "Search the web and read pages", listOf(toolInfo("web_search", "Searched the web", "search the web", readOnly = true), toolInfo("web_fetch", "Read a page", "read a page", readOnly = true)), setupHint = null, auto = false),
    Capability("browser", "toolkit", "Browser", "Use its own Chrome on the sandbox", listOf(toolInfo("browser_open", "Opened a page", "open a page"), toolInfo("browser_click", "Clicked", "click on a page")), setupHint = null, auto = false),
    Capability("sandbox", "toolkit", "Sandbox", "Run commands on the sandbox VM", listOf(toolInfo("run_command", "Ran a command", "run a command", askOnly = true)), setupHint = "Set SANDBOX_HOST on the server to use it.", auto = false),
)

val sampleEditorBot = Bot(
    id = "b1",
    name = "Travel Planner",
    description = "Finds flights and stays, and books them when asked",
    systemPrompt = "You plan trips for me. Prefer evening flights, aisle seats and hotels near a metro station. Always ask before paying.",
    modelId = "m1",
    conversationId = "c-b1",
    lastReadAt = null,
    memoryEnabled = true,
    autoReview = false,
    yoloByDefault = false,
    pinnedAt = FIXED_NOW,
    browserProfile = "own",
    toolPermissions = mapOf("browser_open" to "allow"),
    skillIds = listOf("s1"),
    connectionIds = emptyList(),
    guestIds = listOf(2),
)

val sampleEditorData = BotEditorData(
    bot = sampleEditorBot,
    skills = listOf(
        Skill("s1", "Trip checklist", "", "", 1, "local", null, listOf("b1")),
        Skill("s2", "Expense report", "", "", 2, "local", null, emptyList()),
    ),
    connections = listOf(Connection("k1", "Google Calendar", "https://mcp.example.com/calendar", "oauth", "connected", null, emptyList(), emptyList())),
    guests = listOf(Guest(2, "priya@example.com", "Priya", listOf("b1")), Guest(3, "sam@example.com", null, emptyList())),
)

val sampleEditorBotsState = sampleBotsState.copy(capabilities = sampleCapabilities)

/**
 * An [AvatarStore] whose "network" is the faces bundled under `src/test/resources/avatars`
 * (DiceBear gaze PNGs for the sample bots), so screenshots show real avatars with no network.
 * Any other name answers 404, which draws the initial.
 */
fun fakeAvatarStore(): AvatarStore = AvatarStore(
    cacheDir = null,
    client = OkHttpClient.Builder().addInterceptor { chain ->
        val seed = chain.request().url.queryParameter("seed").orEmpty()
        val bytes = AvatarStore::class.java.getResourceAsStream("/avatars/${seed.replace(' ', '_')}.png")?.use { it.readBytes() }
        Response.Builder()
            .request(chain.request())
            .protocol(Protocol.HTTP_1_1)
            .code(if (bytes != null) 200 else 404)
            .message(if (bytes != null) "OK" else "Not Found")
            .body((bytes ?: ByteArray(0)).toResponseBody("image/png".toMediaType()))
            .build()
    }.build(),
)

fun routineRun(id: String, name: String, minutesAgo: Long, status: String = "succeeded", output: String? = "Nothing new from your key senders.", error: String? = null) =
    RoutineRunCard(id, "r-$name", name, status, "schedule", 0, FIXED_NOW - minutesAgo * 60_000, output, error)

/** A chat an hourly-ish routine has run in all day: 24 runs back to back, one blocked, one failed. */
fun sampleRoutineChatView(): ChatView {
    val runs = (0 until 24).map { i ->
        val minutesAgo = 380L - i * 15
        when (i) {
            7 -> routineRun("p$i", "Process emails from key senders", minutesAgo, status = "blocked", output = null, error = "Gmail asked to sign in again.")
            15 -> routineRun("p$i", "Process emails from key senders", minutesAgo, status = "failed", output = null, error = "The model timed out.")
            else -> routineRun("p$i", "Process emails from key senders", minutesAgo)
        }
    } + routineRun("m1", "Morning summary", 2, output = "Three meetings today; the first at 10:00.")
    val messages = listOf(
        message("r1", MessageRole.User, "Check my inbox for mails from my key senders every 15 minutes.", minutesAgo = 400),
        message("r2", MessageRole.Assistant, "Done. I set up the routine **Process emails from key senders**.", minutesAgo = 399),
        message("r3", MessageRole.User, "Anything from Priya today?", minutesAgo = 10),
        message("r4", MessageRole.Assistant, "Not yet. I will tell you when something arrives.", minutesAgo = 9),
    )
    return chatView(sampleSession(messages, busy = false).copy(routineRuns = runs))
}
