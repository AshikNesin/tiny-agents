package tinyagents.terminal

public object TerminalColor {
    public const val DEFAULT: Int = 0

    private const val INDEXED_TAG: Int = 0x01000000
    private const val RGB_TAG: Int = 0x02000000
    private const val TAG_MASK: Int = 0x03000000

    public fun indexed(index: Int): Int = INDEXED_TAG or (index and 0xFF)

    public fun rgb(red: Int, green: Int, blue: Int): Int =
        RGB_TAG or (red.coerceIn(0, 255) shl 16) or (green.coerceIn(0, 255) shl 8) or blue.coerceIn(0, 255)

    public fun isDefault(color: Int): Boolean = color and TAG_MASK == 0

    public fun isIndexed(color: Int): Boolean = color and TAG_MASK == INDEXED_TAG

    public fun isRgb(color: Int): Boolean = color and TAG_MASK == RGB_TAG

    public fun index(color: Int): Int = color and 0xFF

    public fun rgbValue(color: Int): Int = color and 0xFFFFFF
}

public object TerminalAttribute {
    public const val BOLD: Int = 1
    public const val DIM: Int = 1 shl 1
    public const val ITALIC: Int = 1 shl 2
    public const val UNDERLINE: Int = 1 shl 3

    public const val BLINK: Int = 1 shl 4
    public const val INVERSE: Int = 1 shl 5
    public const val INVISIBLE: Int = 1 shl 6
    public const val STRIKETHROUGH: Int = 1 shl 7

    public const val WIDE: Int = 1 shl 8

    public const val WIDE_CONTINUATION: Int = 1 shl 9

    internal const val STYLE_MASK: Int =
        BOLD or DIM or ITALIC or UNDERLINE or BLINK or INVERSE or INVISIBLE or STRIKETHROUGH
    internal const val WIDTH_MASK: Int = WIDE or WIDE_CONTINUATION
}

public class TerminalLine internal constructor(cols: Int) {
    public var cols: Int = cols
        private set

    public var wrapped: Boolean = false
        internal set

    internal var chars: IntArray = IntArray(cols) { BLANK }
    internal var fg: IntArray = IntArray(cols)
    internal var bg: IntArray = IntArray(cols)
    internal var attrs: IntArray = IntArray(cols)

    internal var extras: Array<String?>? = null

    public fun codePoint(col: Int): Int = if (col in 0 until cols) chars[col] else BLANK

    public fun combining(col: Int): String? = if (col in 0 until cols) extras?.get(col) else null

    public fun width(col: Int): Int {
        if (col !in 0 until cols) return 1
        val bits = attrs[col]
        return when {
            bits and TerminalAttribute.WIDE != 0 -> 2
            bits and TerminalAttribute.WIDE_CONTINUATION != 0 -> 0
            else -> 1
        }
    }

    public fun foreground(col: Int): Int = if (col in 0 until cols) fg[col] else TerminalColor.DEFAULT

    public fun background(col: Int): Int = if (col in 0 until cols) bg[col] else TerminalColor.DEFAULT

    public fun attributes(col: Int): Int = if (col in 0 until cols) attrs[col] else 0

    public fun text(): String {
        var end = cols
        while (end > 0 && chars[end - 1] == BLANK && extras?.get(end - 1) == null) end--
        val out = StringBuilder(end)
        for (col in 0 until end) {
            if (attrs[col] and TerminalAttribute.WIDE_CONTINUATION != 0) continue
            out.appendCodePoint(chars[col])
            extras?.get(col)?.let(out::append)
        }
        return out.toString()
    }

    override fun toString(): String = text()

    internal fun isBlank(): Boolean {
        for (col in 0 until cols) {
            if (chars[col] != BLANK || bg[col] != TerminalColor.DEFAULT || attrs[col] != 0) return false
        }
        return true
    }

    internal fun set(col: Int, codePoint: Int, foreground: Int, background: Int, attributes: Int) {
        splitWideAt(col)
        chars[col] = codePoint
        fg[col] = foreground
        bg[col] = background
        attrs[col] = attributes
        extras?.set(col, null)
    }

    internal fun clear(from: Int, to: Int, background: Int) {
        val start = from.coerceAtLeast(0)
        val end = to.coerceAtMost(cols)
        if (start >= end) return
        if (attrs[start] and TerminalAttribute.WIDE_CONTINUATION != 0) blankOrphan(start - 1)
        if (end < cols && attrs[end] and TerminalAttribute.WIDE_CONTINUATION != 0) blankOrphan(end)
        chars.fill(BLANK, start, end)
        fg.fill(TerminalColor.DEFAULT, start, end)
        bg.fill(background, start, end)
        attrs.fill(0, start, end)
        extras?.fill(null, start, end)
    }

    internal fun clearAll(background: Int) {
        clear(0, cols, background)
        wrapped = false
    }

    internal fun insertCells(col: Int, count: Int, background: Int) {
        if (col !in 0 until cols) return
        val n = count.coerceAtMost(cols - col)
        if (n <= 0) return
        if (attrs[col] and TerminalAttribute.WIDE_CONTINUATION != 0) {
            blankOrphan(col - 1)
            blankOrphan(col)
        }
        shift(col, col + n, cols - col - n)
        clearRange(col, col + n, background)
        if (attrs[cols - 1] and TerminalAttribute.WIDE != 0) blankOrphan(cols - 1)
    }

    internal fun deleteCells(col: Int, count: Int, background: Int) {
        if (col !in 0 until cols) return
        val n = count.coerceAtMost(cols - col)
        if (n <= 0) return
        if (attrs[col] and TerminalAttribute.WIDE_CONTINUATION != 0) blankOrphan(col - 1)
        if (col + n < cols && attrs[col + n] and TerminalAttribute.WIDE_CONTINUATION != 0) {
            blankOrphan(col + n)
        }
        shift(col + n, col, cols - col - n)
        clearRange(cols - n, cols, background)
    }

    internal fun addCombining(col: Int, codePoint: Int) {
        val store = extras ?: arrayOfNulls<String>(cols).also { extras = it }
        val current = store[col]
        if (current != null && current.length >= MAX_COMBINING_CHARS) return
        val mark = String(Character.toChars(codePoint))
        store[col] = if (current == null) mark else current + mark
    }

    internal fun resize(newCols: Int) {
        if (newCols == cols) return
        val oldCols = cols
        chars = chars.copyOf(newCols)
        fg = fg.copyOf(newCols)
        bg = bg.copyOf(newCols)
        attrs = attrs.copyOf(newCols)
        extras = extras?.copyOf(newCols)
        cols = newCols
        if (newCols > oldCols) {
            chars.fill(BLANK, oldCols, newCols)
        } else if (attrs[newCols - 1] and TerminalAttribute.WIDE != 0) {
            blankOrphan(newCols - 1)
        }
    }

    private fun splitWideAt(col: Int) {
        val bits = attrs[col]
        if (bits and TerminalAttribute.WIDTH_MASK == 0) return
        if (bits and TerminalAttribute.WIDE_CONTINUATION != 0) {
            if (col > 0) blankOrphan(col - 1)
        } else if (col + 1 < cols) {
            blankOrphan(col + 1)
        }
    }

    private fun blankOrphan(col: Int) {
        if (col !in 0 until cols) return
        chars[col] = BLANK
        fg[col] = TerminalColor.DEFAULT
        bg[col] = TerminalColor.DEFAULT
        attrs[col] = 0
        extras?.set(col, null)
    }

    private fun shift(from: Int, to: Int, length: Int) {
        if (length <= 0) return
        System.arraycopy(chars, from, chars, to, length)
        System.arraycopy(fg, from, fg, to, length)
        System.arraycopy(bg, from, bg, to, length)
        System.arraycopy(attrs, from, attrs, to, length)
        extras?.let { System.arraycopy(it, from, it, to, length) }
    }

    private fun clearRange(from: Int, to: Int, background: Int) {
        chars.fill(BLANK, from, to)
        fg.fill(TerminalColor.DEFAULT, from, to)
        bg.fill(background, from, to)
        attrs.fill(0, from, to)
        extras?.fill(null, from, to)
    }

    internal companion object {
        const val BLANK: Int = 0x20
        const val MAX_COMBINING_CHARS: Int = 16
    }
}
