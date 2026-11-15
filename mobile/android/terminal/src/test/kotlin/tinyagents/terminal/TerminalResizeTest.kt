package tinyagents.terminal

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TerminalResizeTest {
    private fun numbered(): TestTerminal = TestTerminal(5, 4).feed("1\r\n2\r\n3\r\n4")

    @Test
    fun `fewer rows with the cursor at the bottom push the top lines to scrollback`() {
        val t = numbered()
        t.emulator.resize(5, 2)
        assertEquals(listOf("3", "4"), t.screen())
        assertEquals(listOf("1", "2"), t.scrollback())
        assertEquals(1 to 1, t.cursor)
        assertEquals(2, t.emulator.rows)
        t.emulator.checkInvariants()
    }

    @Test
    fun `fewer rows drop blank lines below the cursor first`() {
        val t = TestTerminal(5, 4).feed("1\r\n2")
        t.emulator.resize(5, 2)
        assertEquals(listOf("1", "2"), t.screen())
        assertEquals(0, t.emulator.scrollbackSize)
        assertEquals(1 to 1, t.cursor)

        val mixed = TestTerminal(5, 5).feed("1\r\n2\r\n3")
        mixed.emulator.resize(5, 2)
        assertEquals(listOf("2", "3"), mixed.screen())
        assertEquals(listOf("1"), mixed.scrollback())
    }

    @Test
    fun `more rows pull lines back out of scrollback`() {
        val t = numbered()
        t.emulator.resize(5, 2)
        t.emulator.resize(5, 3)
        assertEquals(listOf("2", "3", "4"), t.screen())
        assertEquals(listOf("1"), t.scrollback())
        assertEquals(2 to 1, t.cursor)
        t.emulator.resize(5, 6)
        assertEquals(listOf("1", "2", "3", "4"), t.screen())
        assertEquals(0, t.emulator.scrollbackSize)
        assertEquals(3 to 1, t.cursor)
        t.emulator.checkInvariants()
    }

    @Test
    fun `more rows with no scrollback add blank lines at the bottom`() {
        val t = TestTerminal(5, 2).feed("a\r\nb")
        t.emulator.resize(5, 4)
        assertEquals(listOf("a", "b"), t.screen())
        assertEquals(1 to 1, t.cursor)
        t.feed("\r\nc\r\nd")
        assertEquals(listOf("a", "b", "c", "d"), t.screen())
    }

    @Test
    fun `fewer columns truncate and clamp the cursor and more columns pad`() {
        val t = TestTerminal(8, 2).feed("abcdefgh\r\nxy")
        t.emulator.resize(4, 2)
        assertEquals(listOf("abcd", "xy"), t.screen())
        assertEquals(4, t.emulator.cols)
        t.feed("${CSI}1;8H")
        assertEquals(0 to 3, t.cursor)
        t.emulator.resize(8, 2)
        assertEquals("no reflow: what was cut is gone", listOf("abcd", "xy"), t.screen())
        t.feed("${CSI}1;8HZ")
        assertEquals("abcd   Z", t.row(0))
        t.emulator.checkInvariants()
    }

    @Test
    fun `a pending wrap becomes a plain advance when the line gets wider`() {
        val t = TestTerminal(5, 2).feed("abcde")
        t.emulator.resize(10, 2)
        t.feed("f")
        assertEquals(listOf("abcdef"), t.screen())
        val narrower = TestTerminal(5, 2).feed("abcde")
        narrower.emulator.resize(3, 2)
        assertEquals(0 to 2, narrower.cursor)
        narrower.feed("X")
        assertEquals(listOf("abX"), narrower.screen())
    }

    @Test
    fun `a wide character cut by the new margin goes blank`() {
        val t = TestTerminal(5, 2).feed("abc中")
        t.emulator.resize(4, 2)
        assertEquals("abc", t.row(0))
        t.emulator.checkInvariants()
    }

    @Test
    fun `resize resets the scroll region`() {
        val t = TestTerminal(5, 4).feed("${CSI}2;3r")
        t.emulator.resize(5, 5)
        t.feed("${CSI}5;1Hx\ny")
        assertEquals(1, t.emulator.scrollbackSize)
        assertEquals(listOf("", "", "", "x", " y"), t.screen())
    }

    @Test
    fun `tab stops cover the new columns`() {
        val t = TestTerminal(10, 2)
        t.emulator.resize(40, 2)
        t.feed("\t\t\t\t")
        assertEquals(0 to 32, t.cursor)
    }

    @Test
    fun `resizing on the alternate screen resizes both screens`() {
        val t = TestTerminal(10, 4).feed("main\r\nline${CSI}?1049h${CSI}Halt")
        t.emulator.resize(20, 8)
        t.emulator.checkInvariants()
        t.feed("${CSI}8;20HZ")
        assertEquals(7 to 19, t.cursor)
        assertEquals('Z'.code, t.emulator.line(7).codePoint(19))
        assertEquals("alt", t.row(0))
        t.feed("${CSI}?1049l")
        t.emulator.checkInvariants()
        assertEquals(listOf("main", "line"), t.screen())
        assertEquals(1 to 4, t.cursor)
        t.feed("${CSI}8;20HY")
        assertEquals("the main screen has the new size too", 'Y'.code, t.emulator.line(7).codePoint(19))
    }

    @Test
    fun `shrinking on the alternate screen scrolls the main screen into scrollback and drops alternate lines`() {
        val t = numbered().feed("${CSI}?1049h${CSI}Ha\r\nb\r\nc\r\nd")
        t.emulator.resize(5, 2)
        assertEquals(listOf("c", "d"), t.screen())
        assertEquals("still hidden", 0, t.emulator.scrollbackSize)
        assertEquals(1 to 1, t.cursor)
        t.feed("${CSI}?1049l")
        assertEquals(listOf("3", "4"), t.screen())
        assertEquals(listOf("1", "2"), t.scrollback())
        assertEquals(1 to 1, t.cursor)
        t.emulator.checkInvariants()
    }

    @Test
    fun `scrollback lines keep their own width and read safely past it`() {
        val t = TestTerminal(8, 2).feed("abcdefgh\r\n2\r\n3")
        t.emulator.resize(4, 2)
        val old = t.emulator.line(-1)
        assertEquals(8, old.cols)
        assertEquals("abcdefgh", old.text())
        val narrow = t.emulator.line(0)
        assertEquals(' '.code, narrow.codePoint(7))
        assertEquals(TerminalColor.DEFAULT, narrow.foreground(7))
        assertEquals(TerminalColor.DEFAULT, narrow.background(-1))
        assertEquals(0, narrow.attributes(99))
        assertEquals(1, narrow.width(99))
        assertEquals(null, narrow.combining(99))
        // Pulled back onto the screen it takes the screen's width.
        t.emulator.resize(4, 3)
        assertEquals("abcd", t.row(0))
        t.emulator.checkInvariants()
    }

    @Test
    fun `a degenerate size is coerced to one cell and still works`() {
        val t = TestTerminal(10, 4).feed("hello\r\nworld")
        t.emulator.resize(0, 0)
        assertEquals(1, t.emulator.cols)
        assertEquals(1, t.emulator.rows)
        t.feed("abc中\r\n\t${CSI}5;5H${CSI}2J${CSI}L${CSI}M${CSI}@${CSI}Px")
        t.emulator.checkInvariants()
        assertEquals("x", t.row(0))
        val tiny = TerminalEmulator(-3, 0) {}
        assertEquals(1, tiny.cols)
        assertEquals(1, tiny.rows)
    }

    @Test
    fun `resizing to the same size changes nothing`() {
        val t = TestTerminal(5, 3).feed("abcde")
        val before = t.emulator.dump()
        t.emulator.resize(5, 3)
        assertEquals(before, t.emulator.dump())
        t.feed("f")
        assertEquals("the pending wrap survived", listOf("abcde", "f"), t.screen())
    }

    @Test
    fun `resize keeps modes and the pen`() {
        val t = TestTerminal(10, 4).feed("${CSI}?1h${CSI}?2004h${CSI}?1002h${CSI}31m")
        t.emulator.resize(12, 6)
        assertTrue(t.emulator.applicationCursorKeys)
        assertTrue(t.emulator.bracketedPaste)
        assertEquals(MouseTracking.BUTTON, t.emulator.mouseTracking)
        assertFalse(t.emulator.alternateScreen)
        t.feed("x")
        assertEquals(TerminalColor.indexed(1), t.fg(0, 0))
    }
}
