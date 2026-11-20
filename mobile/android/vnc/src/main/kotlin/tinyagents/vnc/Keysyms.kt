package tinyagents.vnc

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

    public const val None: Int = 0

    private const val UNICODE_BASE = 0x01000000

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

    public fun fromAndroidKeyCode(keyCode: Int): Int? = when (keyCode) {
        KEYCODE_DPAD_UP -> Up
        KEYCODE_DPAD_DOWN -> Down
        KEYCODE_DPAD_LEFT -> Left
        KEYCODE_DPAD_RIGHT -> Right
        KEYCODE_ALT_LEFT -> Alt_L
        KEYCODE_ALT_RIGHT -> Alt_R
        KEYCODE_SHIFT_LEFT -> Shift_L
        KEYCODE_SHIFT_RIGHT -> Shift_R
        KEYCODE_TAB -> Tab
        KEYCODE_SPACE -> Space
        KEYCODE_ENTER, KEYCODE_NUMPAD_ENTER -> Return
        KEYCODE_DEL -> BackSpace
        KEYCODE_PAGE_UP -> PageUp
        KEYCODE_PAGE_DOWN -> PageDown
        KEYCODE_ESCAPE -> Escape
        KEYCODE_FORWARD_DEL -> Delete
        KEYCODE_CTRL_LEFT -> Control_L
        KEYCODE_CTRL_RIGHT -> Control_R
        KEYCODE_CAPS_LOCK -> Caps_Lock
        KEYCODE_META_LEFT -> Super_L
        KEYCODE_META_RIGHT -> Super_R
        KEYCODE_MOVE_HOME -> Home
        KEYCODE_MOVE_END -> End
        KEYCODE_INSERT -> Insert
        in KEYCODE_F1..KEYCODE_F12 -> F1 + (keyCode - KEYCODE_F1)
        else -> null
    }

    private const val KEYCODE_DPAD_UP = 19
    private const val KEYCODE_DPAD_DOWN = 20
    private const val KEYCODE_DPAD_LEFT = 21
    private const val KEYCODE_DPAD_RIGHT = 22
    private const val KEYCODE_ALT_LEFT = 57
    private const val KEYCODE_ALT_RIGHT = 58
    private const val KEYCODE_SHIFT_LEFT = 59
    private const val KEYCODE_SHIFT_RIGHT = 60
    private const val KEYCODE_TAB = 61
    private const val KEYCODE_SPACE = 62
    private const val KEYCODE_ENTER = 66
    private const val KEYCODE_NUMPAD_ENTER = 160
    private const val KEYCODE_DEL = 67
    private const val KEYCODE_PAGE_UP = 92
    private const val KEYCODE_PAGE_DOWN = 93
    private const val KEYCODE_ESCAPE = 111
    private const val KEYCODE_FORWARD_DEL = 112
    private const val KEYCODE_CTRL_LEFT = 113
    private const val KEYCODE_CTRL_RIGHT = 114
    private const val KEYCODE_CAPS_LOCK = 115
    private const val KEYCODE_META_LEFT = 117
    private const val KEYCODE_META_RIGHT = 118
    private const val KEYCODE_MOVE_HOME = 122
    private const val KEYCODE_MOVE_END = 123
    private const val KEYCODE_INSERT = 124
    private const val KEYCODE_F1 = 131
    private const val KEYCODE_F12 = 142
}
