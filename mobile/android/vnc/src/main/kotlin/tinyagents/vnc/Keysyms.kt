package tinyagents.vnc

/** X11 keysyms, the key identifiers an RFB KeyEvent carries. */
public object Keysyms {
    public const val BackSpace: Int = 0xff08
    public const val Tab: Int = 0xff09
    public const val Return: Int = 0xff0d
    public const val Escape: Int = 0xff1b
    public const val Insert: Int = 0xff63
    public const val Delete: Int = 0xffff
    public const val Home: Int = 0xff50
    public const val Left: Int = 0xff51
    public const val Up: Int = 0xff52
    public const val Right: Int = 0xff53
    public const val Down: Int = 0xff54
    public const val PageUp: Int = 0xff55
    public const val PageDown: Int = 0xff56
    public const val End: Int = 0xff57
    public const val F1: Int = 0xffbe
    public const val F2: Int = 0xffbf
    public const val F3: Int = 0xffc0
    public const val F4: Int = 0xffc1
    public const val F5: Int = 0xffc2
    public const val F6: Int = 0xffc3
    public const val F7: Int = 0xffc4
    public const val F8: Int = 0xffc5
    public const val F9: Int = 0xffc6
    public const val F10: Int = 0xffc7
    public const val F11: Int = 0xffc8
    public const val F12: Int = 0xffc9
    public const val Shift_L: Int = 0xffe1
    public const val Shift_R: Int = 0xffe2
    public const val Control_L: Int = 0xffe3
    public const val Control_R: Int = 0xffe4
    public const val Caps_Lock: Int = 0xffe5
    public const val Alt_L: Int = 0xffe9
    public const val Alt_R: Int = 0xffea
    public const val Super_L: Int = 0xffeb
    public const val Super_R: Int = 0xffec
    public const val Space: Int = 0x20

    /** "No keysym": what [fromChar] returns for a character that has none. */
    public const val None: Int = 0

    private const val UNICODE_BASE = 0x01000000

    /**
     * The keysym that types the Unicode [codePoint]. Printable Latin-1 maps to itself, other
     * Unicode to `0x01000000 + codePoint`, and newline, tab, backspace, escape and delete to their
     * function keys. Returns [None] for other control characters and invalid code points.
     */
    public fun fromChar(codePoint: Int): Int = when (codePoint) {
        '\n'.code, '\r'.code -> Return
        '\t'.code -> Tab
        '\b'.code -> BackSpace
        0x1b -> Escape
        0x7f -> Delete
        in 0x20..0x7e, in 0xa0..0xff -> codePoint
        in 0x100..0x10ffff -> if (codePoint in 0xd800..0xdfff) None else UNICODE_BASE + codePoint
        else -> None
    }

    /**
     * The keysym for a non-printing `android.view.KeyEvent` key code (navigation, editing,
     * function and modifier keys), or null when the key types a character (map that with
     * [fromChar]) or has no X11 equivalent. Key codes are the raw Android constants, so this
     * object stays free of Android imports.
     */
    public fun fromAndroidKeyCode(keyCode: Int): Int? = when (keyCode) {
        19 -> Up // KEYCODE_DPAD_UP
        20 -> Down // KEYCODE_DPAD_DOWN
        21 -> Left // KEYCODE_DPAD_LEFT
        22 -> Right // KEYCODE_DPAD_RIGHT
        57 -> Alt_L // KEYCODE_ALT_LEFT
        58 -> Alt_R // KEYCODE_ALT_RIGHT
        59 -> Shift_L // KEYCODE_SHIFT_LEFT
        60 -> Shift_R // KEYCODE_SHIFT_RIGHT
        61 -> Tab // KEYCODE_TAB
        62 -> Space // KEYCODE_SPACE
        66, 160 -> Return // KEYCODE_ENTER, KEYCODE_NUMPAD_ENTER
        67 -> BackSpace // KEYCODE_DEL
        92 -> PageUp // KEYCODE_PAGE_UP
        93 -> PageDown // KEYCODE_PAGE_DOWN
        111 -> Escape // KEYCODE_ESCAPE
        112 -> Delete // KEYCODE_FORWARD_DEL
        113 -> Control_L // KEYCODE_CTRL_LEFT
        114 -> Control_R // KEYCODE_CTRL_RIGHT
        115 -> Caps_Lock // KEYCODE_CAPS_LOCK
        117 -> Super_L // KEYCODE_META_LEFT
        118 -> Super_R // KEYCODE_META_RIGHT
        122 -> Home // KEYCODE_MOVE_HOME
        123 -> End // KEYCODE_MOVE_END
        124 -> Insert // KEYCODE_INSERT
        in 131..142 -> F1 + (keyCode - 131) // KEYCODE_F1..KEYCODE_F12
        else -> null
    }
}
