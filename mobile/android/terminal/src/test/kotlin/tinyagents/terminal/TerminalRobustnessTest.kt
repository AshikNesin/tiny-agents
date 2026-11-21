package tinyagents.terminal

import java.io.ByteArrayOutputStream
import java.util.Random
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TerminalRobustnessTest {
    private val fragments: List<String> = listOf(
        ESC, ESC, CSI, CSI, CSI, "$ESC]", "${ESC}P", "${ESC}_", "$ESC\\", "\u0007", "\u0018", "\u001a",
        "0", "1", "2", "3", "5", "9", "10", "25", "38", "48", "255", "1049", "2004", "65535", "99999999",
        ";", ";", ";", ":", "?", ">", "<", "=", " ", "!", "$", "#", "(", ")", "%",
        "A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "P", "S", "T", "X", "Z",
        "@", "`", "a", "b", "c", "d", "e", "f", "g", "h", "l", "m", "n", "q", "r", "s", "t", "u", "p",
        "7", "8", "\r", "\n", "\t", "\b", "\u000e", "\u000f", "\u000b", "\u007f", "\u0000",
        "中", "文", "😀", "👩‍👧", "é", "́", "️", "é", "─", "\u009b", "\u009d", "\u009c", "\u0085",
        "hello world ", "$ ls -la\r\n", "x".repeat(50),
        "${CSI}?1049h", "${CSI}?1049l", "${CSI}?47h", "${CSI}?1047l", "${CSI}?6h", "${CSI}?6l", "${CSI}?7l", "${CSI}?7h",
        "${CSI}4h", "${CSI}4l", "${CSI}20h", "${CSI}r", "${CSI}2;5r", "${CSI}5;2r", "${CSI}1;1r", "${CSI}3;99r",
        "${CSI}H", "${CSI}99;99H", "${CSI}2J", "${CSI}3J", "${CSI}K", "${CSI}1K", "${CSI}5L", "${CSI}5M", "${CSI}3@",
        "${CSI}3P", "${CSI}3X", "${CSI}9S", "${CSI}9T", "${CSI}40b", "${CSI}6n", "${CSI}c", "${CSI}18t", "${CSI}!p",
        "${ESC}c", "${ESC}7", "${ESC}8", "${ESC}D", "${ESC}M", "${ESC}E", "${ESC}H", "$ESC#8", "$ESC(0", "$ESC(B", "$ESC)0",
        "${CSI}38;2;1;2;3m", "${CSI}48:2::4:5:6m", "${CSI}38;5;200m", "${CSI}1;3;4;7;9m", "${CSI}0m", "${CSI}4:3m",
        "$ESC]0;title\u0007", "$ESC]2;other$ESC\\", "$ESC]52;c;aGk=\u0007", "${CSI}g", "${CSI}3g", "${CSI}I", "${CSI}Z",
    )

    private fun randomStream(random: Random, pieces: Int): ByteArray {
        val out = ByteArrayOutputStream()
        repeat(pieces) {
            if (random.nextInt(12) == 0) {
                val raw = ByteArray(1 + random.nextInt(6))
                random.nextBytes(raw)
                out.write(raw)
            } else {
                out.write(fragments[random.nextInt(fragments.size)].toByteArray(Charsets.UTF_8))
            }
        }
        return out.toByteArray()
    }

    @Test
    fun `random bytes never throw and leave a consistent grid`() {
        for (seed in 1L..300L) {
            val random = Random(seed)
            val emulator = TerminalEmulator(1 + random.nextInt(60), 1 + random.nextInt(30), random.nextInt(40)) {}
            repeat(40) {
                val chunk = ByteArray(random.nextInt(400))
                random.nextBytes(chunk)
                emulator.feed(chunk)
                if (random.nextInt(8) == 0) emulator.resize(random.nextInt(70), random.nextInt(35))
                try {
                    emulator.checkInvariants()
                } catch (e: IllegalStateException) {
                    throw AssertionError("seed $seed: ${e.message}", e)
                }
            }
        }
    }

    @Test
    fun `random bytes biased towards control characters never throw`() {
        for (seed in 1L..200L) {
            val random = Random(seed * 7919)
            val emulator = TerminalEmulator(1 + random.nextInt(20), 1 + random.nextInt(10), 5) {}
            val chunk = ByteArray(4000) {
                when (random.nextInt(6)) {
                    0 -> 0x1B
                    1 -> (0x20 + random.nextInt(0x60)).toByte()
                    2 -> random.nextInt(0x20).toByte()
                    3 -> (0x30 + random.nextInt(0x10)).toByte()
                    4 -> (0x80 + random.nextInt(0x80)).toByte()
                    else -> "[]?;:mHJKr".random(kotlin.random.Random(random.nextLong())).code.toByte()
                }
            }
            emulator.feed(chunk)
            emulator.checkInvariants()
        }
    }

    @Test
    fun `shuffled escape sequences never throw and leave a consistent grid`() {
        for (seed in 1L..400L) {
            val random = Random(seed)
            val emulator = TerminalEmulator(1 + random.nextInt(40), 1 + random.nextInt(20), random.nextInt(30)) {}
            repeat(12) {
                emulator.feed(randomStream(random, 60))
                if (random.nextInt(5) == 0) emulator.resize(random.nextInt(50), random.nextInt(25))
                try {
                    emulator.checkInvariants()
                } catch (e: IllegalStateException) {
                    throw AssertionError("seed $seed: ${e.message}", e)
                }
            }
        }
    }

    private class Run(cols: Int, rows: Int) {
        val replies = ByteArrayOutputStream()
        val emulator = TerminalEmulator(cols, rows, 200) { replies.write(it) }
    }

    private fun assertSplitInvariant(label: String, stream: ByteArray, cols: Int, rows: Int, seed: Long) {
        val whole = Run(cols, rows)
        whole.emulator.feed(stream)

        val bytewise = Run(cols, rows)
        for (i in stream.indices) bytewise.emulator.feed(stream, i, 1)

        val chunked = Run(cols, rows)
        val random = Random(seed)
        var at = 0
        while (at < stream.size) {
            val length = minOf(1 + random.nextInt(7), stream.size - at)
            chunked.emulator.feed(stream, at, length)
            at += length
        }

        val expected = whole.emulator.dump()
        assertEquals("$label: byte at a time", expected, bytewise.emulator.dump())
        assertEquals("$label: random chunks", expected, chunked.emulator.dump())
        assertArrayEquals("$label: replies, byte at a time", whole.replies.toByteArray(), bytewise.replies.toByteArray())
        assertArrayEquals("$label: replies, random chunks", whole.replies.toByteArray(), chunked.replies.toByteArray())
    }

    @Test
    fun `shuffled streams mean the same however they are split`() {
        for (seed in 1L..150L) {
            val random = Random(seed)
            assertSplitInvariant("seed $seed", randomStream(random, 300), 1 + random.nextInt(60), 1 + random.nextInt(25), seed)
        }
    }

    @Test
    fun `a hand-written session means the same however it is split`() {
        val session = buildString {
            append("$ESC]0;user@host: ~\u0007user@host:~$ ls --color\r\n")
            append("${CSI}0m${CSI}01;34mbin${CSI}0m  ${CSI}01;32mrun.sh${CSI}0m  ${CSI}38;5;208mnotes.txt${CSI}0m  日本語 😀\r\n")
            append("${CSI}?1049h${CSI}22;0;0t${CSI}1;24r$ESC(B${CSI}m${CSI}4l${CSI}?7h${CSI}?1h$ESC=${CSI}?25l")
            append("${CSI}H${CSI}2J${CSI}38;2;200;100;50;48:2::10:20:30mheader${CSI}K\r\n")
            append("$ESC(0lqqqqqqk\r\nx${ESC}(B text ${ESC}(0x\r\nmqqqqqqj$ESC(B")
            append("${CSI}5;10r${CSI}10;1H\n\n\n${CSI}r${CSI}3;1H${CSI}2L${CSI}M${CSI}4;5H${CSI}3@abc${CSI}2P${CSI}5X")
            append("${CSI}6n${CSI}c$CSI>c${CSI}?25h${CSI}?1l$ESC>${CSI}?1049l")
            append("é ä́ 👩‍👧 ${"wrap ".repeat(40)}\r\n")
            append("${ESC}7${CSI}99;99H${CSI}1;4;7mend${ESC}8${CSI}?2004h${CSI}?1000h${CSI}?1006h")
            for (i in 1..80) append("line $i ${CSI}3${i % 8}mcolour${CSI}0m\r\n")
        }
        val stream = session.toByteArray(Charsets.UTF_8)
        assertSplitInvariant("session", stream, 80, 24, 1)
        assertSplitInvariant("session, narrow", stream, 23, 7, 2)

        val whole = Run(80, 24)
        whole.emulator.feed(stream)
        val expected = whole.emulator.dump()
        for (cut in 1 until stream.size) {
            val split = Run(80, 24)
            split.emulator.feed(stream, 0, cut)
            split.emulator.feed(stream, cut, stream.size - cut)
            if (split.emulator.dump() != expected) assertEquals("cut at $cut", expected, split.emulator.dump())
        }
        assertEquals("user@host: ~", whole.emulator.title)
        assertEquals("${CSI}4;8R$CSI?62;22c$CSI>0;276;0c", whole.replies.toString(Charsets.ISO_8859_1.name()))
        assertTrue(whole.emulator.bracketedPaste)
        assertEquals(MouseTracking.NORMAL, whole.emulator.mouseTracking)
    }

    @Test
    fun `a recorded tmux session means the same however it is split`() {
        val names = listOf("recorded-tmux-shell.bin", "recorded-tmux-vim.bin")
        for (name in names) {
            val stream = checkNotNull(javaClass.classLoader?.getResourceAsStream(name)) { "missing $name" }.use { it.readBytes() }
            assertTrue("$name is a real recording", stream.size > 2000)
            assertSplitInvariant(name, stream, 100, 30, 3)
            assertSplitInvariant("$name, wrong size", stream, 37, 11, 4)
        }
    }

    @Test
    fun `a huge burst of output stays bounded and in order`() {
        val emulator = TerminalEmulator(80, 24, 100) {}
        val out = StringBuilder()
        for (i in 1..20_000) out.append("row ").append(i).append("\r\n")
        emulator.feed(out.toString().toByteArray())
        assertEquals(100, emulator.scrollbackSize)
        assertEquals("row 20000", emulator.line(22).text())
        assertEquals("row 19977", emulator.line(-1).text())
        assertEquals("row 19878", emulator.line(-100).text())
        emulator.checkInvariants()
    }
}
