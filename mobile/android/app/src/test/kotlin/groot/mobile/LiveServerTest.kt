package groot.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import groot.mobile.data.BotsStore
import groot.mobile.data.Notices
import groot.mobile.data.api.ApiClient
import groot.mobile.data.api.jsonOf
import groot.mobile.data.api.CodeThreadSummary
import groot.mobile.data.api.CodeProject
import groot.mobile.data.api.CodeApi
import groot.mobile.data.api.ApiException
import groot.mobile.data.api.ApiSession
import groot.mobile.data.api.BotDraft
import groot.mobile.data.api.ChatMessage
import groot.mobile.data.api.MessageRole
import groot.mobile.data.api.MessageStatus
import groot.mobile.data.api.OwnerAnswer
import groot.mobile.data.api.Schedule
import groot.mobile.data.api.TinyAgentsApi
import groot.mobile.data.api.ToolStatus
import groot.mobile.data.code.CodeWorkflow
import groot.mobile.data.code.codeStatusSections
import groot.mobile.data.code.codeWorkflows
import groot.mobile.data.code.lastTurn
import groot.mobile.data.chat.ChatSession
import groot.mobile.data.chat.ChatStore
import groot.mobile.data.chat.OwnerSubmission
import groot.mobile.data.chat.chatView
import groot.mobile.data.vault.VaultPolicyDraft
import groot.mobile.data.vault.vaultCreateBody
import groot.mobile.data.vault.vaultPolicyBody
import groot.mobile.data.vault.vaultValueBody
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

@RunWith(AndroidJUnit4::class)
@Config(sdk = [36])
class LiveServerTest {
    private val url: String? = System.getenv("TINY_AGENTS_URL")
    private val email = System.getenv("TINY_AGENTS_EMAIL") ?: "demo@example.com"
    private val password = System.getenv("TINY_AGENTS_PASSWORD") ?: "demo@example.com"

    private class Session(override val serverUrl: String?) : ApiSession {
        override var token: String? = null
        var invalidated = 0
        override fun onSessionInvalid() {
            invalidated++
        }
    }

    private lateinit var session: Session
    private lateinit var api: TinyAgentsApi
    private lateinit var scope: CoroutineScope
    private val notices = Notices()
    private val stamp = System.nanoTime().toString(36)
    private val created = mutableListOf<String>()

    @Before
    fun signIn() {
        assumeTrue("TINY_AGENTS_URL is not set", url != null)
        session = Session(url)
        api = TinyAgentsApi(ApiClient(session))
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        runBlocking { session.token = api.login(email, password).token }
    }

    @After
    fun cleanUp() {
        if (url == null) return
        runBlocking { for (id in created) runCatching { api.deleteBot(id) } }
        scope.cancel()
    }

    private suspend fun newBot(name: String = "Mobile $stamp"): String {
        val models = api.models()
        val bot = api.createBot(BotDraft(name = name, description = "Android integration test", modelId = models.defaultModelId ?: models.models.first().id))
        created.add(bot.id)
        return bot.id
    }

    private suspend fun ChatStore.await(botId: String, timeoutMs: Long = 60_000, until: (ChatSession) -> Boolean): ChatSession =
        withTimeout(timeoutMs) { sessions.first { map -> map[botId]?.let(until) == true }.getValue(botId) }

    private fun ChatSession.lastReply(): ChatMessage? = messages.lastOrNull { it.role == MessageRole.Assistant }

    @Test
    fun `signs in, reads the account and refuses a bad token`() = runBlocking {
        assertFalse(api.needsSetup())
        assertEquals(email, api.me().email)
        assertFalse(api.isGuest())

        val stranger = Session(url).apply { token = "bad" }
        val error = runCatching { TinyAgentsApi(ApiClient(stranger)).bots() }.exceptionOrNull()
        assertTrue(error is ApiException && error.status == 401 && error.code == ApiClient.SESSION_INVALID)
        assertEquals(1, stranger.invalidated)

        val wrong = runCatching { api.login(email, "wrong-password") }.exceptionOrNull()
        assertTrue(wrong is ApiException && wrong.status == 401)
        assertEquals("a wrong password is not a dead session", 0, session.invalidated)
    }

    @Test
    fun `a streamed chat, steering, and the bot list following it`() = runBlocking {
        val botId = newBot()
        val bots = BotsStore(api, scope, notices)
        bots.start()
        withTimeout(20_000) { bots.state.first { it.bot(botId) != null && it.models.models.isNotEmpty() && it.capabilities.isNotEmpty() } }
        assertTrue(bots.state.value.models.canAnswer)
        assertTrue(bots.state.value.labels.done.isNotEmpty())

        val chats = ChatStore(api, scope, notices)
        chats.open(botId, unreadFrom = null)
        chats.await(botId) { it.loaded && it.connected }

        assertTrue(chats.send(botId, OwnerSubmission("hello from android")))
        val done = chats.await(botId) { it.lastReply()?.status == MessageStatus.Done && !it.busy && it.echoes.isEmpty() }
        assertEquals("Echo: hello from android", done.lastReply()?.text)
        assertEquals(listOf(MessageRole.User, MessageRole.Assistant), done.messages.map { it.role })
        assertEquals("the echo was replaced by the confirmed message, not doubled", 2, chatView(done).timeline.size)

        withTimeout(20_000) { bots.state.first { it.bot(botId)?.lastMessagePreview?.contains("Echo") == true && it.bot(botId)?.replying == false } }

        chats.close(botId)
        chats.open(botId, unreadFrom = null)
        assertEquals(2, chats.await(botId) { it.loaded && it.connected }.messages.size)
        chats.close(botId)
        bots.stop()
    }

    @Test
    fun `an approval card is decided from the phone`() = runBlocking {
        val botId = newBot()
        val chats = ChatStore(api, scope, notices)
        chats.open(botId, null)
        chats.await(botId) { it.loaded }
        assertTrue(chats.send(botId, OwnerSubmission("/improve")))

        val waiting = chats.await(botId) { s -> s.messages.any { m -> m.toolCalls.any { it.status == ToolStatus.AwaitingApproval && it.taskId != null } } }
        val call = waiting.messages.flatMap { it.toolCalls }.first { it.status == ToolStatus.AwaitingApproval }
        assertEquals("update_instructions", call.name)

        chats.decideApproval(botId, call.taskId!!, approved = true).join()
        val after = chats.await(botId) { s -> !s.busy && s.messages.flatMap { it.toolCalls }.none { it.status == ToolStatus.AwaitingApproval } }
        val decided = after.messages.flatMap { it.toolCalls }.first { it.name == "update_instructions" }
        assertEquals(ToolStatus.Done, decided.status)
        assertEquals("approved", decided.approval)
        assertTrue(api.bot(botId).systemPrompt.contains("Self-improvement e2e"))
        chats.close(botId)
    }

    @Test
    fun `a bot's questions are answered from the phone`() = runBlocking {
        val botId = newBot()
        val chats = ChatStore(api, scope, notices)
        chats.open(botId, null)
        chats.await(botId) { it.loaded }
        assertTrue(chats.send(botId, OwnerSubmission("/ask")))

        val waiting = chats.await(botId) { s -> s.messages.any { m -> m.toolCalls.any { it.status == ToolStatus.AwaitingAnswer } } }
        val call = waiting.messages.flatMap { it.toolCalls }.first { it.status == ToolStatus.AwaitingAnswer }
        val questions = call.questions!!
        assertTrue(questions.isNotEmpty())
        api.answerQuestions(
            botId,
            call.taskId!!,
            questions.map { q -> if (q.options.isNotEmpty()) OwnerAnswer(listOf(q.options.first().label)) else OwnerAnswer(emptyList(), "typed on a phone") },
        )
        val after = chats.await(botId) { s -> !s.busy && s.messages.flatMap { it.toolCalls }.any { it.answers != null } }
        assertEquals(questions.size, after.messages.flatMap { it.toolCalls }.first { it.answers != null }.answers!!.size)
        chats.close(botId)
    }

    @Test
    fun `a file goes up with a message and comes back byte for byte`() = runBlocking {
        val botId = newBot()
        val bytes = "tiny agents on android $stamp\n".repeat(2).toByteArray()
        val ref = api.upload("notes-$stamp.txt", "text/plain", bytes.size.toLong()) { bytes.inputStream() }
        assertEquals("file", ref.kind)
        assertEquals(bytes.size.toLong(), ref.size)

        val chats = ChatStore(api, scope, notices)
        chats.open(botId, null)
        chats.await(botId) { it.loaded }
        assertTrue(chats.send(botId, OwnerSubmission("read this", attachments = listOf(ref))))
        val done = chats.await(botId, timeoutMs = 180_000) { it.lastReply()?.status == MessageStatus.Done && !it.busy }
        assertEquals(ref.uploadId, done.messages.first { it.role == MessageRole.User }.attachments.single().uploadId)

        val downloaded = api.uploadContent(ref.uploadId).use { it.body.bytes() }
        assertTrue(bytes.contentEquals(downloaded))
        chats.close(botId)
    }

    @Test
    fun `a new chat leaves a past chat that can be read and continued`() = runBlocking {
        val botId = newBot()
        val chats = ChatStore(api, scope, notices)
        chats.open(botId, null)
        chats.await(botId) { it.loaded }
        assertTrue(chats.send(botId, OwnerSubmission("remember the past")))
        chats.await(botId) { it.lastReply()?.status == MessageStatus.Done && !it.busy }

        api.resetChat(botId)
        chats.await(botId) { it.loaded && it.connected && it.messages.isEmpty() }

        val past = api.pastChats(botId).single()
        assertEquals(2, past.messageCount)
        val key = ChatStore.pastChatKey(botId, past.id)
        chats.openPast(botId, past.id)
        val read = withTimeout(20_000) { chats.sessions.first { it[key]?.loaded == true }.getValue(key) }
        assertEquals("Echo: remember the past", read.lastReply()?.text)
        assertNotNull(read.past)

        api.continuePastChat(botId, past.id)
        assertEquals(2, chats.await(botId) { it.loaded && it.connected && it.messages.size == 2 }.messages.size)
        chats.close(botId)
    }

    @Test
    fun `tasks, routines, skills and memory round-trip`() = runBlocking {
        val botId = newBot()

        val task = api.createTask("Ship the Android app $stamp")
        assertEquals("done", api.updateTask(task.id, status = "done").status)
        assertTrue(api.tasks().any { it.id == task.id && it.completedAt != null })
        api.deleteTask(task.id)
        assertFalse(api.tasks().any { it.id == task.id })

        val routine = api.createRoutine(botId, "Morning $stamp", "Say good morning", Schedule.Cron("0 9 * * 1-5"))
        assertEquals("scheduled", routine.state)
        assertTrue(routine.scheduleDescription.isNotBlank())
        api.pauseRoutine(routine.id)
        assertEquals("paused", api.routines().first { it.id == routine.id }.state)
        val edited = api.updateRoutine(routine.id, null, null, null, Schedule.Interval(120))
        assertEquals(Schedule.Interval(120), edited.schedule)
        api.deleteRoutine(routine.id)

        val skill = api.createSkill("android-$stamp".lowercase().filter { it.isLetterOrDigit() || it == '-' }, "Used by the Android test", "Be brief.")
        assertEquals(listOf(botId), api.updateSkill(skill.id, botIds = listOf(botId)).botIds)
        assertTrue(api.bot(botId).skillIds.contains(skill.id))
        api.deleteSkill(skill.id)

        val memory = api.createMemory(botId, "Prefers window seats $stamp", "preference")
        assertEquals("active", memory.status)
        assertEquals("goal", api.updateMemory(memory.id, category = "goal").category)
        api.deleteMemory(memory.id)
        assertFalse(api.memories(botId, includeArchived = false).any { it.id == memory.id })
    }

    @Test
    fun `bot settings, pins, people, step-up and the live surfaces answer`() = runBlocking {
        val botId = newBot()
        val capabilities = api.capabilities()
        val tool = capabilities.flatMap { it.tools }.first { !it.askOnly && !it.unattendedOnly }
        val updated = api.updateBot(botId, BotDraft(description = "edited on a phone", toolPermissions = mapOf(tool.name to "off"), yoloByDefault = true))
        assertEquals("edited on a phone", updated.description)
        assertEquals("off", updated.toolPermissions[tool.name])
        assertTrue(updated.yoloByDefault)

        api.pinBot(botId, true)
        assertNotNull(api.bots().first { it.id == botId }.pinnedAt)

        val guest = api.addGuest("guest-$stamp@example.com", "guest-pass-1", "Guest")
        assertEquals(listOf(guest.id), api.updateBot(botId, BotDraft(guestIds = listOf(guest.id))).guestIds)
        assertTrue(api.guests().any { it.id == guest.id && it.botIds.contains(botId) })

        val guestSession = Session(url)
        val guestApi = TinyAgentsApi(ApiClient(guestSession))
        guestSession.token = guestApi.login("guest-$stamp@example.com", "guest-pass-1").token
        assertTrue(guestApi.isGuest())
        assertEquals(listOf(botId), guestApi.bots().map { it.id })
        assertTrue((runCatching { guestApi.tasks() }.exceptionOrNull() as? ApiException)?.status == 403)
        api.removeGuest(guest.id)

        val wrong = runCatching { api.stepUp("not my password") }.exceptionOrNull()
        assertTrue(wrong is ApiException)
        val stepUp = api.stepUp(password)
        assertTrue(stepUp.token.isNotBlank() && stepUp.expiresAt > System.currentTimeMillis())
        val created = api.createVaultItem(
            vaultCreateBody("login", "Live $stamp", "example.com/login", mapOf("username" to "ana", "password" to "pw-1"), VaultPolicyDraft.defaultFor("login", "live-$stamp")),
            stepUp.token,
        )
        try {
            assertEquals(listOf("https://example.com"), created.origins)
            api.updateVaultItem(created.handle, vaultPolicyBody("login", VaultPolicyDraft.of(created).copy(disabled = true)), stepUp.token)
            api.updateVaultItem(created.handle, vaultValueBody("password", "pw-2"), stepUp.token)
            val edited = api.vaultItem(created.handle)
            assertTrue(edited.item.disabled)
            assertEquals(listOf("https://example.com"), edited.item.origins)
            assertEquals("pw-2", api.revealVaultValue(created.handle, "password", stepUp.token))
        } finally {
            runCatching { api.deleteVaultItem(created.handle, purge = true, stepUp.token) }
        }
        assertTrue(api.vaultOverview().items.none { it.handle == created.handle })
        api.connections()

        val browser = api.botLiveStatus(botId, "browser")
        assertFalse(browser.active)
        val computer = api.botLiveStatus(botId, "computer")
        assertFalse(computer.configured && computer.active)
        assertNotNull(api.liveProfiles("browser"))
        assertNotNull(api.liveProfiles("computer"))
        assertTrue(api.terminalTabs().status in setOf("ready", "unconfigured", "unreachable", "tmux-missing"))
    }

    @Test
    fun `Code on the phone runs a project thread, its changes, a workflow and a rewind`() = runBlocking {
        assumeTrue("TINY_AGENTS_CODE is not set", System.getenv("TINY_AGENTS_CODE") == "1")
        val client = ApiClient(session)
        val code = CodeApi(client)
        val project = CodeProject.from(
            client.postObject("/code/projects", jsonOf("repo" to "acme/web", "name" to "android-$stamp", "defaultInstanceId" to "demo")),
        )
        try {
            assertTrue(code.projects().any { it.id == project.id })
            val threadId = code.create(project.id, "demo", "Note the phone check $stamp and commit it")
            assertFalse("a thread owns its own id", threadId.contains(':'))

            suspend fun row(): CodeThreadSummary? = code.threads().firstOrNull { it.id == threadId }
            suspend fun idle(): CodeThreadSummary = withTimeout(60_000) {
                var current = row()
                while (current == null || current.working) {
                    kotlinx.coroutines.delay(500)
                    current = row()
                }
                current
            }
            val finished = idle()
            assertEquals(project.id, finished.projectId)
            assertTrue(finished.branch.orEmpty().isNotEmpty())
            assertEquals("Needs you", codeStatusSections(listOf(finished)).single().label)

            val snapshot = code.snapshot(threadId)
            assertEquals("demo", snapshot.thread.instanceId)
            assertTrue(code.harnesses().first { it.id == snapshot.thread.instanceId }.capabilities.rewind)
            assertTrue(code.reviewFiles(threadId).any { it.path == "NOTES.md" })

            val published = code.publish(threadId)
            val pr = published.active
            assertNotNull("publishing opens a pull request", pr)
            pr!!
            val control = "http://127.0.0.1:${java.net.URI(url!!).port + 3}"
            val failing = """{"checks":[{"name":"test","state":"failure","required":true,"url":"https://ci.example/1","jobId":1,"summary":"Expected 1, received 2"}]}"""
            val connection = java.net.URI("$control/pulls/${pr.number}").toURL().openConnection() as java.net.HttpURLConnection
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.outputStream.use { it.write(failing.toByteArray()) }
            assertEquals(200, connection.responseCode)

            val withCheck = code.pulls(threadId).active!!
            assertEquals(listOf(CodeWorkflow.FixCi), codeWorkflows(withCheck))
            val started = code.runWorkflow(threadId, CodeWorkflow.FixCi.wire)
            assertTrue(started.reason ?: "", started.started)
            idle()

            val review = code.openReview(pr.url)
            code.agentReview(review.id)
            val reviewed = withTimeout(60_000) {
                var current = code.review(review.id)
                while (current.reviewing || current.brief == null) {
                    kotlinx.coroutines.delay(500)
                    current = code.review(review.id)
                }
                current
            }
            assertTrue(reviewed.openFindings.isNotEmpty())
            val left = code.decideFinding(review.id, reviewed.openFindings.first().id, add = true)
            assertEquals("added", left.first { it.id == reviewed.openFindings.first().id }.state)
            assertEquals(1, code.githubDrafts(review.key).size)
            code.archiveReview(review.id)

            val point = lastTurn(code.snapshot(threadId).items)
            assertNotNull("a finished thread has a last turn to run again", point)
            code.rewind(threadId, point!!)
            assertEquals("the thread keeps its id", threadId, idle().id)
        } finally {
            runCatching { client.delete("/code/projects/${project.id}") }
        }
    }
}
