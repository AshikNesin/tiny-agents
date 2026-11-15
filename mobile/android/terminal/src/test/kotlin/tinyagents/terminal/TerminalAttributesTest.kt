package tinyagents.terminal

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** SGR in every form, wide and combining characters, UTF-8 decoding, tabs and charsets. */
class TerminalAttributesTest {
    private fun styled(sgr: String): TestTerminal = TestTerminal(20, 3).feed("$CSI${sgr}mX")

    private fun fgOf(sgr: String): Int = styled(sgr).fg(0, 0)

    private fun bgOf(sgr: String): Int = styled(sgr).bg(0, 0)

    private fun attrsOf(sgr: String): Int = styled(sgr).attrs(0, 0)

    // ------------------------------------------------------------ SGR

    @Test
    fun `attribute flags turn on`() {
        assertEquals(TerminalAttribute.BOLD, attrsOf("1"))
        assertEquals(TerminalAttribute.DIM, attrsOf("2"))
        assertEquals(TerminalAttribute.ITALIC, attrsOf("3"))
        assertEquals(TerminalAttribute.UNDERLINE, attrsOf("4"))
        assertEquals(TerminalAttribute.BLINK, attrsOf("5"))
        assertEquals(TerminalAttribute.INVERSE, attrsOf("7"))
        assertEquals(TerminalAttribute.INVISIBLE, attrsOf("8"))
        assertEquals(TerminalAttribute.STRIKETHROUGH, attrsOf("9"))
        assertEquals(TerminalAttribute.UNDERLINE, attrsOf("21"))
        assertEquals(
            TerminalAttribute.BOLD or TerminalAttribute.ITALIC or TerminalAttribute.UNDERLINE,
            attrsOf("1;3;4"),
        )
    }

    @Test
    fun `attribute flags turn off one by one`() {
        val all = "1;2;3;4;5;7;8;9"
        val every = attrsOf(all)
        assertEquals(every and (TerminalAttribute.BOLD or TerminalAttribute.DIM).inv(), attrsOf("$all;22"))
        assertEquals(every and TerminalAttribute.ITALIC.inv(), attrsOf("$all;23"))
        assertEquals(every and TerminalAttribute.UNDERLINE.inv(), attrsOf("$all;24"))
        assertEquals(every and TerminalAttribute.BLINK.inv(), attrsOf("$all;25"))
        assertEquals(every and TerminalAttribute.INVERSE.inv(), attrsOf("$all;27"))
        assertEquals(every and TerminalAttribute.INVISIBLE.inv(), attrsOf("$all;28"))
        assertEquals(every and TerminalAttribute.STRIKETHROUGH.inv(), attrsOf("$all;29"))
    }

    @Test
    fun `underline styles in colon form are plain underline and 4 colon 0 clears it`() {
        assertEquals(TerminalAttribute.UNDERLINE, attrsOf("4:1"))
        assertEquals(TerminalAttribute.UNDERLINE, attrsOf("4:3"))
        assertEquals(0, attrsOf("4;4:0"))
        assertEquals(TerminalAttribute.BOLD or TerminalAttribute.UNDERLINE, attrsOf("4:3;1"))
    }

    @Test
    fun `the 16 basic colours`() {
        for (i in 0..7) {
            assertEquals(TerminalColor.indexed(i), fgOf("${30 + i}"))
            assertEquals(TerminalColor.indexed(i), bgOf("${40 + i}"))
            assertEquals(TerminalColor.indexed(8 + i), fgOf("${90 + i}"))
            assertEquals(TerminalColor.indexed(8 + i), bgOf("${100 + i}"))
        }
    }

    @Test
    fun `256 colours in semicolon and colon forms`() {
        assertEquals(TerminalColor.indexed(196), fgOf("38;5;196"))
        assertEquals(TerminalColor.indexed(21), bgOf("48;5;21"))
        assertEquals(TerminalColor.indexed(196), fgOf("38:5:196"))
        assertEquals(TerminalColor.indexed(21), bgOf("48:5:21"))
        assertEquals(TerminalColor.indexed(0), fgOf("38;5;0"))
        assertEquals(TerminalColor.indexed(255), fgOf("38;5;999"))
    }

    @Test
    fun `24-bit colours in semicolon and colon forms`() {
        val orange = TerminalColor.rgb(255, 128, 0)
        assertEquals(orange, fgOf("38;2;255;128;0"))
        assertEquals(orange, bgOf("48;2;255;128;0"))
        assertEquals(orange, fgOf("38:2::255:128:0"))
        assertEquals(orange, bgOf("48:2::255:128:0"))
        assertEquals("the colour-space slot may be filled", orange, fgOf("38:2:1:255:128:0"))
        assertEquals("or left out altogether", orange, fgOf("38:2:255:128:0"))
        assertEquals(TerminalColor.rgb(0, 0, 0), fgOf("38;2;0;0;0"))
        assertEquals(TerminalColor.rgb(255, 255, 255), fgOf("38;2;999;999;999"))
        assertEquals(0xFF8000, TerminalColor.rgbValue(orange))
    }

    @Test
    fun `an extended colour does not swallow the codes after it`() {
        val t = styled("38;5;196;1;48;2;1;2;3;4")
        assertEquals(TerminalColor.indexed(196), t.fg(0, 0))
        assertEquals(TerminalColor.rgb(1, 2, 3), t.bg(0, 0))
        assertEquals(TerminalAttribute.BOLD or TerminalAttribute.UNDERLINE, t.attrs(0, 0))

        val colon = styled("38:2::10:20:30;3;48:5:7;9")
        assertEquals(TerminalColor.rgb(10, 20, 30), colon.fg(0, 0))
        assertEquals(TerminalColor.indexed(7), colon.bg(0, 0))
        assertEquals(TerminalAttribute.ITALIC or TerminalAttribute.STRIKETHROUGH, colon.attrs(0, 0))
    }

    @Test
    fun `the underline colour is parsed and dropped`() {
        val t = styled("4:3;58:2::255:0:0;31")
        assertEquals(TerminalColor.indexed(1), t.fg(0, 0))
        assertEquals(TerminalColor.DEFAULT, t.bg(0, 0))
        assertEquals(TerminalAttribute.UNDERLINE, t.attrs(0, 0))
        val semicolon = styled("58;5;200;32;59")
        assertEquals(TerminalColor.indexed(2), semicolon.fg(0, 0))
        assertEquals(0, semicolon.attrs(0, 0))
    }

    @Test
    fun `a truncated extended colour changes nothing`() {
        assertEquals(TerminalColor.DEFAULT, fgOf("38"))
        assertEquals(TerminalColor.DEFAULT, fgOf("38;5"))
        assertEquals(TerminalColor.DEFAULT, fgOf("38;2;1;2"))
        assertEquals(TerminalColor.DEFAULT, fgOf("38:2"))
        assertEquals(TerminalColor.DEFAULT, fgOf("38:5"))
    }

    @Test
    fun `39 and 49 reset one colour and 0 or an empty SGR resets everything`() {
        assertEquals(TerminalColor.DEFAULT, fgOf("31;44;39"))
        assertEquals(TerminalColor.indexed(4), bgOf("31;44;39"))
        assertEquals(TerminalColor.DEFAULT, bgOf("31;44;49"))
        assertEquals(TerminalColor.indexed(1), fgOf("31;44;49"))
        for (reset in listOf("0", "")) {
            val t = TestTerminal(20, 3).feed("${CSI}1;4;31;44m$CSI${reset}mX")
            assertEquals(TerminalColor.DEFAULT, t.fg(0, 0))
            assertEquals(TerminalColor.DEFAULT, t.bg(0, 0))
            assertEquals(0, t.attrs(0, 0))
        }
        assertEquals("a reset in the middle applies to what came before it", TerminalAttribute.BOLD, attrsOf("4;31;0;1"))
    }

    @Test
    fun `unknown SGR codes are skipped`() {
        val t = styled("53;1;55;99;31")
        assertEquals(TerminalAttribute.BOLD, t.attrs(0, 0))
        assertEquals(TerminalColor.indexed(1), t.fg(0, 0))
    }

    @Test
    fun `colour helpers classify their encodings`() {
        assertTrue(TerminalColor.isDefault(TerminalColor.DEFAULT))
        assertTrue(TerminalColor.isIndexed(TerminalColor.indexed(0)))
        assertFalse(TerminalColor.isDefault(TerminalColor.indexed(0)))
        assertFalse(TerminalColor.isRgb(TerminalColor.indexed(0)))
        assertTrue(TerminalColor.isRgb(TerminalColor.rgb(0, 0, 0)))
        assertFalse(TerminalColor.isDefault(TerminalColor.rgb(0, 0, 0)))
        assertFalse(TerminalColor.isIndexed(TerminalColor.rgb(0, 0, 0)))
        assertEquals(200, TerminalColor.index(TerminalColor.indexed(200)))
    }

    // ------------------------------------------------------------ wide and combining characters

    @Test
    fun `a wide character takes two cells`() {
        val t = TestTerminal(10, 3).feed("a中b")
        val line = t.emulator.line(0)
        assertEquals("a中b", line.text())
        assertEquals(1, line.width(0))
        assertEquals(2, line.width(1))
        assertEquals(0, line.width(2))
        assertEquals(1, line.width(3))
        assertEquals('中'.code, line.codePoint(1))
        assertEquals(' '.code, line.codePoint(2))
        assertEquals(0 to 4, t.cursor)
    }

    @Test
    fun `an astral emoji is one wide cell`() {
        val t = TestTerminal(10, 3).feed("😀!")
        val line = t.emulator.line(0)
        assertEquals(0x1F600, line.codePoint(0))
        assertEquals(2, line.width(0))
        assertEquals('!'.code, line.codePoint(2))
        assertEquals("😀!", line.text())
    }

    @Test
    fun `a wide character that does not fit wraps whole and leaves the last cell as it was`() {
        val t = TestTerminal(5, 3).feed("abcd中")
        assertEquals(listOf("abcd", "中"), t.screen())
        assertEquals(1 to 2, t.cursor)
        assertEquals(true, t.emulator.line(0).wrapped)
        val over = TestTerminal(5, 3).feed("12345\rabcd中")
        assertEquals(listOf("abcd5", "中"), over.screen())
    }

    @Test
    fun `a wide character ending on the last column leaves a wrap pending`() {
        val t = TestTerminal(5, 3).feed("abc中")
        assertEquals(0 to 4, t.cursor)
        t.feed("d")
        assertEquals(listOf("abc中", "d"), t.screen())
    }

    @Test
    fun `with autowrap off a wide character at the margin is dropped`() {
        val t = TestTerminal(5, 3).feed("${CSI}?7labcd中")
        assertEquals(listOf("abcd"), t.screen())
    }

    @Test
    fun `overwriting half of a wide character blanks the other half`() {
        val left = TestTerminal(10, 3).feed("中文${CSI}1;1Hx")
        assertEquals("x 文", left.row(0))
        assertEquals(1, left.emulator.line(0).width(1))
        val right = TestTerminal(10, 3).feed("中文${CSI}1;2Hx")
        assertEquals(" x文", right.row(0))
        assertEquals(1, right.emulator.line(0).width(0))
        val straddle = TestTerminal(10, 3).feed("中文${CSI}1;2H字")
        assertEquals(" 字", straddle.row(0))
        straddle.emulator.checkInvariants()
    }

    @Test
    fun `erase insert and delete never leave half a wide character`() {
        val cases = listOf("${CSI}1;2H${CSI}K", "${CSI}1;2H${CSI}1K", "${CSI}1;2H${CSI}X", "${CSI}1;3H${CSI}X",
            "${CSI}1;2H${CSI}P", "${CSI}1;1H${CSI}P", "${CSI}1;2H${CSI}@", "${CSI}1;4H${CSI}3@", "${CSI}1;1H${CSI}@")
        for (case in cases) {
            val t = TestTerminal(6, 2).feed("中文字$case")
            t.emulator.checkInvariants()
        }
        assertEquals(" 文字", TestTerminal(6, 2).feed("中文字${CSI}1;1H${CSI}P").row(0))
        assertEquals("  文字", TestTerminal(6, 2).feed("中文字${CSI}1;2H${CSI}X").row(0))
        assertEquals("中  字", TestTerminal(6, 2).feed("中文字${CSI}1;3H${CSI}X").row(0))
        assertEquals(" 中文", TestTerminal(6, 2).feed("中文字${CSI}1;1H${CSI}@").row(0))
    }

    @Test
    fun `combining marks join the previous cell`() {
        val t = TestTerminal(10, 3).feed("éx")
        val line = t.emulator.line(0)
        assertEquals('e'.code, line.codePoint(0))
        assertEquals("́", line.combining(0))
        assertEquals('x'.code, line.codePoint(1))
        assertNull(line.combining(1))
        assertEquals("éx", line.text())
        assertEquals(0 to 2, t.cursor)
    }

    @Test
    fun `several marks and joiners stack on one cell`() {
        val t = TestTerminal(10, 3).feed("á̈b")
        assertEquals("́̈", t.emulator.line(0).combining(0))
        // A ZWJ sequence: each emoji is its own wide cell, the joiner rides on the first.
        val family = TestTerminal(10, 3).feed("👩‍👧")
        assertEquals("‍", family.emulator.line(0).combining(0))
        assertEquals(0x1F467, family.emulator.line(0).codePoint(2))
        assertEquals(0 to 4, family.cursor)
    }

    @Test
    fun `a mark after a wide character or on the last column attaches to that character`() {
        val wide = TestTerminal(10, 3).feed("中́")
        assertEquals("́", wide.emulator.line(0).combining(0))
        val margin = TestTerminal(3, 3).feed("abć")
        assertEquals("́", margin.emulator.line(0).combining(2))
        assertEquals(0 to 2, margin.cursor)
        val wideMargin = TestTerminal(4, 3).feed("ab中️")
        assertEquals("️", wideMargin.emulator.line(0).combining(2))
    }

    @Test
    fun `a mark with nothing before it is dropped and overwriting a cell drops its marks`() {
        val t = TestTerminal(10, 3).feed("́á\rb")
        assertEquals("b", t.row(0))
        assertNull(t.emulator.line(0).combining(0))
    }

    @Test
    fun `width table agrees with wcwidth on the usual suspects`() {
        assertEquals(1, CharWidth.of('a'.code))
        assertEquals(1, CharWidth.of(0xE9))
        assertEquals(1, CharWidth.of(0x2500))
        assertEquals(1, CharWidth.of(0x2764))
        assertEquals(2, CharWidth.of(0x4E2D))
        assertEquals(2, CharWidth.of(0xFF21))
        assertEquals(2, CharWidth.of(0x1F600))
        assertEquals(2, CharWidth.of(0xAC00))
        assertEquals(2, CharWidth.of(0x3042))
        assertEquals(0, CharWidth.of(0x0301))
        assertEquals(0, CharWidth.of(0x200D))
        assertEquals(0, CharWidth.of(0xFE0F))
        assertEquals(0, CharWidth.of(0x200B))
        assertEquals(1, CharWidth.of(0x10FFFF))
    }

    // ------------------------------------------------------------ UTF-8

    @Test
    fun `UTF-8 split at every byte boundary decodes the same`() {
        val text = "aé中😀é ─ ñ𝄞z"
        val bytes = text.toByteArray(Charsets.UTF_8)
        val whole = TestTerminal(40, 3).feed(bytes).emulator.dump()
        for (cut in 1 until bytes.size) {
            val t = TestTerminal(40, 3)
            t.emulator.feed(bytes, 0, cut)
            t.emulator.feed(bytes, cut, bytes.size - cut)
            assertEquals("cut at $cut", whole, t.emulator.dump())
        }
        val byByte = TestTerminal(40, 3)
        for (i in bytes.indices) byByte.emulator.feed(bytes, i, 1)
        assertEquals(whole, byByte.emulator.dump())
        assertEquals(text, TestTerminal(40, 3).feed(bytes).row(0))
    }

    private fun decoded(vararg bytes: Int): String =
        TestTerminal(20, 2).feed(ByteArray(bytes.size) { bytes[it].toByte() }).row(0)

    @Test
    fun `malformed UTF-8 becomes replacement characters and decoding resynchronises`() {
        assertEquals("a�b", decoded(0x61, 0x80, 0x62))
        assertEquals("a�b", decoded(0x61, 0xFF, 0x62))
        assertEquals("a�b", decoded(0x61, 0xC3, 0x62))
        assertEquals("truncated three-byte sequence", "a�b", decoded(0x61, 0xE4, 0xB8, 0x62))
        assertEquals("overlong slash", "��", decoded(0xC0, 0xAF))
        assertEquals("overlong three-byte", "���", decoded(0xE0, 0x80, 0xAF))
        assertEquals("a surrogate", "���", decoded(0xED, 0xA0, 0x80))
        assertEquals("beyond U+10FFFF", "����", decoded(0xF4, 0x90, 0x80, 0x80))
        assertEquals("a lead byte after a lead byte", "�é", decoded(0xE4, 0xC3, 0xA9))
        assertEquals("an escape inside a sequence still runs", "�", decoded(0xE4, 0xB8, 0x1B, 0x5B, 0x43))
    }

    @Test
    fun `a sequence left unfinished at the end of a feed waits for its bytes`() {
        val t = TestTerminal(20, 2)
        t.emulator.feed(byteArrayOf(0xF0.toByte(), 0x9F.toByte()))
        assertEquals("", t.row(0))
        t.emulator.feed(byteArrayOf(0x98.toByte(), 0x80.toByte()))
        assertEquals("😀", t.row(0))
    }

    @Test
    fun `feed honours offset and length`() {
        val t = TestTerminal(20, 2)
        t.emulator.feed("xxhelloxx".toByteArray(), 2, 5)
        assertEquals("hello", t.row(0))
        t.emulator.feed(ByteArray(0))
        assertEquals("hello", t.row(0))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `feed rejects a range outside the array`() {
        TestTerminal(20, 2).emulator.feed(ByteArray(4), 2, 3)
    }

    // ------------------------------------------------------------ tabs

    @Test
    fun `tab stops sit every eight columns`() {
        val t = TestTerminal(30, 2).feed("\tA\tB\t\tC")
        val line = t.emulator.line(0)
        assertEquals('A'.code, line.codePoint(8))
        assertEquals('B'.code, line.codePoint(16))
        assertEquals("the last tab has no stop left and runs to the margin", 'C'.code, line.codePoint(29))
        assertEquals("A", line.text().trim().substring(0, 1))
        assertEquals(0 to 29, t.cursor)
    }

    @Test
    fun `a tab at the end of the line stops on the last column`() {
        val t = TestTerminal(10, 2).feed("123456789\t")
        assertEquals(0 to 9, t.cursor)
        t.feed("\t\tX")
        assertEquals("123456789X", t.row(0))
    }

    @Test
    fun `HTS sets a stop and TBC clears one or all`() {
        val t = TestTerminal(40, 2).feed("${CSI}1;4H${ESC}H\r\tA")
        assertEquals(0 to 4, t.cursor)
        t.feed("\r${CSI}1;4H${CSI}g\r\tB")
        assertEquals("the stop at 3 is gone", 0 to 9, t.cursor)
        t.feed("\r${CSI}3g\tC")
        assertEquals("no stops: a tab runs to the margin", 0 to 39, t.cursor)
    }

    @Test
    fun `CHT and CBT move by several stops`() {
        val t = TestTerminal(40, 2).feed("${CSI}2I")
        assertEquals(0 to 16, t.cursor)
        t.feed("ab${CSI}Z")
        assertEquals(0 to 16, t.cursor)
        t.feed("${CSI}2Z")
        assertEquals(0 to 0, t.cursor)
        t.feed("${CSI}Z")
        assertEquals(0 to 0, t.cursor)
    }

    // ------------------------------------------------------------ charsets

    @Test
    fun `DEC special graphics draws boxes`() {
        val t = TestTerminal(20, 4).feed("$ESC(0lqqk\r\nx  x\r\nmqqj$ESC(B lqk")
        assertEquals(listOf("┌──┐", "│  │", "└──┘ lqk"), t.screen())
    }

    @Test
    fun `the whole special graphics set maps to Unicode`() {
        val t = TestTerminal(40, 2).feed("$ESC(0`afgjklmnopqrstuvwxyz{|}~$ESC(B")
        assertEquals("◆▒°±┘┐┌└┼⎺⎻─⎼⎽├┤┴┬│≤≥π≠£·", t.row(0))
        // Uppercase and digits are untouched.
        assertEquals("AZ09", TestTerminal(40, 2).feed("$ESC(0AZ09").row(0))
    }

    @Test
    fun `SO and SI switch between G0 and G1`() {
        val t = TestTerminal(20, 2).feed("$ESC)0q\u000eq\u000fq")
        assertEquals("q─q", t.row(0))
        val g0 = TestTerminal(20, 2).feed("$ESC(0\u000eq\u000fq")
        assertEquals("G1 is still ASCII", "q─", g0.row(0))
    }

    @Test
    fun `save and restore cursor carry the charset`() {
        val t = TestTerminal(20, 2).feed("$ESC(0${ESC}7$ESC(Bq${ESC}8${CSI}Cq")
        assertEquals("q─", t.row(0))
    }

    @Test
    fun `other charset designations are consumed and mean ASCII`() {
        val t = TestTerminal(20, 2).feed("$ESC(0$ESC(Aq$ESC*0$ESC+0q$ESC%Gq")
        assertEquals("qqq", t.row(0))
    }
}
