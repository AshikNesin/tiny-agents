package tinyagents.terminal

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Printing, wrapping, cursor movement, erasing, insert/delete, scrolling and the two screens. */
class TerminalScreenTest {
    // ------------------------------------------------------------ text and wrapping

    @Test
    fun `plain text lands at the cursor and CR LF start a new line`() {
        val t = TestTerminal(20, 5).feed("hello\r\nworld")
        assertEquals(listOf("hello", "world"), t.screen())
        assertEquals(1 to 5, t.cursor)
    }

    @Test
    fun `LF alone keeps the column`() {
        val t = TestTerminal(20, 5).feed("ab\ncd")
        assertEquals(listOf("ab", "  cd"), t.screen())
    }

    @Test
    fun `VT and FF act as LF`() {
        val t = TestTerminal(20, 5).feed("a\u000bb\u000cc")
        assertEquals(listOf("a", " b", "  c"), t.screen())
    }

    @Test
    fun `filling the last column leaves the cursor there with a wrap pending`() {
        val t = TestTerminal(5, 3).feed("abcde")
        assertEquals(0 to 4, t.cursor)
        assertEquals(listOf("abcde"), t.screen())
        t.feed("f")
        assertEquals(listOf("abcde", "f"), t.screen())
        assertEquals(1 to 1, t.cursor)
        assertTrue(t.emulator.line(0).wrapped)
        assertFalse(t.emulator.line(1).wrapped)
    }

    @Test
    fun `CR LF after a full line does not leave a blank line`() {
        val t = TestTerminal(5, 3).feed("abcde\r\nx")
        assertEquals(listOf("abcde", "x"), t.screen())
        assertFalse(t.emulator.line(0).wrapped)
    }

    @Test
    fun `cursor movement cancels the pending wrap`() {
        val t = TestTerminal(5, 3).feed("abcde${CSI}DX")
        assertEquals(listOf("abcXe"), t.screen())
        assertEquals(0 to 4, t.cursor)
    }

    @Test
    fun `backspace from a pending wrap moves to the column before the last`() {
        val t = TestTerminal(5, 3).feed("abcde\bX")
        assertEquals(listOf("abcXe"), t.screen())
    }

    @Test
    fun `addressing the last column again keeps writing there`() {
        val t = TestTerminal(5, 3).feed("abcde${CSI}1;5HX")
        assertEquals(listOf("abcdX"), t.screen())
        t.feed("Y")
        assertEquals(listOf("abcdX", "Y"), t.screen())
    }

    @Test
    fun `erase in line from a pending wrap clears the last column`() {
        val t = TestTerminal(5, 3).feed("abcde${CSI}K")
        assertEquals(listOf("abcd"), t.screen())
        t.feed("z")
        assertEquals("the wrap was cancelled", listOf("abcdz"), t.screen())
    }

    @Test
    fun `a tab with a wrap pending stays put and the next character still wraps`() {
        val t = TestTerminal(5, 3).feed("abcde\tf")
        assertEquals(listOf("abcde", "f"), t.screen())
    }

    @Test
    fun `save and restore cursor carry the pending wrap`() {
        val t = TestTerminal(5, 3).feed("abcde${ESC}7${CSI}H${ESC}8f")
        assertEquals(listOf("abcde", "f"), t.screen())
    }

    @Test
    fun `with autowrap off the last column is overwritten`() {
        val t = TestTerminal(5, 3).feed("${CSI}?7labcdefg")
        assertEquals(listOf("abcdg"), t.screen())
        assertEquals(0 to 4, t.cursor)
        t.feed("${CSI}?7hhi")
        assertEquals(listOf("abcdh", "i"), t.screen())
    }

    @Test
    fun `wrapping on the last row scrolls`() {
        val t = TestTerminal(5, 2).feed("abcdefghijk")
        assertEquals(listOf("fghij", "k"), t.screen())
        assertEquals(listOf("abcde"), t.scrollback())
    }

    @Test
    fun `insert mode shifts the rest of the line right`() {
        val t = TestTerminal(8, 2).feed("abcdef${CSI}1;3H${CSI}4hXY${CSI}4lZ")
        assertEquals(listOf("abXYZdef"), t.screen())
    }

    @Test
    fun `DEL and NUL are ignored`() {
        val t = TestTerminal(8, 2).feed("a\u007fb\u0000c")
        assertEquals(listOf("abc"), t.screen())
    }

    @Test
    fun `REP repeats the last printed character`() {
        val t = TestTerminal(10, 2).feed("ab${CSI}3bc")
        assertEquals(listOf("abbbbc"), t.screen())
    }

    @Test
    fun `REP only repeats a character that was printed just before it`() {
        assertEquals(listOf("ab"), TestTerminal(10, 2).feed("ab${CSI}D${CSI}3b").screen())
        assertEquals(listOf("ab"), TestTerminal(10, 2).feed("ab\r${CSI}3b").screen())
        assertEquals(listOf("ab"), TestTerminal(10, 2).feed("ab${CSI}1m${CSI}3b").screen())
        assertEquals(emptyList<String>(), TestTerminal(10, 2).feed("${CSI}3b").screen())
        assertEquals("a second REP continues the run", listOf("abbbbb"), TestTerminal(10, 2).feed("ab${CSI}2b${CSI}2b").screen())
        assertEquals("wide characters repeat too", listOf("中中中"), TestTerminal(10, 2).feed("中${CSI}2b").screen())
        val huge = TestTerminal(4, 2).feed("x${CSI}60000b")
        assertEquals("capped at one screenful of repeats", listOf("xxxx", "x"), huge.screen())
        assertEquals(1, huge.emulator.scrollbackSize)
    }

    @Test
    fun `REP of a line drawing character repeats the drawn character`() {
        val t = TestTerminal(10, 2).feed("$ESC(0q${CSI}2b$ESC(B")
        assertEquals(listOf("───"), t.screen())
    }

    // ------------------------------------------------------------ cursor movement

    @Test
    fun `relative moves default to one and clamp at the edges`() {
        val t = TestTerminal(10, 5)
        t.feed("${CSI}3;4H")
        assertEquals(2 to 3, t.cursor)
        t.feed("${CSI}A")
        assertEquals(1 to 3, t.cursor)
        t.feed("${CSI}0B")
        assertEquals(2 to 3, t.cursor)
        t.feed("${CSI}2C")
        assertEquals(2 to 5, t.cursor)
        t.feed("${CSI}D")
        assertEquals(2 to 4, t.cursor)
        t.feed("${CSI}99A")
        assertEquals(0 to 4, t.cursor)
        t.feed("${CSI}99B")
        assertEquals(4 to 4, t.cursor)
        t.feed("${CSI}99C")
        assertEquals(4 to 9, t.cursor)
        t.feed("${CSI}99D")
        assertEquals(4 to 0, t.cursor)
    }

    @Test
    fun `CUP and HVP default missing parameters and clamp large ones`() {
        val t = TestTerminal(10, 5)
        t.feed("${CSI}4;7H")
        assertEquals(3 to 6, t.cursor)
        t.feed("${CSI}H")
        assertEquals(0 to 0, t.cursor)
        t.feed("${CSI}3f")
        assertEquals(2 to 0, t.cursor)
        t.feed("${CSI};5H")
        assertEquals(0 to 4, t.cursor)
        t.feed("${CSI}99;99H")
        assertEquals(4 to 9, t.cursor)
        t.feed("${CSI}0;0H")
        assertEquals(0 to 0, t.cursor)
    }

    @Test
    fun `CNL CPL CHA and VPA`() {
        val t = TestTerminal(10, 5).feed("${CSI}3;5H")
        t.feed("${CSI}E")
        assertEquals(3 to 0, t.cursor)
        t.feed("${CSI}5G${CSI}2F")
        assertEquals(1 to 0, t.cursor)
        t.feed("${CSI}7G")
        assertEquals(1 to 6, t.cursor)
        t.feed("${CSI}4d")
        assertEquals(3 to 6, t.cursor)
        t.feed("${CSI}99G${CSI}99d")
        assertEquals(4 to 9, t.cursor)
    }

    @Test
    fun `cursor up and down stop at the scroll margins when inside them`() {
        val t = TestTerminal(10, 10).feed("${CSI}3;6r")
        t.feed("${CSI}5;1H${CSI}99A")
        assertEquals(2 to 0, t.cursor)
        t.feed("${CSI}99B")
        assertEquals(5 to 0, t.cursor)
        // Outside the region the screen edge is the limit.
        t.feed("${CSI}2;1H${CSI}99A")
        assertEquals(0 to 0, t.cursor)
        t.feed("${CSI}8;1H${CSI}99B")
        assertEquals(9 to 0, t.cursor)
    }

    @Test
    fun `origin mode addresses rows from the top margin and confines the cursor`() {
        val t = TestTerminal(10, 10).feed("${CSI}3;6r${CSI}?6h")
        assertEquals(2 to 0, t.cursor)
        t.feed("${CSI}2;3H")
        assertEquals(3 to 2, t.cursor)
        t.feed("${CSI}99;1H")
        assertEquals(5 to 0, t.cursor)
        t.feed("${CSI}2d")
        assertEquals(3 to 0, t.cursor)
        t.feed("${CSI}6n")
        assertEquals("${CSI}2;1R", t.replies())
        t.feed("${CSI}?6l")
        assertEquals(0 to 0, t.cursor)
        t.feed("${CSI}2;3H")
        assertEquals(1 to 2, t.cursor)
    }

    @Test
    fun `save and restore cursor bring back position and attributes`() {
        val t = TestTerminal(10, 5).feed("${CSI}2;3H${CSI}1;31m${ESC}7${CSI}0m${CSI}5;5H${ESC}8X")
        assertEquals(1 to 3, t.cursor)
        assertEquals(TerminalColor.indexed(1), t.fg(1, 2))
        assertEquals(TerminalAttribute.BOLD, t.attrs(1, 2))
        // The CSI forms do the same.
        t.feed("${CSI}s${CSI}H${CSI}uY")
        assertEquals("  XY", t.row(1))
    }

    @Test
    fun `IND NEL and RI move and scroll`() {
        val t = TestTerminal(5, 3).feed("a${ESC}Db${ESC}Ec")
        assertEquals(listOf("a", " b", "c"), t.screen())
        t.feed("${ESC}Dd")
        assertEquals(listOf(" b", "c", " d"), t.screen())
        t.feed("${CSI}H${ESC}Me")
        assertEquals(listOf("e", " b", "c"), t.screen())
    }

    // ------------------------------------------------------------ erasing

    private fun filled(): TestTerminal = TestTerminal(5, 3).feed("abcde\r\nfghij\r\nklmno")

    @Test
    fun `ED 0 erases from the cursor to the end of the screen`() {
        val t = filled().feed("${CSI}2;3H${CSI}J")
        assertEquals(listOf("abcde", "fg"), t.screen())
        assertEquals(1 to 2, t.cursor)
    }

    @Test
    fun `ED 1 erases from the start of the screen through the cursor`() {
        val t = filled().feed("${CSI}2;3H${CSI}1J")
        assertEquals(listOf("", "   ij", "klmno"), t.screen())
    }

    @Test
    fun `ED 2 erases the screen without moving the cursor or touching scrollback`() {
        val t = filled().feed("\r\npqrst${CSI}2;3H${CSI}2J")
        assertEquals(emptyList<String>(), t.screen())
        assertEquals(1 to 2, t.cursor)
        assertEquals(listOf("abcde"), t.scrollback())
    }

    @Test
    fun `ED 3 erases only the scrollback`() {
        val t = filled().feed("\r\npqrst${CSI}3J")
        assertEquals(listOf("fghij", "klmno", "pqrst"), t.screen())
        assertEquals(0, t.emulator.scrollbackSize)
    }

    @Test
    fun `EL 0 1 and 2`() {
        assertEquals("fg", filled().feed("${CSI}2;3H${CSI}K").row(1))
        assertEquals("fg", filled().feed("${CSI}2;3H${CSI}0K").row(1))
        assertEquals("   ij", filled().feed("${CSI}2;3H${CSI}1K").row(1))
        assertEquals("", filled().feed("${CSI}2;3H${CSI}2K").row(1))
        assertEquals("the other rows stay", listOf("abcde", "", "klmno"), filled().feed("${CSI}2;3H${CSI}2K").screen())
    }

    @Test
    fun `ECH blanks cells without shifting and clamps at the margin`() {
        assertEquals("f  ij", filled().feed("${CSI}2;2H${CSI}2X").row(1))
        assertEquals("f", filled().feed("${CSI}2;2H${CSI}99X").row(1))
    }

    @Test
    fun `erasing paints the current background and resets the other attributes`() {
        val blue = TerminalColor.indexed(4)
        val t = filled().feed("${CSI}1;31;44m${CSI}2;3H${CSI}K")
        assertEquals(blue, t.bg(1, 2))
        assertEquals(blue, t.bg(1, 4))
        assertEquals(TerminalColor.DEFAULT, t.fg(1, 4))
        assertEquals(0, t.attrs(1, 4))
        assertEquals("cells before the cursor keep theirs", TerminalColor.DEFAULT, t.bg(1, 1))

        t.feed("${CSI}3;1H${CSI}2X")
        assertEquals(blue, t.bg(2, 0))
        assertEquals(blue, t.bg(2, 1))
        assertEquals(TerminalColor.DEFAULT, t.bg(2, 2))

        t.feed("${CSI}48;2;1;2;3m${CSI}2J")
        for (row in 0 until 3) for (col in 0 until 5) assertEquals(TerminalColor.rgb(1, 2, 3), t.bg(row, col))
    }

    @Test
    fun `lines scrolled in and lines inserted take the current background`() {
        val green = TerminalColor.indexed(2)
        val t = filled().feed("${CSI}42m\n")
        assertEquals(green, t.bg(2, 0))
        t.feed("${CSI}1;1H${CSI}L")
        assertEquals(green, t.bg(0, 4))
        t.feed("${CSI}5@")
        assertEquals(green, t.bg(0, 0))
    }

    // ------------------------------------------------------------ insert and delete

    @Test
    fun `ICH inserts blanks and pushes the tail off the line`() {
        val t = filled().feed("${CSI}1;2H${CSI}2@")
        assertEquals("a  bc", t.row(0))
        assertEquals(0 to 1, t.cursor)
        assertEquals("a", filled().feed("${CSI}1;2H${CSI}99@").row(0))
    }

    @Test
    fun `DCH deletes cells and pulls the tail left`() {
        assertEquals("ade", filled().feed("${CSI}1;2H${CSI}2P").row(0))
        assertEquals("a", filled().feed("${CSI}1;2H${CSI}99P").row(0))
        assertEquals("acde", filled().feed("${CSI}1;2H${CSI}P").row(0))
    }

    @Test
    fun `IL and DL work inside the scroll region only`() {
        val t = TestTerminal(3, 6).feed("1\r\n2\r\n3\r\n4\r\n5\r\n6")
        t.feed("${CSI}2;5r${CSI}3;2H${CSI}L")
        assertEquals(listOf("1", "2", "", "3", "4", "6"), t.screen())
        assertEquals("IL homes the column", 2 to 0, t.cursor)
        t.feed("${CSI}2M")
        assertEquals(listOf("1", "2", "4", "", "", "6"), t.screen())
        t.feed("${CSI}99L")
        assertEquals(listOf("1", "2", "", "", "", "6"), t.screen())
        // Outside the region they do nothing.
        t.feed("${CSI}6;1H${CSI}M${CSI}L")
        assertEquals(listOf("1", "2", "", "", "", "6"), t.screen())
        t.feed("${CSI}1;1H${CSI}M")
        assertEquals(listOf("1", "2", "", "", "", "6"), t.screen())
        assertEquals(0, t.emulator.scrollbackSize)
    }

    // ------------------------------------------------------------ scroll regions and scrollback

    @Test
    fun `LF at the bottom margin scrolls only the region`() {
        val t = TestTerminal(3, 6).feed("1\r\n2\r\n3\r\n4\r\n5\r\n6")
        t.feed("${CSI}2;4r${CSI}4;1H\nX")
        assertEquals(listOf("1", "3", "4", "X", "5", "6"), t.screen())
        assertEquals("a partial region never feeds scrollback", 0, t.emulator.scrollbackSize)
        t.feed("${ESC}M${ESC}M${ESC}MY")
        assertEquals(listOf("1", " Y", "3", "4", "5", "6"), t.screen())
    }

    @Test
    fun `a region that starts at the top but is not full screen keeps scrollback empty`() {
        val t = TestTerminal(3, 4).feed("1\r\n2\r\n3\r\n4${CSI}1;3r${CSI}3;1H\n\n")
        assertEquals(listOf("3", "", "", "4"), t.screen())
        assertEquals(0, t.emulator.scrollbackSize)
    }

    @Test
    fun `LF below the region moves down without scrolling`() {
        val t = TestTerminal(5, 5).feed("${CSI}1;2r${CSI}4;1Ha\nb\nc\nd")
        assertEquals(listOf("", "", "", "a", " bcd"), t.screen())
    }

    @Test
    fun `DECSTBM homes the cursor and ignores an invalid region`() {
        val t = TestTerminal(5, 5).feed("${CSI}3;3H${CSI}2;4r")
        assertEquals(0 to 0, t.cursor)
        t.feed("${CSI}3;3H${CSI}4;2r")
        assertEquals("an inverted region is rejected", 2 to 2, t.cursor)
        t.feed("${CSI}3;3r")
        assertEquals("a one-line region is rejected", 2 to 2, t.cursor)
        // The 2..4 region is still in force.
        t.feed("${CSI}4;1H\n\n\nx")
        assertEquals(3 to 1, t.cursor)
        t.feed("${CSI}r${CSI}5;1H\n")
        assertEquals("CSI r restores the full screen", 1, t.emulator.scrollbackSize)
    }

    @Test
    fun `SU and SD scroll the region`() {
        val t = TestTerminal(3, 5).feed("1\r\n2\r\n3\r\n4\r\n5${CSI}2;4r${CSI}S")
        assertEquals(listOf("1", "3", "4", "", "5"), t.screen())
        t.feed("${CSI}2T")
        assertEquals(listOf("1", "", "", "3", "5"), t.screen())
        t.feed("${CSI}99S")
        assertEquals(listOf("1", "", "", "", "5"), t.screen())
    }

    @Test
    fun `lines leaving a full-screen main screen go to scrollback in order`() {
        val t = TestTerminal(4, 3)
        for (i in 1..10) t.feed("L$i\r\n")
        assertEquals(listOf("L9", "L10"), t.screen())
        assertEquals((1..8).map { "L$it" }, t.scrollback())
        assertEquals("L8", t.row(-1))
        assertEquals("L1", t.row(-8))
    }

    @Test
    fun `scrollback keeps only the newest lines`() {
        val t = TestTerminal(4, 2, scrollback = 5)
        for (i in 1..20) t.feed("L$i\r\n")
        assertEquals(5, t.emulator.scrollbackSize)
        assertEquals((15..19).map { "L$it" }, t.scrollback())
        assertEquals(listOf("L20"), t.screen())
    }

    @Test
    fun `zero scrollback keeps nothing`() {
        val t = TestTerminal(4, 2, scrollback = 0)
        for (i in 1..20) t.feed("L$i\r\n")
        assertEquals(0, t.emulator.scrollbackSize)
        assertEquals(listOf("L20"), t.screen())
    }

    @Test(expected = IndexOutOfBoundsException::class)
    fun `a line past the scrollback is out of bounds`() {
        TestTerminal(4, 2).feed("a\r\nb\r\nc").emulator.line(-2)
    }

    @Test(expected = IndexOutOfBoundsException::class)
    fun `a line past the screen is out of bounds`() {
        TestTerminal(4, 2).emulator.line(2)
    }

    // ------------------------------------------------------------ alternate screen

    @Test
    fun `1049 shows a cleared alternate screen and brings the main screen and cursor back`() {
        val t = TestTerminal(10, 4).feed("main1\r\nmain2${CSI}31m")
        t.feed("${CSI}?1049h")
        assertTrue(t.emulator.alternateScreen)
        assertEquals(emptyList<String>(), t.screen())
        t.feed("${CSI}H${CSI}32malt screen\r\nx\r\ny\r\nz\r\nscrolled")
        assertEquals(listOf("x", "y", "z", "scrolled"), t.screen())
        assertEquals("the alternate screen has no scrollback", 0, t.emulator.scrollbackSize)
        t.feed("${CSI}?1049l")
        assertFalse(t.emulator.alternateScreen)
        assertEquals(listOf("main1", "main2"), t.screen())
        assertEquals(1 to 5, t.cursor)
        t.feed("!")
        assertEquals("the pen is restored too", TerminalColor.indexed(1), t.fg(1, 5))
        assertEquals(0, t.emulator.scrollbackSize)
    }

    @Test
    fun `entering 1049 again starts from a blank screen`() {
        val t = TestTerminal(10, 4).feed("${CSI}?1049hfirst${CSI}?1049l${CSI}?1049h")
        assertEquals(emptyList<String>(), t.screen())
    }

    @Test
    fun `1049 while already on the alternate screen keeps its content and the saved cursor`() {
        val t = TestTerminal(10, 4).feed("${CSI}2;3H${CSI}?1049h${CSI}Hkeep${CSI}?1049h")
        assertEquals(listOf("keep"), t.screen())
        t.feed("${CSI}?1049l")
        assertEquals(1 to 2, t.cursor)
    }

    @Test
    fun `1049 reset on the main screen still restores the saved cursor`() {
        val t = TestTerminal(10, 4).feed("${CSI}2;3H${ESC}7${CSI}4;4Hx${CSI}?1049l")
        assertEquals(1 to 2, t.cursor)
        assertEquals(listOf("", "", "", "   x"), t.screen())
    }

    @Test
    fun `main scrollback is hidden while the alternate screen is up and back afterwards`() {
        val t = TestTerminal(4, 2).feed("a\r\nb\r\nc")
        assertEquals(1, t.emulator.scrollbackSize)
        t.feed("${CSI}?1049h")
        assertEquals(0, t.emulator.scrollbackSize)
        t.feed("${CSI}?1049l")
        assertEquals(listOf("a"), t.scrollback())
    }

    @Test
    fun `47 and 1047 switch screens without saving the cursor`() {
        val t = TestTerminal(10, 4).feed("main${CSI}?47h")
        assertTrue(t.emulator.alternateScreen)
        t.feed("${CSI}3;3Halt${CSI}?47l")
        assertEquals(listOf("main"), t.screen())
        assertEquals("the cursor stays where the alternate screen left it", 2 to 5, t.cursor)
        t.feed("${CSI}?47h")
        assertEquals("47 does not clear", listOf("", "", "  alt"), t.screen())
        t.feed("${CSI}?47l${CSI}?1047h${CSI}?1047l${CSI}?1047h")
        assertEquals("leaving with 1047 clears", emptyList<String>(), t.screen())
    }

    @Test
    fun `1048 saves and restores the cursor`() {
        val t = TestTerminal(10, 4).feed("${CSI}2;3H${CSI}?1048h${CSI}H${CSI}?1048l")
        assertEquals(1 to 2, t.cursor)
    }

    @Test
    fun `each screen has its own saved cursor`() {
        val t = TestTerminal(10, 4).feed("${CSI}2;2H${ESC}7${CSI}?47h${CSI}4;4H${ESC}7${CSI}H${ESC}8")
        assertEquals(3 to 3, t.cursor)
        t.feed("${CSI}?47l${ESC}8")
        assertEquals(1 to 1, t.cursor)
    }
}
