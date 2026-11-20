package tinyagents.terminal

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.IntSize
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max

internal class TerminalRenderer(textSize: Float, colors: TerminalColors) {
    private val palette: IntArray = colors.paletteArgb()
    private val defaultForeground: Int = colors.foreground.toArgb()
    private val defaultBackground: Int = colors.background.toArgb()
    private val cursorColor: Int = colors.cursor.toArgb()

    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = Typeface.MONOSPACE
        this.textSize = textSize
        fontFeatureSettings = "'liga' 0, 'clig' 0, 'calt' 0"
    }
    private val boldPaint = Paint(textPaint).apply { typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD) }
    private val fillPaint = Paint().apply {
        style = Paint.Style.FILL
        isAntiAlias = false
    }

    val cellWidth: Float

    val cellHeight: Float

    private val baseline: Float
    private val lineThickness: Float
    private val underlineOffset: Float
    private val strikeOffset: Float

    private val uniformAscii: Boolean

    private var run = CharArray(INITIAL_RUN_CAPACITY)
    private val single = CharArray(SINGLE_CAPACITY)

    init {
        val measured = textPaint.measureText("M")
        cellWidth = if (measured > 0f) measured else textSize * FALLBACK_ASPECT
        val metrics = textPaint.fontMetrics
        val height = ceil(metrics.descent - metrics.ascent)
        cellHeight = if (height > 0f) height else ceil(textSize * FALLBACK_LINE_HEIGHT)
        baseline = if (height > 0f) -metrics.ascent else textSize
        lineThickness = max(1f, floor(textSize / LINE_THICKNESS_DIVISOR))
        underlineOffset = baseline + max(1f, (cellHeight - baseline) * UNDERLINE_POSITION)
        strikeOffset = baseline - textSize * STRIKE_POSITION
        uniformAscii = abs(textPaint.measureText(NARROW_SAMPLE) - textPaint.measureText(WIDE_SAMPLE)) < ADVANCE_TOLERANCE
        if (abs(boldPaint.measureText("M") - cellWidth) > ADVANCE_TOLERANCE) {
            boldPaint.typeface = Typeface.MONOSPACE
            boldPaint.isFakeBoldText = true
        }
    }

    fun gridFor(width: Int, height: Int): IntSize = IntSize(
        max(MIN_GRID, floor(width / cellWidth).toInt()),
        max(MIN_GRID, floor(height / cellHeight).toInt()),
    )

    fun columnAt(x: Float, cols: Int): Int = floor(x / cellWidth).toInt().coerceIn(0, cols - 1)

    fun rowAt(y: Float, rows: Int): Int = floor(y / cellHeight).toInt().coerceIn(0, rows - 1)

    fun draw(canvas: Canvas, emulator: TerminalEmulator, scrollOffset: Int, width: Float, height: Float) {
        fillPaint.color = defaultBackground
        canvas.drawRect(0f, 0f, width, height, fillPaint)

        val rows = emulator.rows
        val cols = emulator.cols
        if (run.size < cols) run = CharArray(cols)
        val offset = scrollOffset.coerceIn(0, emulator.scrollbackSize)
        for (row in 0 until rows) {
            val top = row * cellHeight
            if (top >= height) break
            val line = emulator.line(row - offset)
            val count = if (line.cols < cols) line.cols else cols
            drawBackgrounds(canvas, line, count, top)
            drawText(canvas, line, count, top)
        }

        val cursorRow = emulator.cursorRow + offset
        if (emulator.cursorVisible && cursorRow < rows) {
            drawCursor(canvas, emulator.line(emulator.cursorRow), emulator.cursorCol, cursorRow * cellHeight, emulator.cursorStyle)
        }
    }

    private fun drawBackgrounds(canvas: Canvas, line: TerminalLine, count: Int, top: Float) {
        var start = 0
        var current = defaultBackground
        for (col in 0..count) {
            val color = if (col < count) backgroundOf(line, col) else defaultBackground
            if (color != current || col == count) {
                if (current != defaultBackground && col > start) {
                    fillPaint.color = current
                    canvas.drawRect(start * cellWidth, top, col * cellWidth, top + cellHeight, fillPaint)
                }
                start = col
                current = color
            }
        }
    }

    private fun drawText(canvas: Canvas, line: TerminalLine, count: Int, top: Float) {
        val chars = line.chars
        val attrs = line.attrs
        val extras = line.extras
        var runStart = 0
        var runLength = 0
        var runColor = 0
        var runStyle = 0
        for (col in 0 until count) {
            val bits = attrs[col]
            val codePoint = chars[col]
            val style = bits and RUN_STYLE_MASK
            if (bits and (TerminalAttribute.INVISIBLE or TerminalAttribute.WIDE_CONTINUATION) != 0) {
                if (runLength > 0) {
                    flushRun(canvas, runStart, runLength, top, runColor, runStyle)
                    runLength = 0
                }
                continue
            }
            if (codePoint == TerminalLine.BLANK && style and DECORATION_MASK == 0 && extras?.get(col) == null) {
                if (runLength > 0) {
                    if (style == runStyle && foregroundOf(line, col) == runColor) {
                        run[runLength++] = ' '
                    } else {
                        flushRun(canvas, runStart, runLength, top, runColor, runStyle)
                        runLength = 0
                    }
                }
                continue
            }
            val color = foregroundOf(line, col)
            val plain = uniformAscii && codePoint < ASCII_LIMIT && extras?.get(col) == null
            if (plain && runLength > 0 && style == runStyle && color == runColor) {
                run[runLength++] = codePoint.toChar()
                continue
            }
            if (runLength > 0) {
                flushRun(canvas, runStart, runLength, top, runColor, runStyle)
                runLength = 0
            }
            if (plain) {
                runStart = col
                runColor = color
                runStyle = style
                run[0] = codePoint.toChar()
                runLength = 1
            } else {
                drawCell(canvas, col, codePoint, extras?.get(col), bits, top, color, style)
            }
        }
        if (runLength > 0) flushRun(canvas, runStart, runLength, top, runColor, runStyle)
    }

    private fun flushRun(canvas: Canvas, start: Int, length: Int, top: Float, color: Int, style: Int) {
        if (style and DECORATION_MASK != 0) {
            canvas.drawText(run, 0, length, start * cellWidth, top + baseline, paintFor(color, style))
            drawDecorations(canvas, start, length, top, color, style)
            return
        }
        var visible = length
        while (visible > 0 && run[visible - 1] == ' ') visible--
        if (visible > 0) canvas.drawText(run, 0, visible, start * cellWidth, top + baseline, paintFor(color, style))
    }

    private fun drawCell(canvas: Canvas, col: Int, codePoint: Int, extra: String?, bits: Int, top: Float, color: Int, style: Int) {
        val cells = if (bits and TerminalAttribute.WIDE != 0) 2 else 1
        val left = col * cellWidth
        if (extra == null && codePoint in BOX_FIRST..BLOCK_LAST && drawGeometry(canvas, codePoint, left, top, color)) {
            if (style and DECORATION_MASK != 0) drawDecorations(canvas, col, cells, top, color, style)
            return
        }
        var length = Character.toChars(codePoint, single, 0)
        if (extra != null) {
            val extraLength = if (extra.length < single.size - length) extra.length else single.size - length
            extra.toCharArray(single, length, 0, extraLength)
            length += extraLength
        }
        canvas.drawText(single, 0, length, left, top + baseline, paintFor(color, style))
        if (style and DECORATION_MASK != 0) drawDecorations(canvas, col, cells, top, color, style)
    }

    private fun drawDecorations(canvas: Canvas, col: Int, cells: Int, top: Float, color: Int, style: Int) {
        fillPaint.color = color
        val left = col * cellWidth
        val right = (col + cells) * cellWidth
        if (style and TerminalAttribute.UNDERLINE != 0) {
            canvas.drawRect(left, top + underlineOffset, right, top + underlineOffset + lineThickness, fillPaint)
        }
        if (style and TerminalAttribute.STRIKETHROUGH != 0) {
            canvas.drawRect(left, top + strikeOffset, right, top + strikeOffset + lineThickness, fillPaint)
        }
    }

    private fun drawCursor(canvas: Canvas, line: TerminalLine, cursorCol: Int, top: Float, style: Int) {
        var col = cursorCol
        if (col >= line.cols) return
        if (col > 0 && line.attrs[col] and TerminalAttribute.WIDE_CONTINUATION != 0) col--
        val cells = if (line.attrs[col] and TerminalAttribute.WIDE != 0) 2 else 1
        val left = col * cellWidth
        val right = left + cells * cellWidth
        fillPaint.color = cursorColor
        when (style) {
            CURSOR_UNDERLINE_BLINK, CURSOR_UNDERLINE -> {
                val thickness = max(lineThickness * 2, floor(cellHeight / CURSOR_THICKNESS_DIVISOR))
                canvas.drawRect(left, top + cellHeight - thickness, right, top + cellHeight, fillPaint)
            }
            CURSOR_BAR_BLINK, CURSOR_BAR -> {
                val thickness = max(lineThickness * 2, floor(cellWidth / CURSOR_THICKNESS_DIVISOR))
                canvas.drawRect(left, top, left + thickness, top + cellHeight, fillPaint)
            }
            else -> {
                canvas.drawRect(left, top, right, top + cellHeight, fillPaint)
                val bits = line.attrs[col]
                val codePoint = line.chars[col]
                if (codePoint != TerminalLine.BLANK && bits and TerminalAttribute.INVISIBLE == 0) {
                    drawCell(canvas, col, codePoint, line.extras?.get(col), bits, top, defaultBackground, bits and RUN_STYLE_MASK)
                }
            }
        }
    }

    private fun paintFor(color: Int, style: Int): Paint {
        val paint = if (style and TerminalAttribute.BOLD != 0) boldPaint else textPaint
        paint.color = color
        paint.textSkewX = if (style and TerminalAttribute.ITALIC != 0) ITALIC_SKEW else 0f
        return paint
    }

    private fun backgroundOf(line: TerminalLine, col: Int): Int =
        if (line.attrs[col] and TerminalAttribute.INVERSE != 0) {
            resolve(line.fg[col], defaultForeground)
        } else {
            resolve(line.bg[col], defaultBackground)
        }

    private fun foregroundOf(line: TerminalLine, col: Int): Int {
        val bits = line.attrs[col]
        val color = if (bits and TerminalAttribute.INVERSE != 0) {
            resolve(line.bg[col], defaultBackground)
        } else {
            resolve(line.fg[col], defaultForeground)
        }
        return if (bits and TerminalAttribute.DIM != 0) (color and RGB_MASK) or DIM_ALPHA else color
    }

    private fun resolve(color: Int, default: Int): Int = when {
        TerminalColor.isDefault(color) -> default
        TerminalColor.isIndexed(color) -> palette[TerminalColor.index(color)]
        else -> OPAQUE or TerminalColor.rgbValue(color)
    }

    private fun drawGeometry(canvas: Canvas, codePoint: Int, left: Float, top: Float, color: Int): Boolean {
        val right = left + cellWidth
        val bottom = top + cellHeight
        fillPaint.color = color
        if (codePoint <= BOX_LAST) {
            val arms = boxArms(codePoint)
            if (arms == 0) return false
            val heavy = codePoint in HEAVY_HORIZONTAL..HEAVY_VERTICAL && codePoint != LIGHT_VERTICAL
            val stroke = if (heavy) lineThickness * 2 else lineThickness
            val centerX = floor(left + (cellWidth - stroke) / 2)
            val centerY = floor(top + (cellHeight - stroke) / 2)
            if (arms and ARM_LEFT != 0) canvas.drawRect(left, centerY, centerX + stroke, centerY + stroke, fillPaint)
            if (arms and ARM_RIGHT != 0) canvas.drawRect(centerX, centerY, right, centerY + stroke, fillPaint)
            if (arms and ARM_UP != 0) canvas.drawRect(centerX, top, centerX + stroke, centerY + stroke, fillPaint)
            if (arms and ARM_DOWN != 0) canvas.drawRect(centerX, centerY, centerX + stroke, bottom, fillPaint)
            return true
        }
        when (codePoint) {
            UPPER_HALF_BLOCK -> canvas.drawRect(left, top, right, top + cellHeight / 2, fillPaint)
            in LOWER_EIGHTH_BLOCK..FULL_BLOCK -> {
                val eighths = codePoint - LOWER_EIGHTH_BLOCK + 1
                canvas.drawRect(left, bottom - cellHeight * eighths / EIGHTHS, right, bottom, fillPaint)
            }
            in LEFT_SEVEN_EIGHTHS_BLOCK..LEFT_EIGHTH_BLOCK -> {
                val eighths = LEFT_EIGHTH_BLOCK - codePoint + 1
                canvas.drawRect(left, top, left + cellWidth * eighths / EIGHTHS, bottom, fillPaint)
            }
            RIGHT_HALF_BLOCK -> canvas.drawRect(left + cellWidth / 2, top, right, bottom, fillPaint)
            in LIGHT_SHADE..DARK_SHADE -> {
                val quarter = codePoint - LIGHT_SHADE + 1
                fillPaint.color = (color and RGB_MASK) or ((QUARTER_ALPHA * quarter) shl ALPHA_SHIFT)
                canvas.drawRect(left, top, right, bottom, fillPaint)
            }
            UPPER_EIGHTH_BLOCK -> canvas.drawRect(left, top, right, top + cellHeight / EIGHTHS, fillPaint)
            RIGHT_EIGHTH_BLOCK -> canvas.drawRect(right - cellWidth / EIGHTHS, top, right, bottom, fillPaint)
            else -> return false
        }
        return true
    }

    private fun boxArms(codePoint: Int): Int = when (codePoint) {
        in 0x2500..0x2501, 0x2504, 0x2505, 0x2508, 0x2509, 0x254C, 0x254D, 0x2550, 0x257C, 0x257E -> ARM_LEFT or ARM_RIGHT
        in 0x2502..0x2503, 0x2506, 0x2507, 0x250A, 0x250B, 0x254E, 0x254F, 0x2551, 0x257D, 0x257F -> ARM_UP or ARM_DOWN
        in 0x250C..0x250F, in 0x2552..0x2554, 0x256D -> ARM_RIGHT or ARM_DOWN
        in 0x2510..0x2513, in 0x2555..0x2557, 0x256E -> ARM_LEFT or ARM_DOWN
        in 0x2514..0x2517, in 0x2558..0x255A, 0x2570 -> ARM_RIGHT or ARM_UP
        in 0x2518..0x251B, in 0x255B..0x255D, 0x256F -> ARM_LEFT or ARM_UP
        in 0x251C..0x2523, in 0x255E..0x2560 -> ARM_UP or ARM_DOWN or ARM_RIGHT
        in 0x2524..0x252B, in 0x2561..0x2563 -> ARM_UP or ARM_DOWN or ARM_LEFT
        in 0x252C..0x2533, in 0x2564..0x2566 -> ARM_LEFT or ARM_RIGHT or ARM_DOWN
        in 0x2534..0x253B, in 0x2567..0x2569 -> ARM_LEFT or ARM_RIGHT or ARM_UP
        in 0x253C..0x254B, in 0x256A..0x256C -> ARM_LEFT or ARM_RIGHT or ARM_UP or ARM_DOWN
        0x2574, 0x2578 -> ARM_LEFT
        0x2575, 0x2579 -> ARM_UP
        0x2576, 0x257A -> ARM_RIGHT
        0x2577, 0x257B -> ARM_DOWN
        else -> 0
    }

    private companion object {
        const val MIN_GRID = 2
        const val INITIAL_RUN_CAPACITY = 256

        const val SINGLE_CAPACITY = 2 + TerminalLine.MAX_COMBINING_CHARS
        const val ASCII_LIMIT = 0x7F
        const val ADVANCE_TOLERANCE = 0.01f
        const val NARROW_SAMPLE = "iiiiiiiiii"
        const val WIDE_SAMPLE = "MMMMMMMMMM"

        const val FALLBACK_ASPECT = 0.6f
        const val FALLBACK_LINE_HEIGHT = 1.2f

        const val ITALIC_SKEW = -0.2f
        const val LINE_THICKNESS_DIVISOR = 14f
        const val UNDERLINE_POSITION = 0.35f
        const val STRIKE_POSITION = 0.3f
        const val CURSOR_THICKNESS_DIVISOR = 8f

        const val ALPHA_SHIFT = 24
        const val OPAQUE = 0xFF shl ALPHA_SHIFT
        const val RGB_MASK = 0xFFFFFF
        const val DIM_ALPHA = 0x99 shl ALPHA_SHIFT
        const val QUARTER_ALPHA = 0x40

        const val RUN_STYLE_MASK =
            TerminalAttribute.BOLD or TerminalAttribute.ITALIC or TerminalAttribute.UNDERLINE or TerminalAttribute.STRIKETHROUGH
        const val DECORATION_MASK = TerminalAttribute.UNDERLINE or TerminalAttribute.STRIKETHROUGH

        const val CURSOR_UNDERLINE_BLINK = 3
        const val CURSOR_UNDERLINE = 4
        const val CURSOR_BAR_BLINK = 5
        const val CURSOR_BAR = 6

        const val ARM_LEFT = 1
        const val ARM_RIGHT = 2
        const val ARM_UP = 4
        const val ARM_DOWN = 8

        const val BOX_FIRST = 0x2500
        const val BOX_LAST = 0x257F
        const val BLOCK_LAST = 0x2595
        const val HEAVY_HORIZONTAL = 0x2501
        const val LIGHT_VERTICAL = 0x2502
        const val HEAVY_VERTICAL = 0x2503
        const val UPPER_HALF_BLOCK = 0x2580
        const val LOWER_EIGHTH_BLOCK = 0x2581
        const val FULL_BLOCK = 0x2588
        const val LEFT_SEVEN_EIGHTHS_BLOCK = 0x2589
        const val LEFT_EIGHTH_BLOCK = 0x258F
        const val RIGHT_HALF_BLOCK = 0x2590
        const val LIGHT_SHADE = 0x2591
        const val DARK_SHADE = 0x2593
        const val UPPER_EIGHTH_BLOCK = 0x2594
        const val RIGHT_EIGHTH_BLOCK = 0x2595
        const val EIGHTHS = 8
    }
}
