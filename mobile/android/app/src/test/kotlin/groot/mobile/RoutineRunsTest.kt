package groot.mobile

import groot.mobile.feature.chat.firstShown
import groot.mobile.feature.chat.runStatusWord
import groot.mobile.feature.chat.runsSummary
import org.junit.Assert.assertEquals
import org.junit.Test

/** The routine-run line, worded as the web client's `RoutineRuns.tsx` words it. */
class RoutineRunsTest {
    // FIXED_NOW is 05:16 IST; routine times read in IST, like the server and the web app.
    private val name = "Process emails from key senders"

    @Test
    fun `one run reads its outcome and time`() {
        assertEquals("$name · done · 05:16", runsSummary(listOf(routineRun("a", name, 0))).text)
        assertEquals("$name · needs attention · 05:01", runsSummary(listOf(routineRun("a", name, 15, status = "blocked"))).text)
    }

    @Test
    fun `back-to-back runs fold into a count with the problems called out`() {
        val runs = (0 until 24).map { routineRun("r$it", name, 360L - it * 15) } +
            routineRun("f", name, 2, status = "failed") +
            routineRun("b1", name, 1, status = "blocked") +
            routineRun("b2", name, 0, status = "blocked")
        val summary = runsSummary(runs)
        assertEquals("$name · ran 27× · last 05:16 · 1 failed · 2 need attention", summary.text)
        assertEquals(1, summary.failed)
        assertEquals(2, summary.blocked)
    }

    @Test
    fun `runs of several routines are counted by routine`() {
        val summary = runsSummary(listOf(routineRun("a", name, 30), routineRun("b", "Morning summary", 5, status = "blocked")))
        assertEquals("2 routines · ran 2× · last 05:11 · 1 needs attention", summary.text)
    }

    @Test
    fun `status words match the web client`() {
        assertEquals(
            listOf("done", "needs attention", "failed", "missed", "cancelled"),
            listOf("succeeded", "blocked", "failed", "missed", "cancelled").map(::runStatusWord),
        )
    }

    @Test
    fun `the short list keeps the newest five and every problem`() {
        val newestFirst = (0 until 24).map { i ->
            routineRun("r$i", name, i * 15L, status = if (i == 16) "blocked" else if (i == 8) "failed" else "succeeded")
        }
        assertEquals(listOf("r0", "r1", "r2", "r3", "r4", "r8", "r16"), firstShown(newestFirst).map { it.id })
    }
}
