package groot.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import groot.mobile.data.SessionStore
import groot.mobile.data.TokenCipher
import groot.mobile.data.api.BotStreamEvent
import groot.mobile.data.api.FeedEvent
import groot.mobile.data.api.LiveProfileList
import groot.mobile.data.api.Schedule
import groot.mobile.data.api.SessionUser
import groot.mobile.data.api.TerminalList
import groot.mobile.data.api.ToolStatus
import groot.mobile.feature.manage.ScheduleForm
import groot.mobile.ui.components.MdBlock
import groot.mobile.ui.components.parseMarkdown
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Small pure pieces: wire parsing, the session store, the schedule form, Markdown blocks. */
@RunWith(AndroidJUnit4::class)
class AppLogicTest {
    @Test
    fun `stream events parse from the wire, and unknown ones are ignored`() {
        val upsert = BotStreamEvent.from(
            JSONObject(
                """{"type":"upsert","message":{"id":"e7","role":"assistant","text":"hi","status":"done","createdAt":1,
                   "toolCalls":[{"id":"t","name":"ask_owner","args":{"b":1,"a":"x"},"status":"awaiting_answer","taskId":9,
                   "questions":[{"question":"Which?","options":[{"label":"A"}],"multiple":true}]}]}}""",
            ),
        ) as BotStreamEvent.Upsert
        val call = upsert.message.toolCalls.single()
        assertEquals(ToolStatus.AwaitingAnswer, call.status)
        assertEquals(listOf("b", "a"), call.args.keys.toList())
        assertTrue(call.questions!!.single().multiple)
        assertNull(call.answers)
        assertNull(BotStreamEvent.from(JSONObject("""{"type":"something-new"}""")))
        assertEquals(BotStreamEvent.Ping, BotStreamEvent.from(JSONObject("""{"type":"ping"}""")))

        assertEquals(FeedEvent.BusySnapshot(setOf("3", "4")), FeedEvent.from(JSONObject("""{"type":"activity","busy":["3","4"]}""")))
        assertEquals(FeedEvent.Activity("3", true, 2, 0), FeedEvent.from(JSONObject("""{"type":"activity","conversation":"3","busy":true,"approvals":2,"questions":0}""")))
    }

    @Test
    fun `the browser and computer lists parse into one shape`() {
        val browsers = LiveProfileList.from(JSONObject("""{"liveView":false,"setupHint":"Set SANDBOX_HOST","browsers":[{"profile":"shared","label":"Shared","bots":[{"id":"b","name":"Ops"}],"active":true,"driver":"agent","mode":"headless","starting":false,"phase":null,"error":null}]}"""))
        assertFalse(browsers.available)
        assertEquals("headless", browsers.profiles.single().status.mode)
        assertEquals(listOf("Ops"), browsers.profiles.single().botNames)
        val desktops = LiveProfileList.from(JSONObject("""{"configured":true,"setupHint":null,"width":1280,"height":800,"desktops":[]}"""))
        assertTrue(desktops.available)
        assertEquals(1280, desktops.width)
        assertEquals("tmux-missing", TerminalList.from(JSONObject("""{"status":{"kind":"tmux-missing","installCommand":"apt install tmux"},"sessions":[]}""")).status)
    }

    @Test
    fun `server addresses become origins`() {
        assertEquals("https://agents.example.com", SessionStore.normalizeServerUrl(" agents.example.com/ "))
        assertEquals("https://agents.example.com", SessionStore.normalizeServerUrl("https://Agents.Example.com/chats/abc"))
        assertEquals("http://192.168.1.20:3000", SessionStore.normalizeServerUrl("192.168.1.20:3000"))
        assertEquals("http://localhost:3100", SessionStore.normalizeServerUrl("localhost:3100"))
        assertEquals("http://tiny.local", SessionStore.normalizeServerUrl("http://tiny.local"))
        assertNull(SessionStore.normalizeServerUrl(""))
        assertNull(SessionStore.normalizeServerUrl("not a url"))
    }

    @Test
    fun `the session survives a restart, sealed at rest, and signing out keeps the server`() = runTest {
        val disk = FakePreferencesDataStore()
        val cipher = object : TokenCipher {
            override fun seal(plain: String) = plain.reversed()
            override fun open(sealed: String): String? = sealed.reversed()
        }
        val store = SessionStore(disk, cipher, CoroutineScope(Dispatchers.Unconfined))
        store.setServer("https://agents.example.com")
        store.signedIn("jwt-token", SessionUser(7, "a@example.com", "Ashik"))
        store.selectBot("b1")
        assertFalse("the token is never stored as it is", disk.updateData { it }.asMap().values.any { it == "jwt-token" })

        val restarted = SessionStore(disk, cipher, CoroutineScope(Dispatchers.Unconfined))
        restarted.load()
        assertEquals("jwt-token", restarted.token)
        assertEquals("Ashik", restarted.state.value.user?.name)
        assertEquals("b1", restarted.selectedBot.value)

        restarted.signOut()
        assertFalse(restarted.state.value.signedIn)
        assertEquals("https://agents.example.com", restarted.serverUrl)
        assertNull(restarted.selectedBot.value)
    }

    @Test
    fun `schedule presets become cron, interval or once, in IST`() {
        assertEquals(Schedule.Cron("30 7 * * *"), ScheduleForm(time = "07:30").toSchedule())
        assertEquals(Schedule.Cron("0 9 * * 1-5"), ScheduleForm(kind = ScheduleForm.Kind.Weekdays).toSchedule())
        assertEquals(Schedule.Cron("15 18 * * 5"), ScheduleForm(kind = ScheduleForm.Kind.Weekly, weekday = 5, time = "18:15").toSchedule())
        assertEquals(Schedule.Interval(120), ScheduleForm(kind = ScheduleForm.Kind.Interval, minutes = 120).toSchedule())
        assertEquals(Schedule.Once("2026-12-01T09:05:00+05:30"), ScheduleForm(kind = ScheduleForm.Kind.Once, date = "2026-12-01", time = "9:05").toSchedule())
        assertNull(ScheduleForm(time = "25:00").toSchedule())
        assertNotNull(ScheduleForm(kind = ScheduleForm.Kind.Interval, minutes = 5).error)
        assertNotNull(ScheduleForm(kind = ScheduleForm.Kind.Cron, cron = "* * *").error)
    }

    @Test
    fun `an existing schedule opens on its preset`() {
        assertEquals(ScheduleForm.Kind.Weekdays, ScheduleForm.of(Schedule.Cron("0 9 * * 1-5")).kind)
        assertEquals("07:05", ScheduleForm.of(Schedule.Cron("5 7 * * *")).time)
        assertEquals(3, ScheduleForm.of(Schedule.Cron("0 8 * * 3")).weekday)
        assertEquals(ScheduleForm.Kind.Cron, ScheduleForm.of(Schedule.Cron("*/5 9-17 * * *")).kind)
        assertEquals("2026-12-01", ScheduleForm.of(Schedule.Once("2026-12-01T09:00:00+05:30")).date)
        val weekly = ScheduleForm.of(Schedule.Cron("15 18 * * 5"))
        assertEquals(Schedule.Cron("15 18 * * 5"), weekly.toSchedule())
    }

    @Test
    fun `markdown splits into blocks, and an open code fence runs to the end`() {
        val blocks = parseMarkdown("# Title\n\nSome *text*\nmore text\n\n- one\n- two\n  continued\n1. first\n\n> quote\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---\n```kotlin\nval x = 1\n")
        assertEquals(
            listOf("Heading", "Paragraph", "ListItem", "ListItem", "ListItem", "Quote", "Table", "Rule", "Code"),
            blocks.map { it::class.simpleName },
        )
        assertEquals("Some *text*\nmore text", (blocks[1] as MdBlock.Paragraph).text)
        assertEquals("two continued", (blocks[3] as MdBlock.ListItem).text)
        assertEquals("1.", (blocks[4] as MdBlock.ListItem).marker)
        assertEquals(listOf(listOf("a", "b"), listOf("1", "2")), (blocks[6] as MdBlock.Table).rows)
        assertEquals(MdBlock.Code("kotlin", "val x = 1\n".trimEnd()), blocks[8].let { it as MdBlock.Code }.let { it.copy(code = it.code.trimEnd()) })
    }
}
