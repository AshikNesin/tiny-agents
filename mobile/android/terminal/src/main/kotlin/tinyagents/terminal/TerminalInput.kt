package tinyagents.terminal

public enum class TerminalKey {
    UP,
    DOWN,
    LEFT,
    RIGHT,
    HOME,
    END,
    PAGE_UP,
    PAGE_DOWN,
    INSERT,
    DELETE,
    F1,
    F2,
    F3,
    F4,
    F5,
    F6,
    F7,
    F8,
    F9,
    F10,
    F11,
    F12,
    ENTER,
    BACKSPACE,
    TAB,
    ESCAPE,
}

public object TerminalInput {
    private const val ESC = "\u001b"
    private const val CSI = "\u001b["
    private const val SS3 = "\u001bO"
    private const val PASTE_START = "\u001b[200~"
    private const val PASTE_END = "\u001b[201~"

    private const val WHEEL_UP = 64
    private const val WHEEL_DOWN = 65
    private const val MOTION = 32

    private const val LEGACY_MAX = 223

    public fun key(
        key: TerminalKey,
        ctrl: Boolean = false,
        alt: Boolean = false,
        shift: Boolean = false,
        applicationCursor: Boolean = false,
    ): ByteArray {
        val modifier = 1 + (if (shift) 1 else 0) + (if (alt) 2 else 0) + (if (ctrl) 4 else 0)
        val sequence = when (key) {
            TerminalKey.UP -> cursorKey('A', modifier, applicationCursor)
            TerminalKey.DOWN -> cursorKey('B', modifier, applicationCursor)
            TerminalKey.RIGHT -> cursorKey('C', modifier, applicationCursor)
            TerminalKey.LEFT -> cursorKey('D', modifier, applicationCursor)
            TerminalKey.HOME -> cursorKey('H', modifier, applicationCursor)
            TerminalKey.END -> cursorKey('F', modifier, applicationCursor)
            TerminalKey.INSERT -> tildeKey(2, modifier)
            TerminalKey.DELETE -> tildeKey(3, modifier)
            TerminalKey.PAGE_UP -> tildeKey(5, modifier)
            TerminalKey.PAGE_DOWN -> tildeKey(6, modifier)
            TerminalKey.F1 -> functionKey('P', modifier)
            TerminalKey.F2 -> functionKey('Q', modifier)
            TerminalKey.F3 -> functionKey('R', modifier)
            TerminalKey.F4 -> functionKey('S', modifier)
            TerminalKey.F5 -> tildeKey(15, modifier)
            TerminalKey.F6 -> tildeKey(17, modifier)
            TerminalKey.F7 -> tildeKey(18, modifier)
            TerminalKey.F8 -> tildeKey(19, modifier)
            TerminalKey.F9 -> tildeKey(20, modifier)
            TerminalKey.F10 -> tildeKey(21, modifier)
            TerminalKey.F11 -> tildeKey(23, modifier)
            TerminalKey.F12 -> tildeKey(24, modifier)
            TerminalKey.ENTER -> altPrefix(alt) + "\r"
            TerminalKey.BACKSPACE -> altPrefix(alt) + if (ctrl) "\b" else "\u007f"
            TerminalKey.TAB -> if (shift) "${CSI}Z" else altPrefix(alt) + "\t"
            TerminalKey.ESCAPE -> altPrefix(alt) + ESC
        }
        return sequence.toByteArray(Charsets.ISO_8859_1)
    }

    public fun text(text: String, ctrl: Boolean = false, alt: Boolean = false): ByteArray {
        if (!ctrl && !alt) return text.toByteArray(Charsets.UTF_8)
        val out = StringBuilder(text.length + 1)
        if (alt) out.append(ESC)
        for (char in text) out.append(if (ctrl) controlCode(char) else char)
        return out.toString().toByteArray(Charsets.UTF_8)
    }

    public fun paste(text: String, bracketed: Boolean): ByteArray {
        val normalized = text.replace("\r\n", "\r").replace('\n', '\r')
        if (!bracketed) return normalized.toByteArray(Charsets.UTF_8)
        return (PASTE_START + normalized.replace(PASTE_END, "") + PASTE_END).toByteArray(Charsets.UTF_8)
    }

    public fun mouseWheel(up: Boolean, col: Int, row: Int, sgr: Boolean): ByteArray =
        mouseReport(if (up) WHEEL_UP else WHEEL_DOWN, col, row, sgr, release = false)

    public fun mouseButton(
        button: Int,
        pressed: Boolean,
        col: Int,
        row: Int,
        sgr: Boolean,
        motion: Boolean = false,
    ): ByteArray {
        val code = button.coerceIn(0, 2) + if (motion) MOTION else 0
        return mouseReport(code, col, row, sgr, release = !pressed)
    }

    public fun focus(gained: Boolean): ByteArray =
        (if (gained) "${CSI}I" else "${CSI}O").toByteArray(Charsets.ISO_8859_1)

    private fun mouseReport(code: Int, col: Int, row: Int, sgr: Boolean, release: Boolean): ByteArray {
        val x = col.coerceAtLeast(0) + 1
        val y = row.coerceAtLeast(0) + 1
        if (sgr) {
            return "$CSI<$code;$x;$y${if (release) 'm' else 'M'}".toByteArray(Charsets.ISO_8859_1)
        }
        val button = if (release) 3 else code
        return byteArrayOf(
            0x1B,
            '['.code.toByte(),
            'M'.code.toByte(),
            (32 + button).toByte(),
            (32 + x.coerceAtMost(LEGACY_MAX)).toByte(),
            (32 + y.coerceAtMost(LEGACY_MAX)).toByte(),
        )
    }

    private fun cursorKey(final: Char, modifier: Int, applicationCursor: Boolean): String = when {
        modifier > 1 -> "${CSI}1;$modifier$final"
        applicationCursor -> "$SS3$final"
        else -> "$CSI$final"
    }

    private fun functionKey(final: Char, modifier: Int): String =
        if (modifier > 1) "${CSI}1;$modifier$final" else "$SS3$final"

    private fun tildeKey(number: Int, modifier: Int): String =
        if (modifier > 1) "$CSI$number;$modifier~" else "$CSI$number~"

    private fun altPrefix(alt: Boolean): String = if (alt) ESC else ""

    private fun controlCode(char: Char): Char = when (char) {
        in '@'..'_' -> (char.code and 0x1F).toChar()
        in 'a'..'z' -> (char.code and 0x1F).toChar()
        ' ' -> '\u0000'
        '?' -> '\u007f'
        else -> char
    }
}
