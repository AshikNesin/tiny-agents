package tinyagents.terminal

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The state machine itself, the terminal's own replies, OSC strings, modes and resets. */
class TerminalParserTest {
    // ------------------------------------------------------------ state machine

    @Test
    fun `C0 controls inside a CSI sequence execute and the sequence continues`() {
        val t = TestTerminal(20, 3).feed("abc$CSI\rC")
        assertEquals(0 to 1, t.cursor)
        val newline = TestTerminal(20, 3).feed("${CSI}3\nCx")
        assertEquals("LF ran, then CUF 3", 1 to 4, newline.cursor)
        val backspace = TestTerminal(20, 3).feed("ab$CSI\b1mX")
        assertEquals("aX", backspace.row(0))
        assertEquals(TerminalAttribute.BOLD, backspace.attrs(0, 1))
    }

    @Test
    fun `CAN and SUB abort a sequence`() {
        assertEquals("mX", TestTerminal(20, 3).feed("${CSI}1\u0018mX").row(0))
        assertEquals(0, TestTerminal(20, 3).feed("${CSI}1\u0018mX").attrs(0, 1))
        assertEquals("mX", TestTerminal(20, 3).feed("${CSI}1\u001amX").row(0))
        assertEquals("7", TestTerminal(20, 3).feed("$ESC\u00187").row(0))
        assertEquals("tail", TestTerminal(20, 3).feed("$ESC]0;title\u0018tail").row(0))
        assertEquals("", TestTerminal(20, 3).feed("$ESC]0;title\u0018tail").emulator.title)
        assertEquals("tail", TestTerminal(20, 3).feed("${ESC}Pdata\u001atail").row(0))
    }

    @Test
    fun `ESC inside a sequence starts a new one`() {
        val t = TestTerminal(20, 3).feed("${CSI}3$CSI;1mX")
        assertEquals(TerminalAttribute.BOLD, t.attrs(0, 0))
        assertEquals("X", t.row(0))
    }

    @Test
    fun `unknown sequences are consumed without printing`() {
        val t = TestTerminal(40, 3)
        t.feed("a${CSI}99zb${CSI}?9999hc${CSI}>4;2md${CSI}=1ue${CSI}?ug${CSI}<1;2;3Mh$ESC#3i${ESC}Nj$ESC(Kk")
        t.feed("${CSI}1;2\$wl${CSI}?2026hm${CSI}?2026ln${CSI}2 qo${CSI}>qp${CSI}?12hq${CSI}14tr${CSI}22;0ts${CSI} @t")
        assertEquals("abcdeghijklmnopqrst", t.row(0))
        assertEquals("", t.replies())
        assertEquals(2, t.emulator.cursorStyle)
    }

    @Test
    fun `a parameter byte after an intermediate or a late private marker ignores the sequence`() {
        assertEquals("X", TestTerminal(20, 3).feed("${CSI}1 2mX").row(0))
        assertEquals(0, TestTerminal(20, 3).feed("${CSI}1 2mX").attrs(0, 0))
        val t = TestTerminal(20, 3).feed("${CSI}1?25lX")
        assertTrue("?25l was not applied", t.emulator.cursorVisible)
        assertEquals("X", t.row(0))
    }

    @Test
    fun `parameters overflow quietly`() {
        val many = (1..200).joinToString(";") { "1" }
        val t = TestTerminal(20, 3).feed("$CSI${many}mX${CSI}99999999999999999999;99999999999999999999H")
        assertEquals(TerminalAttribute.BOLD, t.attrs(0, 0))
        assertEquals(2 to 19, t.cursor)
        t.feed("${CSI}99999999999999Sx")
        t.emulator.checkInvariants()
    }

    @Test
    fun `non-ASCII inside a CSI sequence aborts it`() {
        val t = TestTerminal(20, 3).feed("${CSI}1é")
        assertEquals("", t.row(0))
        t.feed("mX")
        assertEquals("mX", t.row(0))
    }

    @Test
    fun `C1 controls are honoured as decoded code points`() {
        val t = TestTerminal(20, 3).feed("a\u009b2Cb\u0085c\u009d0;c1 title\u009cd")
        assertEquals(listOf("a  b", "cd"), t.screen())
        assertEquals("c1 title", t.emulator.title)
    }

    @Test
    fun `DCS APC PM and SOS strings are swallowed up to ST`() {
        val t = TestTerminal(40, 3)
        t.feed("a${ESC}P1\$r0m$ESC\\b${ESC}_application \u0007 text$ESC\\c$ESC^privacy$ESC\\d${ESC}Xsos$ESC\\e")
        assertEquals("abcde", t.row(0))
        // tmux passthrough wraps a doubled-ESC payload.
        t.feed("${ESC}Ptmux;$ESC$ESC]0;x\u0007$ESC\\f")
        assertEquals("abcdef", t.row(0))
        assertEquals("", t.replies())
    }

    // ------------------------------------------------------------ replies

    @Test
    fun `device attributes`() {
        val t = TestTerminal(20, 3)
        assertEquals("$CSI?62;22c", t.feed("${CSI}c").replies())
        assertEquals("$CSI?62;22c", t.feed("${CSI}0c").replies())
        assertEquals("$CSI>0;276;0c", t.feed("$CSI>c").replies())
        assertEquals("$CSI>0;276;0c", t.feed("$CSI>0c").replies())
        assertEquals("", t.feed("${CSI}1c$CSI>1c$CSI=c").replies())
    }

    @Test
    fun `device status and cursor position reports`() {
        val t = TestTerminal(20, 5)
        assertEquals("${CSI}0n", t.feed("${CSI}5n").replies())
        assertEquals("${CSI}1;1R", t.feed("${CSI}6n").replies())
        assertEquals("${CSI}3;8R", t.feed("${CSI}3;8H${CSI}6n").replies())
        assertEquals("$CSI?3;8R", t.feed("$CSI?6n").replies())
        assertEquals("a pending wrap reports the last column", "${CSI}1;20R", t.feed("${CSI}H${"x".repeat(20)}${CSI}6n").replies())
        assertEquals("", t.feed("${CSI}n${CSI}7n").replies())
    }

    @Test
    fun `text area size and mode reports`() {
        val t = TestTerminal(100, 30)
        assertEquals("${CSI}8;30;100t", t.feed("${CSI}18t").replies())
        assertEquals("$CSI?25;1\$y", t.feed("$CSI?25\$p").replies())
        assertEquals("$CSI?25;2\$y", t.feed("$CSI?25l$CSI?25\$p").replies())
        assertEquals("$CSI?2004;2\$y", t.feed("$CSI?2004\$p").replies())
        assertEquals("$CSI?2004;1\$y", t.feed("$CSI?2004h$CSI?2004\$p").replies())
        assertEquals("an unknown mode reports 0", "$CSI?2026;0\$y", t.feed("$CSI?2026\$p").replies())
    }

    @Test
    fun `queries the terminal does not answer`() {
        val t = TestTerminal(20, 3)
        t.feed("$ESC]10;?\u0007$ESC]11;?$ESC\\$ESC]4;1;?\u0007$ESC]52;c;?\u0007$CSI>q$CSI?u${ESC}P+q544e$ESC\\${CSI}14t${CSI}16t")
        assertEquals("", t.replies())
        assertEquals("", t.row(0))
    }

    // ------------------------------------------------------------ OSC

    @Test
    fun `OSC 0 and 2 set the title with either terminator`() {
        val t = TestTerminal(20, 3)
        assertEquals("with BEL", t.feed("$ESC]0;with BEL\u0007").emulator.title)
        assertEquals("with ST", t.feed("$ESC]2;with ST$ESC\\").emulator.title)
        assertEquals("semi;colons;kept", t.feed("$ESC]2;semi;colons;kept\u0007").emulator.title)
        assertEquals("ünï😀", t.feed("$ESC]0;ünï😀\u0007").emulator.title)
        assertEquals("", t.feed("$ESC]2;\u0007").emulator.title)
        assertEquals("nothing was printed", "", t.row(0))
    }

    @Test
    fun `other OSC commands leave the title and the screen alone`() {
        val t = TestTerminal(40, 3).feed("$ESC]0;keep\u0007")
        t.feed("$ESC]1;icon\u0007$ESC]8;;https://example.com$ESC\\link$ESC]8;;$ESC\\$ESC]7;file:///tmp\u0007")
        t.feed("$ESC]133;A\u0007$ESC]112\u0007$ESC]\u0007$ESC]x\u0007$ESC]0\u0007")
        assertEquals("keep", t.emulator.title)
        assertEquals("link", t.row(0))
    }

    @Test
    fun `an OSC split across feeds and one that is absurdly long`() {
        val t = TestTerminal(20, 3)
        for (piece in listOf("$ESC", "]", "0", ";", "sp", "lit", "$ESC", "\\", "ok")) t.feed(piece)
        assertEquals("split", t.emulator.title)
        assertEquals("ok", t.row(0))
        t.feed("$ESC]0;${"x".repeat(100_000)}\u0007!")
        assertTrue(t.emulator.title.length in 1..8192)
        assertEquals("ok!", t.row(0))
    }

    @Test
    fun `OSC 52 hands the decoded selection to the clipboard callback and never answers a read`() {
        val t = TestTerminal(20, 3)
        val copied = mutableListOf<String>()
        t.emulator.onClipboardCopy = { copied += it }
        t.feed("$ESC]52;c;aGVsbG8gd8O2cmxk\u0007$ESC]52;;dG11eA==$ESC\\$ESC]52;c;?\u0007$ESC]52;c;!!!\u0007$ESC]52;c\u0007")
        assertEquals(listOf("hello wörld", "tmux"), copied)
        assertEquals("", t.replies())
    }

    @Test
    fun `BEL rings the bell callback but not when it ends an OSC`() {
        val t = TestTerminal(20, 3)
        var bells = 0
        t.emulator.onBell = { bells++ }
        t.feed("a\u0007b$ESC]0;t\u0007")
        assertEquals(1, bells)
        assertEquals("ab", t.row(0))
    }

    // ------------------------------------------------------------ modes

    @Test
    fun `input modes are tracked`() {
        val e = TestTerminal(20, 3)
        with(e.emulator) {
            assertFalse(applicationCursorKeys)
            assertFalse(applicationKeypad)
            assertFalse(bracketedPaste)
            assertFalse(focusEvents)
            assertTrue(cursorVisible)
        }
        e.feed("$CSI?1h$ESC=$CSI?2004h$CSI?1004h$CSI?25l")
        with(e.emulator) {
            assertTrue(applicationCursorKeys)
            assertTrue(applicationKeypad)
            assertTrue(bracketedPaste)
            assertTrue(focusEvents)
            assertFalse(cursorVisible)
        }
        e.feed("$CSI?1l$ESC>$CSI?2004l$CSI?1004l$CSI?25h")
        with(e.emulator) {
            assertFalse(applicationCursorKeys)
            assertFalse(applicationKeypad)
            assertFalse(bracketedPaste)
            assertFalse(focusEvents)
            assertTrue(cursorVisible)
        }
    }

    @Test
    fun `several private modes in one sequence`() {
        val e = TestTerminal(20, 3).feed("$CSI?1;2004;25l$CSI?1;2004h").emulator
        assertTrue(e.applicationCursorKeys)
        assertTrue(e.bracketedPaste)
        assertFalse(e.cursorVisible)
    }

    @Test
    fun `mouse tracking modes`() {
        val t = TestTerminal(20, 3)
        assertEquals(MouseTracking.NONE, t.emulator.mouseTracking)
        assertEquals(MouseTracking.X10, t.feed("$CSI?9h").emulator.mouseTracking)
        assertEquals(MouseTracking.NONE, t.feed("$CSI?9l").emulator.mouseTracking)
        assertEquals(MouseTracking.NORMAL, t.feed("$CSI?1000h").emulator.mouseTracking)
        assertEquals(MouseTracking.BUTTON, t.feed("$CSI?1002h").emulator.mouseTracking)
        assertEquals(MouseTracking.ANY, t.feed("$CSI?1003h").emulator.mouseTracking)
        assertFalse(t.emulator.mouseSgrEncoding)
        assertTrue(t.feed("$CSI?1006h").emulator.mouseSgrEncoding)
        // What tmux sends on detach.
        t.feed("$CSI?1000l$CSI?1002l$CSI?1003l$CSI?1006l")
        assertEquals(MouseTracking.NONE, t.emulator.mouseTracking)
        assertFalse(t.emulator.mouseSgrEncoding)
        // What tmux sends with `mouse on`; the other encodings are accepted and ignored.
        t.feed("$CSI?1000h$CSI?1002h$CSI?1006h$CSI?1005l$CSI?1015h")
        assertEquals(MouseTracking.BUTTON, t.emulator.mouseTracking)
        assertTrue(t.emulator.mouseSgrEncoding)
    }

    @Test
    fun `LNM makes LF return the carriage`() {
        val t = TestTerminal(20, 3).feed("${CSI}20hab\ncd${CSI}20l\nef")
        assertEquals(listOf("ab", "cd", "  ef"), t.screen())
    }

    @Test
    fun `DECSCUSR stores the cursor style`() {
        val t = TestTerminal(20, 3)
        assertEquals(0, t.emulator.cursorStyle)
        assertEquals(5, t.feed("${CSI}5 q").emulator.cursorStyle)
        assertEquals(0, t.feed("$CSI q").emulator.cursorStyle)
        assertEquals(6, t.feed("${CSI}99 q").emulator.cursorStyle)
    }

    @Test
    fun `DECALN fills the screen and resets the margins`() {
        val t = TestTerminal(4, 3).feed("${CSI}2;3r${CSI}3;3H$ESC#8")
        assertEquals(listOf("EEEE", "EEEE", "EEEE"), t.screen())
        assertEquals(0 to 0, t.cursor)
        t.feed("${CSI}3;1H\n")
        assertEquals("the region is the whole screen again", 1, t.emulator.scrollbackSize)
    }

    // ------------------------------------------------------------ resets

    @Test
    fun `soft reset restores modes and the pen but keeps the screen`() {
        val t = TestTerminal(10, 5).feed("text${CSI}2;4r$CSI?6h$CSI?25l$CSI?1h${CSI}4h${CSI}1;31m$ESC(0")
        t.feed("$CSI!p")
        with(t.emulator) {
            assertTrue(cursorVisible)
            assertFalse(applicationCursorKeys)
        }
        assertEquals("text", t.row(0))
        t.feed("${CSI}5;1Hq\n")
        assertEquals("q is ASCII again, in the default pen, and the region is the full screen", "q", t.row(3))
        assertEquals(0, t.attrs(3, 0))
        assertEquals(TerminalColor.DEFAULT, t.fg(3, 0))
        assertEquals(1, t.emulator.scrollbackSize)
        t.feed("${CSI}1;1Hab${CSI}1;1HX")
        assertEquals("insert mode is off", "Xb", t.row(0))
    }

    @Test
    fun `RIS clears everything`() {
        val t = TestTerminal(10, 3)
        t.feed("1\r\n2\r\n3\r\n4$ESC]0;title\u0007$CSI?1049halt$CSI?1h$CSI?2004h$CSI?1000h$CSI?1006h$CSI?25l$ESC=")
        t.feed("${CSI}1;31;44m${CSI}2;3r${CSI}5 q$ESC(0$CSI?7l${CSI}3g")
        t.feed("${ESC}c")
        with(t.emulator) {
            assertFalse(alternateScreen)
            assertEquals(0, scrollbackSize)
            assertEquals("", title)
            assertTrue(cursorVisible)
            assertFalse(applicationCursorKeys)
            assertFalse(applicationKeypad)
            assertFalse(bracketedPaste)
            assertEquals(MouseTracking.NONE, mouseTracking)
            assertFalse(mouseSgrEncoding)
            assertEquals(0, cursorStyle)
        }
        assertEquals(emptyList<String>(), t.screen())
        assertEquals(0 to 0, t.cursor)
        assertEquals(TestTerminal(10, 3).emulator.dump(), t.emulator.dump())
        // Tab stops, autowrap, charset and pen are back to their defaults.
        t.feed("\tq0123456789")
        assertEquals(listOf("        q0", "123456789"), t.screen())
        assertEquals(0, t.attrs(0, 8))
        assertEquals(TerminalColor.DEFAULT, t.bg(0, 8))
    }

    @Test
    fun `version moves on every feed and resize`() {
        val e = TestTerminal(10, 3).emulator
        val start = e.version
        e.feed("a".toByteArray())
        assertTrue(e.version > start)
        val afterFeed = e.version
        e.resize(12, 4)
        assertTrue(e.version > afterFeed)
        val afterResize = e.version
        e.resize(12, 4)
        e.feed(ByteArray(0))
        assertEquals("nothing happened", afterResize, e.version)
    }
}
