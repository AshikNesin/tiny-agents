package tinyagents.terminal

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class TerminalInputTest {
    private fun ByteArray.text(): String = toString(Charsets.ISO_8859_1)

    private fun key(
        key: TerminalKey,
        ctrl: Boolean = false,
        alt: Boolean = false,
        shift: Boolean = false,
        app: Boolean = false,
    ): String = TerminalInput.key(key, ctrl, alt, shift, app).text()

    @Test
    fun `arrows follow DECCKM`() {
        assertEquals("${CSI}A", key(TerminalKey.UP))
        assertEquals("${CSI}B", key(TerminalKey.DOWN))
        assertEquals("${CSI}C", key(TerminalKey.RIGHT))
        assertEquals("${CSI}D", key(TerminalKey.LEFT))
        assertEquals("${ESC}OA", key(TerminalKey.UP, app = true))
        assertEquals("${ESC}OB", key(TerminalKey.DOWN, app = true))
        assertEquals("${ESC}OC", key(TerminalKey.RIGHT, app = true))
        assertEquals("${ESC}OD", key(TerminalKey.LEFT, app = true))
    }

    @Test
    fun `modified arrows use the CSI 1 form whatever DECCKM says`() {
        assertEquals("${CSI}1;2A", key(TerminalKey.UP, shift = true))
        assertEquals("${CSI}1;3B", key(TerminalKey.DOWN, alt = true))
        assertEquals("${CSI}1;5C", key(TerminalKey.RIGHT, ctrl = true))
        assertEquals("${CSI}1;5C", key(TerminalKey.RIGHT, ctrl = true, app = true))
        assertEquals("${CSI}1;6D", key(TerminalKey.LEFT, ctrl = true, shift = true))
        assertEquals("${CSI}1;7D", key(TerminalKey.LEFT, ctrl = true, alt = true))
        assertEquals("${CSI}1;8D", key(TerminalKey.LEFT, ctrl = true, alt = true, shift = true))
        assertEquals("${CSI}1;4A", key(TerminalKey.UP, alt = true, shift = true))
    }

    @Test
    fun `home and end match the web key bar and follow DECCKM`() {
        assertEquals("${CSI}H", key(TerminalKey.HOME))
        assertEquals("${CSI}F", key(TerminalKey.END))
        assertEquals("${ESC}OH", key(TerminalKey.HOME, app = true))
        assertEquals("${ESC}OF", key(TerminalKey.END, app = true))
        assertEquals("${CSI}1;5H", key(TerminalKey.HOME, ctrl = true))
        assertEquals("${CSI}1;2F", key(TerminalKey.END, shift = true))
    }

    @Test
    fun `editing keys`() {
        assertEquals("${CSI}5~", key(TerminalKey.PAGE_UP))
        assertEquals("${CSI}6~", key(TerminalKey.PAGE_DOWN))
        assertEquals("${CSI}2~", key(TerminalKey.INSERT))
        assertEquals("${CSI}3~", key(TerminalKey.DELETE))
        assertEquals("${CSI}5;2~", key(TerminalKey.PAGE_UP, shift = true))
        assertEquals("${CSI}6;2~", key(TerminalKey.PAGE_DOWN, shift = true))
        assertEquals("${CSI}3;5~", key(TerminalKey.DELETE, ctrl = true))
        assertEquals("application cursor mode does not touch them", "${CSI}5~", key(TerminalKey.PAGE_UP, app = true))
    }

    @Test
    fun `function keys`() {
        val plain = listOf(
            "${ESC}OP", "${ESC}OQ", "${ESC}OR", "${ESC}OS", "${CSI}15~", "${CSI}17~",
            "${CSI}18~", "${CSI}19~", "${CSI}20~", "${CSI}21~", "${CSI}23~", "${CSI}24~",
        )
        val keys = listOf(
            TerminalKey.F1, TerminalKey.F2, TerminalKey.F3, TerminalKey.F4, TerminalKey.F5, TerminalKey.F6,
            TerminalKey.F7, TerminalKey.F8, TerminalKey.F9, TerminalKey.F10, TerminalKey.F11, TerminalKey.F12,
        )
        assertEquals(plain, keys.map { key(it) })
        assertEquals("${CSI}1;2P", key(TerminalKey.F1, shift = true))
        assertEquals("${CSI}1;5S", key(TerminalKey.F4, ctrl = true))
        assertEquals("${CSI}15;5~", key(TerminalKey.F5, ctrl = true))
        assertEquals("${CSI}24;3~", key(TerminalKey.F12, alt = true))
    }

    @Test
    fun `enter backspace tab and escape`() {
        assertEquals("\r", key(TerminalKey.ENTER))
        assertEquals("$ESC\r", key(TerminalKey.ENTER, alt = true))
        assertEquals("\u007f", key(TerminalKey.BACKSPACE))
        assertEquals("\b", key(TerminalKey.BACKSPACE, ctrl = true))
        assertEquals("$ESC\u007f", key(TerminalKey.BACKSPACE, alt = true))
        assertEquals("\t", key(TerminalKey.TAB))
        assertEquals("${CSI}Z", key(TerminalKey.TAB, shift = true))
        assertEquals(ESC, key(TerminalKey.ESCAPE))
        assertEquals("$ESC$ESC", key(TerminalKey.ESCAPE, alt = true))
    }

    @Test
    fun `every key encodes with every modifier combination`() {
        for (key in TerminalKey.entries) {
            for (bits in 0 until 16) {
                val bytes = TerminalInput.key(key, bits and 1 != 0, bits and 2 != 0, bits and 4 != 0, bits and 8 != 0)
                assertEquals("$key $bits", true, bytes.isNotEmpty())
            }
        }
    }

    @Test
    fun `plain text is UTF-8`() {
        assertArrayEquals("héllo 中 😀".toByteArray(Charsets.UTF_8), TerminalInput.text("héllo 中 😀"))
        assertArrayEquals(ByteArray(0), TerminalInput.text(""))
    }

    @Test
    fun `ctrl maps letters and punctuation to control codes`() {
        fun ctrl(text: String): List<Int> = TerminalInput.text(text, ctrl = true).map { it.toInt() and 0xFF }
        assertEquals(listOf(0x03), ctrl("c"))
        assertEquals(listOf(0x03), ctrl("C"))
        assertEquals(listOf(0x01), ctrl("a"))
        assertEquals(listOf(0x1A), ctrl("z"))
        assertEquals(listOf(0x00), ctrl("@"))
        assertEquals(listOf(0x00), ctrl(" "))
        assertEquals(listOf(0x1B), ctrl("["))
        assertEquals(listOf(0x1C), ctrl("\\"))
        assertEquals(listOf(0x1D), ctrl("]"))
        assertEquals(listOf(0x1E), ctrl("^"))
        assertEquals(listOf(0x1F), ctrl("_"))
        assertEquals(listOf(0x7F), ctrl("?"))
        assertEquals("anything else passes through", listOf('1'.code), ctrl("1"))
        assertEquals("including non-ASCII", "é".toByteArray(Charsets.UTF_8).map { it.toInt() and 0xFF }, ctrl("é"))
        // The web key bar's control keys.
        assertEquals(listOf(0x04, 0x1A, 0x0C, 0x12), ctrl("dzlr"))
    }

    @Test
    fun `alt prefixes ESC and composes with ctrl`() {
        assertEquals("${ESC}x", TerminalInput.text("x", alt = true).text())
        assertEquals("$ESC\u0003", TerminalInput.text("c", ctrl = true, alt = true).text())
        assertArrayEquals("${ESC}é".toByteArray(Charsets.UTF_8), TerminalInput.text("é", alt = true))
    }

    @Test
    fun `paste normalises newlines and brackets on request`() {
        assertEquals("a\rb\rc\rd", TerminalInput.paste("a\nb\r\nc\rd", bracketed = false).text())
        assertEquals("${CSI}200~a\rb${CSI}201~", TerminalInput.paste("a\nb", bracketed = true).text())
        assertEquals("${CSI}200~${CSI}201~", TerminalInput.paste("", bracketed = true).text())
        assertArrayEquals("中😀".toByteArray(Charsets.UTF_8), TerminalInput.paste("中😀", bracketed = false))
    }

    @Test
    fun `a paste cannot close its own bracket`() {
        val evil = "safe${CSI}201~rm -rf /\n"
        assertEquals("${CSI}200~saferm -rf /\r${CSI}201~", TerminalInput.paste(evil, bracketed = true).text())
    }

    @Test
    fun `mouse wheel reports`() {
        assertEquals("$CSI<64;1;1M", TerminalInput.mouseWheel(up = true, col = 0, row = 0, sgr = true).text())
        assertEquals("$CSI<65;11;6M", TerminalInput.mouseWheel(up = false, col = 10, row = 5, sgr = true).text())
        assertEquals("$CSI<65;300;200M", TerminalInput.mouseWheel(up = false, col = 299, row = 199, sgr = true).text())
        assertEquals("${CSI}M`!!", TerminalInput.mouseWheel(up = true, col = 0, row = 0, sgr = false).text())
        assertEquals("${CSI}Ma+&", TerminalInput.mouseWheel(up = false, col = 10, row = 5, sgr = false).text())
    }

    @Test
    fun `mouse button reports`() {
        assertEquals("$CSI<0;3;2M", TerminalInput.mouseButton(0, pressed = true, col = 2, row = 1, sgr = true).text())
        assertEquals("$CSI<0;3;2m", TerminalInput.mouseButton(0, pressed = false, col = 2, row = 1, sgr = true).text())
        assertEquals("$CSI<2;3;2M", TerminalInput.mouseButton(2, pressed = true, col = 2, row = 1, sgr = true).text())
        assertEquals("$CSI<32;3;2M", TerminalInput.mouseButton(0, pressed = true, col = 2, row = 1, sgr = true, motion = true).text())
        assertEquals("${CSI}M #\"", TerminalInput.mouseButton(0, pressed = true, col = 2, row = 1, sgr = false).text())
        assertEquals("a legacy release is button 3", "${CSI}M##\"", TerminalInput.mouseButton(0, pressed = false, col = 2, row = 1, sgr = false).text())
    }

    @Test
    fun `legacy mouse coordinates saturate at one byte and negative cells clamp`() {
        val far = TerminalInput.mouseButton(0, pressed = true, col = 5000, row = 5000, sgr = false)
        assertEquals(6, far.size)
        assertEquals(255, far[4].toInt() and 0xFF)
        assertEquals(255, far[5].toInt() and 0xFF)
        assertEquals("$CSI<64;1;1M", TerminalInput.mouseWheel(up = true, col = -4, row = -1, sgr = true).text())
    }

    @Test
    fun `focus reports`() {
        assertEquals("${CSI}I", TerminalInput.focus(gained = true).text())
        assertEquals("${CSI}O", TerminalInput.focus(gained = false).text())
    }

    @Test
    fun `the emulator understands its own mouse-free round trip`() {
        // What the key encoder sends is what the web key bar sends for the same keys.
        val bar = mapOf(
            TerminalKey.ESCAPE to "\u001b", TerminalKey.TAB to "\t", TerminalKey.UP to "\u001b[A",
            TerminalKey.DOWN to "\u001b[B", TerminalKey.LEFT to "\u001b[D", TerminalKey.RIGHT to "\u001b[C",
            TerminalKey.HOME to "\u001b[H", TerminalKey.END to "\u001b[F", TerminalKey.PAGE_UP to "\u001b[5~",
            TerminalKey.PAGE_DOWN to "\u001b[6~",
        )
        for ((key, sequence) in bar) assertEquals(sequence, key(key))
    }
}
