package tinyagents.terminal

import java.util.Base64

public enum class MouseTracking {
    NONE,

    X10,

    NORMAL,

    BUTTON,

    ANY,
}

public class TerminalEmulator(
    cols: Int,
    rows: Int,
    scrollbackLines: Int = 2000,
    private val reply: (ByteArray) -> Unit,
) {
    public var cols: Int = cols.coerceAtLeast(1)
        private set

    public var rows: Int = rows.coerceAtLeast(1)
        private set

    public var cursorRow: Int = 0
        private set

    public var cursorCol: Int = 0
        private set

    public var cursorVisible: Boolean = true
        private set

    public var cursorStyle: Int = 0
        private set

    public var title: String = ""
        private set

    public var applicationCursorKeys: Boolean = false
        private set

    public var applicationKeypad: Boolean = false
        private set

    public var bracketedPaste: Boolean = false
        private set

    public var mouseTracking: MouseTracking = MouseTracking.NONE
        private set

    public var mouseSgrEncoding: Boolean = false
        private set

    public var focusEvents: Boolean = false
        private set

    public var alternateScreen: Boolean = false
        private set

    public var version: Long = 0
        private set

    public var onBell: (() -> Unit)? = null

    public var onClipboardCopy: ((String) -> Unit)? = null

    public val scrollbackSize: Int
        get() = if (alternateScreen) 0 else historySize

    private var mainScreen: Array<TerminalLine> = newScreen(this.cols, this.rows)
    private var altScreen: Array<TerminalLine> = newScreen(this.cols, this.rows)
    private var screen: Array<TerminalLine> = mainScreen

    private val historyCapacity: Int = scrollbackLines.coerceAtLeast(0)
    private val history: Array<TerminalLine?> = arrayOfNulls(historyCapacity)
    private var historyStart: Int = 0
    private var historySize: Int = 0

    private var pendingWrap: Boolean = false
    private var penFg: Int = TerminalColor.DEFAULT
    private var penBg: Int = TerminalColor.DEFAULT
    private var penAttrs: Int = 0
    private var g0Graphics: Boolean = false
    private var g1Graphics: Boolean = false
    private var shiftOut: Boolean = false
    private var lastPrinted: Int = -1
    private val savedMain = SavedCursor()
    private val savedAlt = SavedCursor()

    private var originMode: Boolean = false
    private var autoWrap: Boolean = true
    private var insertMode: Boolean = false
    private var newLineMode: Boolean = false
    private var scrollTop: Int = 0
    private var scrollBottom: Int = this.rows - 1
    private var tabStops: BooleanArray = defaultTabStops(this.cols)

    private var utf8Needed: Int = 0
    private var utf8CodePoint: Int = 0
    private var utf8Lower: Int = 0x80
    private var utf8Upper: Int = 0xBF
    private var state: Int = GROUND
    private val params = IntArray(MAX_PARAMS)
    private val paramIsSub = BooleanArray(MAX_PARAMS)
    private var paramCount: Int = 1
    private var privateMarker: Int = 0
    private var intermediate: Int = 0
    private var intermediateCount: Int = 0
    private val oscBuffer = StringBuilder()

    public fun line(index: Int): TerminalLine {
        if (index >= 0) {
            if (index >= rows) throw IndexOutOfBoundsException("line $index of $rows")
            return screen[index]
        }
        val back = -index
        if (back > scrollbackSize) throw IndexOutOfBoundsException("line $index of -$scrollbackSize")
        return history[(historyStart + historySize - back) % historyCapacity]!!
    }

    public fun feed(bytes: ByteArray, offset: Int = 0, length: Int = bytes.size) {
        require(offset >= 0 && length >= 0 && offset <= bytes.size - length) {
            "range $offset+$length outside ${bytes.size} bytes"
        }
        if (length == 0) return
        val end = offset + length
        var i = offset
        while (i < end) {
            val byte = bytes[i].toInt() and 0xFF
            if (utf8Needed == 0) {
                i++
                when {
                    byte < 0x80 -> process(byte)
                    byte in 0xC2..0xDF -> startUtf8(byte and 0x1F, 1, 0x80, 0xBF)
                    byte == 0xE0 -> startUtf8(0, 2, 0xA0, 0xBF)
                    byte == 0xED -> startUtf8(0xD, 2, 0x80, 0x9F)
                    byte in 0xE1..0xEF -> startUtf8(byte and 0x0F, 2, 0x80, 0xBF)
                    byte == 0xF0 -> startUtf8(0, 3, 0x90, 0xBF)
                    byte == 0xF4 -> startUtf8(4, 3, 0x80, 0x8F)
                    byte in 0xF1..0xF3 -> startUtf8(byte and 0x07, 3, 0x80, 0xBF)
                    else -> process(REPLACEMENT)
                }
            } else if (byte in utf8Lower..utf8Upper) {
                i++
                utf8CodePoint = (utf8CodePoint shl 6) or (byte and 0x3F)
                utf8Lower = 0x80
                utf8Upper = 0xBF
                if (--utf8Needed == 0) process(utf8CodePoint)
            } else {
                utf8Needed = 0
                process(REPLACEMENT)
            }
        }
        version++
    }

    public fun resize(cols: Int, rows: Int) {
        val newCols = cols.coerceAtLeast(1)
        val newRows = rows.coerceAtLeast(1)
        if (newCols == this.cols && newRows == this.rows) return

        val mainCursor = if (alternateScreen) savedMain.row else cursorRow
        val altCursor = if (alternateScreen) cursorRow else savedAlt.row
        val (resizedMain, mainRow) = resizeRows(mainScreen, mainCursor, newRows, newCols, main = true)
        val (resizedAlt, altRow) = resizeRows(altScreen, altCursor, newRows, newCols, main = false)
        mainScreen = resizedMain
        altScreen = resizedAlt
        for (line in mainScreen) line.resize(newCols)
        for (line in altScreen) line.resize(newCols)
        screen = if (alternateScreen) altScreen else mainScreen

        val oldStops = tabStops
        tabStops = defaultTabStops(newCols)
        System.arraycopy(oldStops, 0, tabStops, 0, minOf(oldStops.size, newCols))

        if (pendingWrap && newCols > this.cols) cursorCol++
        this.cols = newCols
        this.rows = newRows
        cursorRow = (if (alternateScreen) altRow else mainRow).coerceIn(0, newRows - 1)
        cursorCol = cursorCol.coerceIn(0, newCols - 1)
        pendingWrap = false
        savedMain.row = (if (alternateScreen) mainRow else savedMain.row).coerceIn(0, newRows - 1)
        savedMain.col = savedMain.col.coerceIn(0, newCols - 1)
        savedMain.pendingWrap = false
        savedAlt.row = savedAlt.row.coerceIn(0, newRows - 1)
        savedAlt.col = savedAlt.col.coerceIn(0, newCols - 1)
        savedAlt.pendingWrap = false
        scrollTop = 0
        scrollBottom = newRows - 1
        version++
    }

    private fun resizeRows(
        lines: Array<TerminalLine>,
        cursor: Int,
        newRows: Int,
        newCols: Int,
        main: Boolean,
    ): Pair<Array<TerminalLine>, Int> {
        val oldRows = lines.size
        if (newRows == oldRows) return lines to cursor
        if (newRows < oldRows) {
            val excess = oldRows - newRows
            var dropBottom = 0
            while (dropBottom < excess && oldRows - 1 - dropBottom > cursor && lines[oldRows - 1 - dropBottom].isBlank()) {
                dropBottom++
            }
            val dropTop = excess - dropBottom
            if (main) for (row in 0 until dropTop) pushHistory(lines[row])
            return lines.copyOfRange(dropTop, dropTop + newRows) to cursor - dropTop
        }
        val added = newRows - oldRows
        val pulled = if (main) minOf(added, historySize) else 0
        val grown = Array(newRows) { row ->
            when {
                row < pulled -> popHistory(pulled - 1 - row)
                row < pulled + oldRows -> lines[row - pulled]
                else -> TerminalLine(newCols)
            }
        }
        if (main) historySize -= pulled
        return grown to cursor + pulled
    }

    private fun startUtf8(bits: Int, needed: Int, lower: Int, upper: Int) {
        utf8CodePoint = bits
        utf8Needed = needed
        utf8Lower = lower
        utf8Upper = upper
    }

    private fun process(cp: Int) {
        if (state == GROUND) {
            when {
                cp >= 0xA0 || cp in 0x20..0x7E -> print(cp)
                cp < 0x20 -> execute(cp)
                cp >= 0x80 -> c1(cp)
            }
            return
        }
        if (state == OSC_STRING) {
            when {
                cp == BEL || cp == C1_ST -> {
                    state = GROUND
                    dispatchOsc()
                }
                cp == ESC -> {
                    dispatchOsc()
                    enterEscape()
                }
                cp == CAN || cp == SUB -> state = GROUND
                cp < 0x20 -> Unit
                oscBuffer.length < MAX_OSC_CHARS -> oscBuffer.appendCodePoint(cp)
            }
            return
        }
        if (state == IGNORED_STRING) {
            when (cp) {
                ESC -> enterEscape()
                CAN, SUB, C1_ST -> state = GROUND
            }
            return
        }
        if (cp < 0x20) {
            when (cp) {
                ESC -> enterEscape()
                CAN, SUB -> state = GROUND
                else -> execute(cp)
            }
            return
        }
        if (cp >= 0x7F) {
            when {
                cp == 0x7F -> Unit
                cp < 0xA0 -> c1(cp)
                else -> state = GROUND
            }
            return
        }
        when (state) {
            ESCAPE -> when {
                cp < 0x30 -> {
                    collect(cp)
                    state = ESCAPE_INTERMEDIATE
                }
                cp == '['.code -> enterCsi()
                cp == ']'.code -> enterOsc()
                cp == 'P'.code || cp == 'X'.code || cp == '^'.code || cp == '_'.code -> state = IGNORED_STRING
                else -> {
                    state = GROUND
                    dispatchEscape(cp)
                }
            }
            ESCAPE_INTERMEDIATE -> if (cp < 0x30) {
                collect(cp)
            } else {
                state = GROUND
                dispatchEscape(cp)
            }
            CSI_ENTRY, CSI_PARAM -> when {
                cp >= 0x40 -> {
                    state = GROUND
                    dispatchCsi(cp)
                }
                cp < 0x30 -> {
                    collect(cp)
                    state = CSI_INTERMEDIATE
                }
                cp <= '9'.code -> {
                    addDigit(cp - '0'.code)
                    state = CSI_PARAM
                }
                cp == ';'.code || cp == ':'.code -> {
                    nextParam(sub = cp == ':'.code)
                    state = CSI_PARAM
                }
                state == CSI_ENTRY -> {
                    privateMarker = cp
                    state = CSI_PARAM
                }
                else -> state = CSI_IGNORE
            }
            CSI_INTERMEDIATE -> when {
                cp >= 0x40 -> {
                    state = GROUND
                    dispatchCsi(cp)
                }
                cp < 0x30 -> collect(cp)
                else -> state = CSI_IGNORE
            }
            CSI_IGNORE -> if (cp >= 0x40) state = GROUND
        }
    }

    private fun enterEscape() {
        state = ESCAPE
        intermediate = 0
        intermediateCount = 0
    }

    private fun enterCsi() {
        state = CSI_ENTRY
        paramCount = 1
        params[0] = -1
        paramIsSub[0] = false
        privateMarker = 0
        intermediate = 0
        intermediateCount = 0
    }

    private fun enterOsc() {
        state = OSC_STRING
        oscBuffer.setLength(0)
        lastPrinted = -1
    }

    private fun collect(cp: Int) {
        if (intermediateCount == 0) intermediate = cp
        intermediateCount++
    }

    private fun addDigit(digit: Int) {
        if (paramCount > MAX_PARAMS) return
        val index = paramCount - 1
        val current = params[index]
        params[index] = if (current < 0) digit else minOf(current * 10 + digit, MAX_PARAM_VALUE)
    }

    private fun nextParam(sub: Boolean) {
        if (paramCount >= MAX_PARAMS) {
            paramCount = MAX_PARAMS + 1
            return
        }
        params[paramCount] = -1
        paramIsSub[paramCount] = sub
        paramCount++
    }

    private fun c1(cp: Int) {
        lastPrinted = -1
        when (cp) {
            0x84 -> index()
            0x85 -> nextLine()
            0x88 -> setTabStop()
            0x8D -> reverseIndex()
            0x90, 0x98, 0x9E, 0x9F -> state = IGNORED_STRING
            0x9B -> enterCsi()
            0x9D -> enterOsc()
            C1_ST -> state = GROUND
        }
    }

    private fun execute(cp: Int) {
        if (cp != ESC) lastPrinted = -1
        when (cp) {
            BEL -> onBell?.invoke()
            0x08 -> {
                pendingWrap = false
                if (cursorCol > 0) cursorCol--
            }
            0x09 -> tab(1)
            0x0A, 0x0B, 0x0C -> {
                index()
                if (newLineMode) cursorCol = 0
            }
            0x0D -> {
                cursorCol = 0
                pendingWrap = false
            }
            0x0E -> shiftOut = true
            0x0F -> shiftOut = false
            ESC -> enterEscape()
        }
    }

    private fun dispatchEscape(final: Int) {
        lastPrinted = -1
        if (intermediateCount == 0) {
            when (final.toChar()) {
                '7' -> saveCursor()
                '8' -> restoreCursor()
                'D' -> index()
                'E' -> nextLine()
                'H' -> setTabStop()
                'M' -> reverseIndex()
                'c' -> fullReset()
                '=' -> applicationKeypad = true
                '>' -> applicationKeypad = false
            }
            return
        }
        if (intermediateCount != 1) return
        when (intermediate.toChar()) {
            '(' -> g0Graphics = final == '0'.code
            ')' -> g1Graphics = final == '0'.code
            '#' -> if (final == '8'.code) screenAlignment()
        }
    }

    private fun dispatchCsi(final: Int) {
        if (paramCount > MAX_PARAMS) paramCount = MAX_PARAMS
        val command = final.toChar()
        val repeatable = lastPrinted
        lastPrinted = -1
        if (intermediateCount == 0) {
            when (privateMarker) {
                0 -> if (command == 'b') repeatCharacter(repeatable, count(0)) else dispatchPlainCsi(command)
                '?'.code -> when (command) {
                    'h' -> for (i in 0 until paramCount) setPrivateMode(params[i], true)
                    'l' -> for (i in 0 until paramCount) setPrivateMode(params[i], false)
                    'J' -> eraseDisplay(param(0, 0))
                    'K' -> eraseLine(param(0, 0))
                    'n' -> if (param(0, 0) == 6) reportCursor(private = true)
                }
                '>'.code -> if (command == 'c' && param(0, 0) == 0) answer("\u001b[>0;276;0c")
            }
            return
        }
        if (intermediateCount != 1) return
        when (intermediate.toChar()) {
            ' ' -> if (command == 'q' && privateMarker == 0) cursorStyle = param(0, 0).coerceIn(0, 6)
            '!' -> if (command == 'p' && privateMarker == 0) softReset()
            '$' -> if (command == 'p') reportMode()
        }
    }

    private fun dispatchPlainCsi(command: Char) {
        when (command) {
            '@' -> {
                screen[cursorRow].insertCells(cursorCol, count(0), penBg)
                pendingWrap = false
            }
            'A' -> cursorUp(count(0))
            'B', 'e' -> cursorDown(count(0))
            'C', 'a' -> moveTo(cursorRow, cursorCol + count(0))
            'D' -> moveTo(cursorRow, cursorCol - count(0))
            'E' -> {
                cursorDown(count(0))
                cursorCol = 0
            }
            'F' -> {
                cursorUp(count(0))
                cursorCol = 0
            }
            'G', '`' -> moveTo(cursorRow, count(0) - 1)
            'H', 'f' -> moveToAddressed(count(0) - 1, count(1) - 1)
            'I' -> tab(count(0))
            'J' -> eraseDisplay(param(0, 0))
            'K' -> eraseLine(param(0, 0))
            'L' -> insertLines(count(0))
            'M' -> deleteLines(count(0))
            'P' -> {
                screen[cursorRow].deleteCells(cursorCol, count(0), penBg)
                pendingWrap = false
            }
            'S' -> scrollUp(scrollTop, scrollBottom, count(0))
            'T' -> if (paramCount == 1) scrollDown(scrollTop, scrollBottom, count(0))
            'X' -> {
                screen[cursorRow].clear(cursorCol, cursorCol + count(0), penBg)
                pendingWrap = false
            }
            'Z' -> backTab(count(0))
            'c' -> if (param(0, 0) == 0) answer("\u001b[?62;22c")
            'd' -> moveToAddressed(count(0) - 1, cursorCol, keepColumn = true)
            'g' -> when (param(0, 0)) {
                0 -> tabStops[cursorCol] = false
                3 -> tabStops.fill(false)
            }
            'h' -> for (i in 0 until paramCount) setAnsiMode(params[i], true)
            'l' -> for (i in 0 until paramCount) setAnsiMode(params[i], false)
            'm' -> selectGraphicRendition()
            'n' -> when (param(0, 0)) {
                5 -> answer("\u001b[0n")
                6 -> reportCursor(private = false)
            }
            'r' -> setScrollRegion(param(0, 1), param(1, rows))
            's' -> saveCursor()
            't' -> if (param(0, 0) == 18) answer("\u001b[8;$rows;${cols}t")
            'u' -> restoreCursor()
        }
    }

    private fun repeatCharacter(codePoint: Int, times: Int) {
        if (codePoint < 0) return
        repeat(minOf(times, cols * rows)) { print(codePoint) }
    }

    private fun param(index: Int, default: Int): Int =
        if (index < paramCount && params[index] >= 0) params[index] else default

    private fun count(index: Int): Int = param(index, 1).coerceAtLeast(1)

    private fun dispatchOsc() {
        val text = oscBuffer
        var command = 0
        var i = 0
        while (i < text.length && text[i] in '0'..'9' && i < 6) {
            command = command * 10 + (text[i] - '0')
            i++
        }
        if (i == 0 || i >= text.length || text[i] != ';') return
        val argument = text.substring(i + 1)
        when (command) {
            0, 2 -> title = argument
            52 -> copyToClipboard(argument)
        }
    }

    private fun copyToClipboard(argument: String) {
        val listener = onClipboardCopy ?: return
        val payload = argument.substringAfter(';', "")
        if (payload.isEmpty() || payload == "?") return
        val decoded = try {
            Base64.getDecoder().decode(payload)
        } catch (_: IllegalArgumentException) {
            return
        }
        listener(String(decoded, Charsets.UTF_8))
    }

    private fun print(codePoint: Int) {
        var cp = codePoint
        if (cp < 0x7F && cp >= 0x5F && (if (shiftOut) g1Graphics else g0Graphics)) {
            cp = LINE_DRAWING[cp - 0x5F].code
        }
        val width = if (cp < 0x300) 1 else CharWidth.of(cp)
        if (width == 0) {
            combine(cp)
            return
        }
        lastPrinted = codePoint
        if (pendingWrap) {
            pendingWrap = false
            if (autoWrap) wrapLine()
        }
        if (width == 2 && cursorCol == cols - 1) {
            if (!autoWrap || cols < 2) return
            wrapLine()
        }
        val line = screen[cursorRow]
        if (insertMode) line.insertCells(cursorCol, width, penBg)
        val style = penAttrs
        if (width == 2) {
            line.set(cursorCol, cp, penFg, penBg, style or TerminalAttribute.WIDE)
            line.set(cursorCol + 1, TerminalLine.BLANK, penFg, penBg, style or TerminalAttribute.WIDE_CONTINUATION)
        } else {
            line.set(cursorCol, cp, penFg, penBg, style)
        }
        if (cursorCol + width >= cols) {
            cursorCol = cols - 1
            pendingWrap = autoWrap
        } else {
            cursorCol += width
        }
    }

    private fun combine(cp: Int) {
        var col = if (pendingWrap) cursorCol else cursorCol - 1
        if (col < 0) return
        val line = screen[cursorRow]
        if (line.attrs[col] and TerminalAttribute.WIDE_CONTINUATION != 0) col--
        if (col >= 0) line.addCombining(col, cp)
    }

    private fun wrapLine() {
        screen[cursorRow].wrapped = true
        cursorCol = 0
        if (cursorRow == scrollBottom) {
            scrollUp(scrollTop, scrollBottom, 1)
        } else if (cursorRow < rows - 1) {
            cursorRow++
        }
    }

    private fun moveTo(row: Int, col: Int) {
        cursorRow = row.coerceIn(0, rows - 1)
        cursorCol = col.coerceIn(0, cols - 1)
        pendingWrap = false
    }

    private fun moveToAddressed(row: Int, col: Int, keepColumn: Boolean = false) {
        val target = if (originMode) (row + scrollTop).coerceIn(scrollTop, scrollBottom) else row
        moveTo(target, if (keepColumn) cursorCol else col)
    }

    private fun cursorUp(n: Int) {
        val limit = if (cursorRow >= scrollTop) scrollTop else 0
        moveTo((cursorRow - n).coerceAtLeast(limit), cursorCol)
    }

    private fun cursorDown(n: Int) {
        val limit = if (cursorRow <= scrollBottom) scrollBottom else rows - 1
        moveTo((cursorRow + n).coerceAtMost(limit), cursorCol)
    }

    private fun index() {
        pendingWrap = false
        if (cursorRow == scrollBottom) {
            scrollUp(scrollTop, scrollBottom, 1)
        } else if (cursorRow < rows - 1) {
            cursorRow++
        }
    }

    private fun reverseIndex() {
        pendingWrap = false
        if (cursorRow == scrollTop) {
            scrollDown(scrollTop, scrollBottom, 1)
        } else if (cursorRow > 0) {
            cursorRow--
        }
    }

    private fun nextLine() {
        index()
        cursorCol = 0
    }

    private fun tab(times: Int) {
        if (pendingWrap) return
        repeat(times) {
            var col = cursorCol + 1
            while (col < cols - 1 && !tabStops[col]) col++
            cursorCol = col.coerceAtMost(cols - 1)
        }
    }

    private fun backTab(times: Int) {
        pendingWrap = false
        repeat(times) {
            var col = cursorCol - 1
            while (col > 0 && !tabStops[col]) col--
            cursorCol = col.coerceAtLeast(0)
        }
    }

    private fun setTabStop() {
        tabStops[cursorCol] = true
    }

    private fun saveCursor() {
        val saved = if (alternateScreen) savedAlt else savedMain
        saved.row = cursorRow
        saved.col = cursorCol
        saved.pendingWrap = pendingWrap
        saved.fg = penFg
        saved.bg = penBg
        saved.attrs = penAttrs
        saved.g0Graphics = g0Graphics
        saved.g1Graphics = g1Graphics
        saved.shiftOut = shiftOut
        saved.originMode = originMode
    }

    private fun restoreCursor() {
        val saved = if (alternateScreen) savedAlt else savedMain
        cursorRow = saved.row.coerceIn(0, rows - 1)
        cursorCol = saved.col.coerceIn(0, cols - 1)
        pendingWrap = saved.pendingWrap
        penFg = saved.fg
        penBg = saved.bg
        penAttrs = saved.attrs
        g0Graphics = saved.g0Graphics
        g1Graphics = saved.g1Graphics
        shiftOut = saved.shiftOut
        originMode = saved.originMode
    }

    private fun reportCursor(private: Boolean) {
        val row = cursorRow - (if (originMode) scrollTop else 0) + 1
        answer("\u001b[${if (private) "?" else ""}$row;${cursorCol + 1}R")
    }

    private fun eraseDisplay(mode: Int) {
        when (mode) {
            0 -> {
                screen[cursorRow].clear(cursorCol, cols, penBg)
                for (row in cursorRow + 1 until rows) screen[row].clearAll(penBg)
            }
            1 -> {
                for (row in 0 until cursorRow) screen[row].clearAll(penBg)
                screen[cursorRow].clear(0, cursorCol + 1, penBg)
            }
            2 -> for (row in 0 until rows) screen[row].clearAll(penBg)
            3 -> clearHistory()
            else -> return
        }
        pendingWrap = false
    }

    private fun eraseLine(mode: Int) {
        val line = screen[cursorRow]
        when (mode) {
            0 -> line.clear(cursorCol, cols, penBg)
            1 -> line.clear(0, cursorCol + 1, penBg)
            2 -> line.clear(0, cols, penBg)
            else -> return
        }
        if (mode != 1) line.wrapped = false
        pendingWrap = false
    }

    private fun insertLines(n: Int) {
        if (cursorRow !in scrollTop..scrollBottom) return
        scrollDown(cursorRow, scrollBottom, n)
        cursorCol = 0
        pendingWrap = false
    }

    private fun deleteLines(n: Int) {
        if (cursorRow !in scrollTop..scrollBottom) return
        scrollLinesUp(cursorRow, scrollBottom, n, toHistory = false)
        cursorCol = 0
        pendingWrap = false
    }

    private fun scrollUp(top: Int, bottom: Int, n: Int) {
        scrollLinesUp(top, bottom, n, toHistory = !alternateScreen && top == 0 && bottom == rows - 1)
    }

    private fun scrollLinesUp(top: Int, bottom: Int, n: Int, toHistory: Boolean) {
        val height = bottom - top + 1
        repeat(n.coerceAtMost(height)) {
            val leaving = screen[top]
            val entering = if (toHistory && historyCapacity > 0) pushHistory(leaving) else leaving
            System.arraycopy(screen, top + 1, screen, top, height - 1)
            if (entering.cols != cols) entering.resize(cols)
            entering.clearAll(penBg)
            screen[bottom] = entering
        }
    }

    private fun scrollDown(top: Int, bottom: Int, n: Int) {
        val height = bottom - top + 1
        repeat(n.coerceAtMost(height)) {
            val entering = screen[bottom]
            System.arraycopy(screen, top, screen, top + 1, height - 1)
            entering.clearAll(penBg)
            screen[top] = entering
        }
    }

    private fun pushHistory(line: TerminalLine): TerminalLine {
        if (historyCapacity == 0) return TerminalLine(cols)
        if (historySize < historyCapacity) {
            history[(historyStart + historySize) % historyCapacity] = line
            historySize++
            return TerminalLine(cols)
        }
        val evicted = history[historyStart]!!
        history[historyStart] = line
        historyStart = (historyStart + 1) % historyCapacity
        return evicted
    }

    private fun popHistory(back: Int): TerminalLine {
        val slot = (historyStart + historySize - 1 - back) % historyCapacity
        val line = history[slot]!!
        history[slot] = null
        return line
    }

    private fun clearHistory() {
        history.fill(null)
        historyStart = 0
        historySize = 0
    }

    private fun setScrollRegion(top: Int, bottom: Int) {
        val first = top.coerceAtLeast(1) - 1
        val last = (if (bottom <= 0) rows else bottom.coerceAtMost(rows)) - 1
        if (first >= last) return
        scrollTop = first
        scrollBottom = last
        moveToAddressed(0, 0)
    }

    private fun screenAlignment() {
        for (line in screen) {
            line.clearAll(TerminalColor.DEFAULT)
            line.chars.fill('E'.code)
        }
        scrollTop = 0
        scrollBottom = rows - 1
        moveTo(0, 0)
    }

    private fun setAnsiMode(mode: Int, on: Boolean) {
        when (mode) {
            4 -> insertMode = on
            20 -> newLineMode = on
        }
    }

    private fun setPrivateMode(mode: Int, on: Boolean) {
        when (mode) {
            1 -> applicationCursorKeys = on
            6 -> {
                originMode = on
                moveToAddressed(0, 0)
            }
            7 -> {
                autoWrap = on
                if (!on) pendingWrap = false
            }
            9 -> setMouse(MouseTracking.X10, on)
            25 -> cursorVisible = on
            47 -> showAlternate(on, clear = false)
            1000 -> setMouse(MouseTracking.NORMAL, on)
            1002 -> setMouse(MouseTracking.BUTTON, on)
            1003 -> setMouse(MouseTracking.ANY, on)
            1004 -> focusEvents = on
            1006 -> mouseSgrEncoding = on
            1047 -> {
                if (!on && alternateScreen) for (line in altScreen) line.clearAll(TerminalColor.DEFAULT)
                showAlternate(on, clear = false)
            }
            1048 -> if (on) saveCursor() else restoreCursor()
            1049 -> if (on) {
                if (!alternateScreen) {
                    saveCursor()
                    showAlternate(true, clear = true)
                }
            } else {
                showAlternate(false, clear = false)
                restoreCursor()
            }
            2004 -> bracketedPaste = on
        }
    }

    private fun setMouse(mode: MouseTracking, on: Boolean) {
        if (on) {
            mouseTracking = mode
        } else if (mouseTracking == mode) {
            mouseTracking = MouseTracking.NONE
        }
    }

    private fun showAlternate(on: Boolean, clear: Boolean) {
        if (on != alternateScreen) {
            alternateScreen = on
            screen = if (on) altScreen else mainScreen
            pendingWrap = false
        }
        if (on && clear) for (line in altScreen) line.clearAll(penBg)
    }

    private fun reportMode() {
        if (privateMarker != '?'.code) return
        val mode = param(0, 0)
        val set: Boolean? = when (mode) {
            1 -> applicationCursorKeys
            6 -> originMode
            7 -> autoWrap
            9 -> mouseTracking == MouseTracking.X10
            25 -> cursorVisible
            47, 1047, 1049 -> alternateScreen
            1000 -> mouseTracking == MouseTracking.NORMAL
            1002 -> mouseTracking == MouseTracking.BUTTON
            1003 -> mouseTracking == MouseTracking.ANY
            1004 -> focusEvents
            1006 -> mouseSgrEncoding
            2004 -> bracketedPaste
            else -> null
        }
        val status = when (set) {
            true -> 1
            false -> 2
            null -> 0
        }
        answer("\u001b[?$mode;$status\$y")
    }

    private fun softReset() {
        cursorVisible = true
        originMode = false
        insertMode = false
        applicationCursorKeys = false
        applicationKeypad = false
        scrollTop = 0
        scrollBottom = rows - 1
        penFg = TerminalColor.DEFAULT
        penBg = TerminalColor.DEFAULT
        penAttrs = 0
        g0Graphics = false
        g1Graphics = false
        shiftOut = false
        pendingWrap = false
        savedMain.reset()
        savedAlt.reset()
    }

    private fun fullReset() {
        softReset()
        autoWrap = true
        newLineMode = false
        bracketedPaste = false
        mouseTracking = MouseTracking.NONE
        mouseSgrEncoding = false
        focusEvents = false
        cursorStyle = 0
        title = ""
        lastPrinted = -1
        alternateScreen = false
        screen = mainScreen
        for (line in mainScreen) line.clearAll(TerminalColor.DEFAULT)
        for (line in altScreen) line.clearAll(TerminalColor.DEFAULT)
        clearHistory()
        tabStops = defaultTabStops(cols)
        cursorRow = 0
        cursorCol = 0
    }

    private fun selectGraphicRendition() {
        var i = 0
        while (i < paramCount) {
            var next = i + 1
            while (next < paramCount && paramIsSub[next]) next++
            val subCount = next - i - 1
            when (val code = params[i].coerceAtLeast(0)) {
                0 -> {
                    penFg = TerminalColor.DEFAULT
                    penBg = TerminalColor.DEFAULT
                    penAttrs = 0
                }
                1 -> penAttrs = penAttrs or TerminalAttribute.BOLD
                2 -> penAttrs = penAttrs or TerminalAttribute.DIM
                3 -> penAttrs = penAttrs or TerminalAttribute.ITALIC
                4 -> penAttrs = if (subCount > 0 && params[i + 1] == 0) {
                    penAttrs and TerminalAttribute.UNDERLINE.inv()
                } else {
                    penAttrs or TerminalAttribute.UNDERLINE
                }
                5, 6 -> penAttrs = penAttrs or TerminalAttribute.BLINK
                7 -> penAttrs = penAttrs or TerminalAttribute.INVERSE
                8 -> penAttrs = penAttrs or TerminalAttribute.INVISIBLE
                9 -> penAttrs = penAttrs or TerminalAttribute.STRIKETHROUGH
                21 -> penAttrs = penAttrs or TerminalAttribute.UNDERLINE
                22 -> penAttrs = penAttrs and (TerminalAttribute.BOLD or TerminalAttribute.DIM).inv()
                23 -> penAttrs = penAttrs and TerminalAttribute.ITALIC.inv()
                24 -> penAttrs = penAttrs and TerminalAttribute.UNDERLINE.inv()
                25 -> penAttrs = penAttrs and TerminalAttribute.BLINK.inv()
                27 -> penAttrs = penAttrs and TerminalAttribute.INVERSE.inv()
                28 -> penAttrs = penAttrs and TerminalAttribute.INVISIBLE.inv()
                29 -> penAttrs = penAttrs and TerminalAttribute.STRIKETHROUGH.inv()
                in 30..37 -> penFg = TerminalColor.indexed(code - 30)
                39 -> penFg = TerminalColor.DEFAULT
                in 40..47 -> penBg = TerminalColor.indexed(code - 40)
                49 -> penBg = TerminalColor.DEFAULT
                in 90..97 -> penFg = TerminalColor.indexed(code - 90 + 8)
                in 100..107 -> penBg = TerminalColor.indexed(code - 100 + 8)
                38, 48, 58 -> {
                    val color: Int
                    if (subCount > 0) {
                        color = colonColor(i + 1, subCount)
                    } else {
                        val consumed = semicolonColorLength(i)
                        color = semicolonColor(i)
                        next = i + consumed
                    }
                    if (color != NO_COLOR) {
                        if (code == 38) penFg = color else if (code == 48) penBg = color
                    }
                }
            }
            i = next
        }
    }

    private fun colonColor(first: Int, subCount: Int): Int = when (params[first]) {
        5 -> if (subCount >= 2) TerminalColor.indexed(params[first + 1].coerceIn(0, 255)) else NO_COLOR
        2 -> when {
            subCount >= 5 -> TerminalColor.rgb(params[first + 2], params[first + 3], params[first + 4])
            subCount == 4 -> TerminalColor.rgb(params[first + 1], params[first + 2], params[first + 3])
            else -> NO_COLOR
        }
        else -> NO_COLOR
    }

    private fun semicolonColorLength(at: Int): Int = when (param(at + 1, -1)) {
        5 -> 3
        2 -> 5
        else -> 2
    }

    private fun semicolonColor(at: Int): Int = when (param(at + 1, -1)) {
        5 -> if (at + 2 < paramCount) TerminalColor.indexed(param(at + 2, 0).coerceIn(0, 255)) else NO_COLOR
        2 -> if (at + 4 < paramCount) {
            TerminalColor.rgb(param(at + 2, 0), param(at + 3, 0), param(at + 4, 0))
        } else {
            NO_COLOR
        }
        else -> NO_COLOR
    }

    private fun answer(text: String) {
        reply(text.toByteArray(Charsets.ISO_8859_1))
    }

    private class SavedCursor {
        var row = 0
        var col = 0
        var pendingWrap = false
        var fg = TerminalColor.DEFAULT
        var bg = TerminalColor.DEFAULT
        var attrs = 0
        var g0Graphics = false
        var g1Graphics = false
        var shiftOut = false
        var originMode = false

        fun reset() {
            row = 0
            col = 0
            pendingWrap = false
            fg = TerminalColor.DEFAULT
            bg = TerminalColor.DEFAULT
            attrs = 0
            g0Graphics = false
            g1Graphics = false
            shiftOut = false
            originMode = false
        }
    }

    private companion object {
        const val GROUND = 0
        const val ESCAPE = 1
        const val ESCAPE_INTERMEDIATE = 2
        const val CSI_ENTRY = 3
        const val CSI_PARAM = 4
        const val CSI_INTERMEDIATE = 5
        const val CSI_IGNORE = 6
        const val OSC_STRING = 7

        const val IGNORED_STRING = 8

        const val BEL = 0x07
        const val CAN = 0x18
        const val SUB = 0x1A
        const val ESC = 0x1B
        const val C1_ST = 0x9C
        const val REPLACEMENT = 0xFFFD

        const val MAX_PARAMS = 32
        const val MAX_PARAM_VALUE = 65535
        const val MAX_OSC_CHARS = 8192
        const val NO_COLOR = -1

        const val LINE_DRAWING =
            " ◆▒␉␌␍␊°±␤␋┘┐┌└┼" +
                "⎺⎻─⎼⎽├┤┴┬│≤≥π≠£·"

        fun newScreen(cols: Int, rows: Int): Array<TerminalLine> = Array(rows) { TerminalLine(cols) }

        fun defaultTabStops(cols: Int): BooleanArray = BooleanArray(cols) { it > 0 && it % 8 == 0 }
    }
}
