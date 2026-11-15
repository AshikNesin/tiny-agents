package tinyagents.terminal

/** The keys that are sent as an escape sequence or a control byte, not as text. */
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

/**
 * What a keyboard, a paste or a pointer sends to the pty, in xterm's encoding
 * (`TERM=xterm-256color`). Pure functions: the caller passes the modes it read from
 * [TerminalEmulator].
 */
public object TerminalInput {
    private const val ESC = "\u001b"
    private const val CSI = "\u001b["
    private const val SS3 = "\u001bO"
    private const val PASTE_START = "\u001b[200~"
    private const val PASTE_END = "\u001b[201~"

    /** The wheel is buttons 4 and 5, reported with bit 6 set. */
    private const val WHEEL_UP = 64
    private const val WHEEL_DOWN = 65
    private const val MOTION = 32

    /** The largest coordinate the legacy `ESC [ M` encoding can carry in one byte. */
    private const val LEGACY_MAX = 223

    /**
     * A non-text key. Arrows, Home and End follow DECCKM ([applicationCursor]) when unmodified;
     * with a modifier every key takes xterm's `CSI 1 ; m X` / `CSI n ; m ~` form, where `m` is
     * 1 + shift(1) + alt(2) + ctrl(4).
     */
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

    /**
     * Typed text. With [ctrl], `@ A-Z [ \ ] ^ _`, lowercase letters, space and `?` become their
     * control codes (`^?` is DEL) and anything else is sent as it is; [alt] prefixes ESC.
     */
    public fun text(text: String, ctrl: Boolean = false, alt: Boolean = false): ByteArray {
        if (!ctrl && !alt) return text.toByteArray(Charsets.UTF_8)
        val out = StringBuilder(text.length + 1)
        if (alt) out.append(ESC)
        for (char in text) out.append(if (ctrl) controlCode(char) else char)
        return out.toString().toByteArray(Charsets.UTF_8)
    }

    /**
     * Pasted text: newlines become CR, and with [bracketed] (the application set `?2004`) the
     * text is wrapped in `ESC [200~` / `ESC [201~`. An end marker inside the text is dropped,
     * so a paste cannot close its own bracket and run what follows.
     */
    public fun paste(text: String, bracketed: Boolean): ByteArray {
        val normalized = text.replace("\r\n", "\r").replace('\n', '\r')
        if (!bracketed) return normalized.toByteArray(Charsets.UTF_8)
        return (PASTE_START + normalized.replace(PASTE_END, "") + PASTE_END).toByteArray(Charsets.UTF_8)
    }

    /** One wheel notch over the cell at 0-based [col], [row]. */
    public fun mouseWheel(up: Boolean, col: Int, row: Int, sgr: Boolean): ByteArray =
        mouseReport(if (up) WHEEL_UP else WHEEL_DOWN, col, row, sgr, release = false)

    /**
     * A button press or release over the cell at 0-based [col], [row]. [button] is 0 left,
     * 1 middle, 2 right; [motion] marks a drag report (modes 1002 and 1003).
     */
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

    /** What `?1004` asks for when the terminal gains or loses focus. */
    public fun focus(gained: Boolean): ByteArray =
        (if (gained) "${CSI}I" else "${CSI}O").toByteArray(Charsets.ISO_8859_1)

    private fun mouseReport(code: Int, col: Int, row: Int, sgr: Boolean, release: Boolean): ByteArray {
        val x = col.coerceAtLeast(0) + 1
        val y = row.coerceAtLeast(0) + 1
        if (sgr) {
            return "$CSI<$code;$x;$y${if (release) 'm' else 'M'}".toByteArray(Charsets.ISO_8859_1)
        }
        // Legacy encoding: a release does not say which button, and each value is one byte.
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
