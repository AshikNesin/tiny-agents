package tinyagents.terminal

import java.io.ByteArrayOutputStream

internal const val ESC = "\u001b"
internal const val CSI = "\u001b["

internal class TestTerminal(cols: Int = 80, rows: Int = 24, scrollback: Int = 2000) {
    private val replies = ByteArrayOutputStream()
    val emulator = TerminalEmulator(cols, rows, scrollback) { replies.write(it) }

    fun feed(text: String): TestTerminal {
        emulator.feed(text.toByteArray(Charsets.UTF_8))
        return this
    }

    fun feed(bytes: ByteArray): TestTerminal {
        emulator.feed(bytes)
        return this
    }

    fun row(index: Int): String = emulator.line(index).text()

    fun screen(): List<String> {
        val lines = (0 until emulator.rows).map(::row)
        return lines.dropLastWhile { it.isEmpty() }
    }

    fun scrollback(): List<String> = (-emulator.scrollbackSize..-1).map(::row)

    fun replies(): String {
        val text = replies.toString(Charsets.ISO_8859_1.name())
        replies.reset()
        return text
    }

    val cursor: Pair<Int, Int> get() = emulator.cursorRow to emulator.cursorCol

    fun fg(row: Int, col: Int): Int = emulator.line(row).foreground(col)

    fun bg(row: Int, col: Int): Int = emulator.line(row).background(col)

    fun attrs(row: Int, col: Int): Int = emulator.line(row).attributes(col)
}

internal fun TerminalEmulator.dump(): String {
    val out = StringBuilder()
    out.append("size=${cols}x$rows cursor=$cursorRow,$cursorCol visible=$cursorVisible style=$cursorStyle\n")
    out.append("title=$title alt=$alternateScreen appCursor=$applicationCursorKeys keypad=$applicationKeypad\n")
    out.append("paste=$bracketedPaste mouse=$mouseTracking sgr=$mouseSgrEncoding focus=$focusEvents\n")
    for (index in -scrollbackSize until rows) {
        val line = line(index)
        out.append(index).append(if (line.wrapped) "+|" else " |")
        for (col in 0 until line.cols) {
            out.appendCodePoint(line.codePoint(col))
            line.combining(col)?.let(out::append)
        }
        out.append("|")
        var last = Triple(0, 0, 0)
        for (col in 0 until line.cols) {
            val style = Triple(line.foreground(col), line.background(col), line.attributes(col))
            if (style != last) {
                out.append(" $col:${style.first.toString(16)}/${style.second.toString(16)}/${style.third.toString(16)}")
                last = style
            }
        }
        out.append('\n')
    }
    return out.toString()
}

internal fun TerminalEmulator.checkInvariants() {
    check(cursorRow in 0 until rows) { "cursor row $cursorRow outside $rows" }
    check(cursorCol in 0 until cols) { "cursor col $cursorCol outside $cols" }
    for (index in -scrollbackSize until rows) {
        val line = line(index)
        if (index >= 0) check(line.cols == cols) { "screen line $index has ${line.cols} cols, not $cols" }
        for (col in 0 until line.cols) {
            val bits = line.attributes(col)
            val wide = bits and TerminalAttribute.WIDE != 0
            val continuation = bits and TerminalAttribute.WIDE_CONTINUATION != 0
            check(!(wide && continuation)) { "line $index col $col is both halves" }
            if (wide) {
                check(col + 1 < line.cols && line.attributes(col + 1) and TerminalAttribute.WIDE_CONTINUATION != 0) {
                    "line $index col $col: wide lead without continuation"
                }
            }
            if (continuation) {
                check(col > 0 && line.attributes(col - 1) and TerminalAttribute.WIDE != 0) {
                    "line $index col $col: continuation without lead"
                }
            }
        }
    }
}
