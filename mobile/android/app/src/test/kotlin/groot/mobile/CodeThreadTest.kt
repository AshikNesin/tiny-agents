package groot.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import groot.mobile.data.api.ApprovalRequest
import groot.mobile.data.api.CodeListEvent
import groot.mobile.data.api.CodeThreadEvent
import groot.mobile.data.api.ThreadPulls
import groot.mobile.data.api.TranscriptItem
import groot.mobile.data.code.CodeDisplayItem
import groot.mobile.data.code.CodeThreadState
import groot.mobile.data.code.DiffLine
import groot.mobile.data.code.CodeWorkflow
import groot.mobile.data.code.RewindPoint
import groot.mobile.data.code.codeStatusSections
import groot.mobile.data.code.codeWorkflows
import groot.mobile.data.code.lastTurn
import groot.mobile.data.code.describeTools
import groot.mobile.data.code.groupTools
import groot.mobile.data.code.lastErrorId
import groot.mobile.data.api.ChangedFile
import groot.mobile.data.api.FileContents
import groot.mobile.data.code.fileDiffView
import groot.mobile.data.code.lineDiff
import groot.mobile.data.code.reduceCodeThread
import groot.mobile.data.code.turnLine
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CodeThreadTest {
    private fun event(json: String): CodeThreadEvent = CodeThreadEvent.from(JSONObject(json))!!

    private fun thread(id: String, working: Boolean = false, parent: String? = null, updated: String = "2026-11-16T10:00:00Z", unread: Boolean = false) =
        """{"id":"$id","instanceId":"claude-code","kind":"claude-code","nativeId":"${id.substringAfter(':')}","title":"Fix the build",
           "cwd":"/home/me/app","model":null,"parentId":${parent?.let { "\"$it\"" } ?: "null"},"createdAt":"2026-11-16T09:00:00Z",
           "updatedAt":"$updated","working":$working,"archived":false,"cursor":4,"unread":$unread}"""

    private val snapshot = event(
        """{"type":"snapshot","snapshot":{"thread":${thread("claude-code:t1", working = true)},
        "items":[{"kind":"user","id":"u1","text":"Fix the build","attachments":[]},
                 {"kind":"tool","id":"k1","tool":"bash","name":"Bash","input":{"command":"pnpm test"},"summary":"pnpm test","status":"running","live":true,"output":"1 failed","images":[]}],
        "settings":{"model":"opus","effort":null,"permissionMode":"acceptEdits"},
        "queued":[],"jobs":[],"children":[],"context":{"used":12000,"max":200000},"costUsd":0.04}}""",
    )

    @Test
    fun `a snapshot loads the thread and later rows upsert by id`() {
        var state = reduceCodeThread(CodeThreadState(), snapshot)
        assertTrue(state.loaded && state.working)
        assertEquals(listOf("u1", "k1"), state.items.map { it.id })
        assertEquals("acceptEdits", state.settings?.permissionMode)
        assertEquals(12000L, state.context.used)

        state = reduceCodeThread(state, event("""{"type":"partial","text":"All green","thinking":""}"""))
        assertEquals("All green", state.partialText)
        state = reduceCodeThread(
            state,
            event(
                """{"type":"items","cursor":6,"items":[
                {"kind":"tool","id":"k1","tool":"bash","name":"Bash","input":{"command":"pnpm test"},"summary":"pnpm test","status":"done","exitCode":0,"output":"ok","images":[]},
                {"kind":"assistant","id":"a1","text":"All green."}]}""",
            ),
        )
        assertEquals(listOf("u1", "k1", "a1"), state.items.map { it.id })
        assertEquals("done", (state.items[1] as TranscriptItem.Tool).status)
        assertEquals(0, (state.items[1] as TranscriptItem.Tool).exitCode)
        assertEquals("", state.partialText)
        assertEquals(6, state.cursor)

        val replayed = reduceCodeThread(state, event("""{"type":"items","cursor":6,"items":[{"kind":"assistant","id":"a1","text":"All green."}]}"""))
        assertEquals(state.items, replayed.items)
    }

    @Test
    fun `a state event ends the turn and keeps what it does not name`() {
        var state = reduceCodeThread(CodeThreadState(), snapshot)
        state = reduceCodeThread(state, event("""{"type":"partial","text":"half","thinking":"hmm"}"""))
        state = reduceCodeThread(state, event("""{"type":"state","working":false,"queued":[{"id":"q1","text":"then lint","createdAt":"2026-11-16T10:00:00Z"}]}"""))
        assertFalse(state.working)
        assertFalse(state.thread!!.working)
        assertEquals("", state.partialText)
        assertEquals("", state.partialThinking)
        assertEquals(listOf("then lint"), state.queued.map { it.text })
        assertEquals("opus", state.settings?.model)
        assertEquals(0.04, state.costUsd, 0.0)
    }

    @Test
    fun `approval and question requests parse into cards`() {
        val tool = TranscriptItem.from(
            JSONObject("""{"kind":"request","id":"r1","status":"open","request":{"kind":"tool","tool":"bash","name":"Bash","input":{"command":"rm -rf dist"},"summary":"rm -rf dist","reason":"Clean the build"}}"""),
        ) as TranscriptItem.Request
        val request = tool.request as ApprovalRequest.Tool
        assertEquals("rm -rf dist", request.summary)
        assertEquals("Clean the build", request.reason)
        assertTrue(request.input.contains("\"command\": \"rm -rf dist\""))

        val question = TranscriptItem.from(
            JSONObject("""{"kind":"request","id":"r2","status":"open","request":{"kind":"question","questions":[{"question":"Which database?","header":"DB","options":[{"label":"SQLite","description":"Local"},{"label":"Postgres"}]}]}}"""),
        ) as TranscriptItem.Request
        val questions = (question.request as ApprovalRequest.Questions).questions
        assertEquals("Which database?", questions.single().question)
        assertEquals(listOf("SQLite" to "Local", "Postgres" to null), questions.single().options)
    }

    @Test
    fun `an unknown row kind or event type is skipped, not a crash`() {
        assertNull(TranscriptItem.from(JSONObject("""{"kind":"hologram","id":"x"}""")))
        assertNull(CodeThreadEvent.from(JSONObject("""{"type":"ping"}""")))
    }

    private fun tool(id: String, kind: String, status: String = "done") = TranscriptItem.Tool(
        id, kind, kind, "", status, "", null, false, null, null, null, null, null, null, emptyList(),
    )

    @Test
    fun `runs of finished tool calls fold into one line, running ones and plans stay`() {
        val items = listOf(
            TranscriptItem.User("u", "go", emptyList()),
            tool("t1", "bash"),
            TranscriptItem.Thinking("th1", "next the edit"),
            tool("t2", "edit"),
            tool("t3", "bash", status = "error"),
            TranscriptItem.Thinking("th2", "now the plan"),
            tool("t4", "todo"),
            tool("t5", "bash", status = "running"),
        )
        val shown = groupTools(items)
        assertEquals(listOf("u", "group:t1", "th2", "t4", "t5"), shown.map { it.key })
        val group = shown[1] as CodeDisplayItem.Group
        assertEquals(listOf("t1", "th1", "t2", "t3"), group.items.map { it.id })
        assertEquals("Ran 2 commands, edited 1 file · 1 failed", describeTools(group.tools))
        assertEquals(listOf("t1"), groupTools(listOf(tool("t1", "bash"))).map { it.key })
    }

    @Test
    fun `only an error with nothing after it offers recovery`() {
        val error = TranscriptItem.Notice("n1", "error", "Overloaded", true, null, null)
        assertEquals("n1", lastErrorId(listOf(TranscriptItem.User("u", "go", emptyList()), error, TranscriptItem.Turn("t", 1000, null))))
        assertNull(lastErrorId(listOf(error, TranscriptItem.Assistant("a", "recovered"))))
    }

    @Test
    fun `a finished turn says how long it worked and what it cost`() {
        assertEquals("Worked for 12s · $0.040", turnLine(TranscriptItem.Turn("t", 12_400, 0.04)))
        assertEquals("Worked for 3m 4s", turnLine(TranscriptItem.Turn("t", 184_000, null)))
        assertNull(turnLine(TranscriptItem.Turn("t", null, null)))
    }

    @Test
    fun `the list groups threads by what they need, newest first, without review assistants`() {
        fun row(id: String, group: String?, updated: String, extra: String = "") =
            thread(id, updated = updated).replace("\"unread\":false", "\"unread\":false$extra" +
                (group?.let { ",\"status\":{\"group\":\"$it\",\"reason\":${if (it == "needs-you") "\"finished\"" else "null"}}" } ?: ""))
        val list = CodeListEvent.from(
            JSONObject(
                """{"type":"list","threads":[
                ${row("t-done", "done", "2026-11-16T08:00:00Z")},
                ${row("t-asks", "needs-you", "2026-11-16T09:00:00Z")},
                ${row("t-review", "review", "2026-11-16T09:30:00Z", ",\"branch\":\"ta/fix-build\"")},
                ${row("t-asks-newer", "needs-you", "2026-11-16T10:00:00Z")},
                ${row("t-assistant", "needs-you", "2026-11-16T11:00:00Z", ",\"review\":{\"id\":\"rv1\",\"number\":7}")},
                ${row("t-old-server", null, "2026-11-16T07:00:00Z")}]}""",
            ),
        ) as CodeListEvent.Threads

        val sections = codeStatusSections(list.threads)

        assertEquals(listOf("Needs you", "In review", "Done"), sections.map { it.label })
        assertEquals(listOf("t-asks-newer", "t-asks"), sections[0].rows.map { it.id })
        assertEquals("finished", sections[0].rows.first().statusReason)
        assertEquals("ta/fix-build", sections[1].rows.single().branch)
        assertEquals(listOf("t-done", "t-old-server"), sections[2].rows.map { it.id })
    }

    @Test
    fun `a line diff shows changed lines with their context and folds the rest`() {
        val old = (1..10).joinToString("\n") { "line $it" } + "\n"
        val new = old.replace("line 5\n", "line five\n").replace("line 10\n", "") + "line 11\n"
        val diff = lineDiff(old, new, context = 1)
        val kinds = diff.map {
            when (it.kind) {
                DiffLine.Kind.Same -> " ${it.text}"
                DiffLine.Kind.Added -> "+${it.text}"
                DiffLine.Kind.Removed -> "-${it.text}"
                DiffLine.Kind.Gap -> "@${it.text}"
            }
        }
        assertEquals(
            listOf(
                "@3 unchanged lines", " line 4", "-line 5", "+line five", " line 6",
                "@2 unchanged lines", " line 9", "-line 10", "+line 11",
            ),
            kinds,
        )
        assertEquals(5, diff.first { it.kind == DiffLine.Kind.Removed }.oldLine)
        assertEquals(5, diff.first { it.kind == DiffLine.Kind.Added }.newLine)
        assertEquals(2, lineDiff("", "a\nb\n").count { it.kind == DiffLine.Kind.Added })
        assertTrue(lineDiff(old, old).isEmpty())
    }

    @Test
    fun `a file the server cannot show as text says why instead of drawing a change`() {
        fun view(json: String) = fileDiffView(FileContents.from(JSONObject(json)))
        val binary = view("""{"path":"logo.png","oldContent":"","newContent":"","unshowable":"binary"}""")
        assertTrue(binary.lines.isEmpty())
        assertEquals("Binary file. Its contents are not shown.", binary.notice)
        val large = view("""{"path":"big.txt","oldContent":"","newContent":"","unshowable":"tooLarge"}""")
        assertEquals("This file is too large to show here (over 2 MB).", large.notice)
        val text = view("""{"path":"a.ts","oldContent":"a\n","newContent":"b\n"}""")
        assertNull(text.notice)
        assertEquals(listOf(DiffLine.Kind.Removed, DiffLine.Kind.Added), text.lines.map { it.kind })
        val file = ChangedFile.from(
            JSONObject("""{"path":"logo.png","status":"added","additions":0,"deletions":0,"isGenerated":false,"binary":true}"""),
        )
        assertTrue(file.binary)
    }

    @Test
    fun `the PR tab reads checks, unresolved threads and the Auto-fix loop`() {
        val pulls = ThreadPulls.from(
            JSONObject(
                """{"project":{"id":"p1","name":"app","repo":{"owner":"me","name":"app"},"baseBranch":"main","defaultInstanceId":"claude-code"},
                "branch":"ta/fix-build-1a2b","ahead":2,"earlier":[],
                "active":{"number":42,"url":"https://github.com/me/app/pull/42","title":"Fix the build","state":"open","draft":true,
                  "headRef":"ta/fix-build-1a2b","baseRef":"main","autofix":true,
                  "loop":{"status":"needs_input","reason":"The pass made no commit"},"stalled":[],"ignored":["c2"],"passes":[],
                  "snapshot":{"mergeable":"mergeable","mergeMethods":["squash"],"inMergeQueue":false,
                    "checks":[{"name":"test","state":"failure","url":"https://ci/1"},{"name":"lint","state":"success","url":null}],
                    "reviews":[{"author":{"login":"ana"},"state":"CHANGES_REQUESTED"}],
                    "threads":[{"id":"t1","path":"src/a.ts","line":3,"resolved":false,"comments":[{"author":{"login":"ana"},"body":"Rename this"}]},
                               {"id":"t2","path":"src/b.ts","line":1,"resolved":true,"comments":[]}]}}}""",
            ),
        )
        val pr = pulls.active!!
        assertEquals("me/app", pulls.project?.repo)
        assertEquals(2, pulls.ahead)
        assertEquals(listOf("test" to "failure", "lint" to "success"), pr.checks.map { it.name to it.state })
        assertEquals(listOf("Rename this"), pr.threads.map { it.body })
        assertEquals("needs_input", pr.loopStatus)
        assertEquals(listOf("squash"), pr.mergeMethods)
        assertEquals(listOf(CodeWorkflow.FixCi, CodeWorkflow.AddressComments), codeWorkflows(pr))
    }

    @Test
    fun `a conflicting branch offers to resolve it, and a green PR offers nothing`() {
        fun pull(snapshot: String) = ThreadPulls.from(
            JSONObject(
                """{"project":null,"branch":"b","ahead":0,"earlier":[],"active":{"number":1,"url":"u","title":"t","state":"open",
                "draft":false,"headRef":"b","baseRef":"main","autofix":false,"loop":{"status":"off","reason":null},
                "stalled":[],"ignored":[],"passes":[],"snapshot":$snapshot}}""",
            ),
        ).active!!
        val conflicting = pull("""{"mergeable":"conflicting","mergeMethods":["merge"],"checks":[],"reviews":[],"threads":[]}""")
        assertEquals(listOf(CodeWorkflow.ResolveConflicts), codeWorkflows(conflicting))
        assertEquals("resolve_conflicts", CodeWorkflow.ResolveConflicts.wire)
        val green = pull("""{"mergeable":"mergeable","mergeMethods":["merge"],"checks":[{"name":"ci","state":"success"}],"reviews":[],"threads":[]}""")
        assertTrue(codeWorkflows(green).isEmpty())
    }

    @Test
    fun `the last turn runs again from where it started, counting every turn before it`() {
        val items = listOf(
            TranscriptItem.User("u1", "Fix the build", emptyList()),
            TranscriptItem.Assistant("a1", "Done."),
            TranscriptItem.Turn("turn1", 1000, null),
            TranscriptItem.User("u2", "Now add a test", emptyList(), forkAt = "msg-7"),
            TranscriptItem.User("u3", "and run it", emptyList()),
            TranscriptItem.Assistant("a2", "Added."),
            TranscriptItem.Turn("turn2", 1000, null),
        )

        assertEquals(RewindPoint(at = "msg-7", turn = 1, turns = 2, text = "Now add a test"), lastTurn(items))
        val parsed = TranscriptItem.from(JSONObject("""{"kind":"user","id":"u9","text":"hi","attachments":[],"forkAt":"msg-9"}"""))
        assertEquals("msg-9", (parsed as TranscriptItem.User).forkAt)
        assertNull(lastTurn(listOf(TranscriptItem.Assistant("a", "hi"))))
    }
}
