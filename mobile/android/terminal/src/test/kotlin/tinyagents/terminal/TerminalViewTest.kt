package tinyagents.terminal

import androidx.compose.foundation.layout.size
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipe
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(AndroidJUnit4::class)
@Config(qualifiers = "w412dp-h900dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class TerminalViewTest {
    @get:Rule
    val compose = createComposeRule()

    private val colors = TerminalColors.dark()
    private val sizes = mutableListOf<Pair<Int, Int>>()
    private val input = mutableListOf<String>()
    private var taps = 0
    private val state = TerminalViewState()

    private fun show(emulator: TerminalEmulator, width: Int = 400, height: Int = 300) {
        var version by mutableLongStateOf(emulator.version)
        compose.setContent {
            TerminalView(
                emulator = emulator,
                version = version,
                modifier = Modifier.size(width.dp, height.dp).testTag("terminal"),
                fontSize = 14.sp,
                colors = colors,
                onInput = { input += it.toString(Charsets.ISO_8859_1) },
                onSizeChanged = { cols, rows -> sizes += cols to rows },
                onTap = { taps++ },
                state = state,
            )
        }
        settle()
        refresh = { version = emulator.version }
    }

    private var refresh: () -> Unit = {}

    /** Let a size change lay out, then let the debounce run out. */
    private fun settle() {
        compose.waitForIdle()
        compose.mainClock.advanceTimeBy(500)
        compose.waitForIdle()
    }

    private fun colourful(): TerminalEmulator {
        val emulator = TerminalEmulator(40, 12) {}
        emulator.feed(
            (
                "${CSI}41m    ${CSI}0m plain ${CSI}1;32mbold green${CSI}0m ${CSI}3;4mitalic underline${CSI}0m\r\n" +
                    "${CSI}38;2;255;128;0;48;5;21mtruecolor${CSI}0m ${CSI}7minverse${CSI}0m ${CSI}2mdim${CSI}0m ${CSI}9mstrike${CSI}0m\r\n" +
                    "wide 日本語 😀 é ┌─┬─┐ │ ▁▂▃▄▅▆▇█ ░▒▓\r\n" +
                    "${CSI}8minvisible${CSI}0m ${CSI}5 qbar cursor"
                ).toByteArray(),
        )
        return emulator
    }

    @Test
    fun `renders coloured content and reports the grid that fits`() {
        show(colourful())
        assertEquals("one report once the size settled", 1, sizes.size)
        val (cols, rows) = sizes.single()
        // 400x300 px at 14 px text: about 8.4 px per column and 16-17 px per row.
        assertTrue("cols=$cols", cols in 35..60)
        assertTrue("rows=$rows", rows in 14..22)

        val bitmap = compose.onNodeWithTag("terminal").captureToImage().asAndroidBitmap()
        assertEquals(400, bitmap.width)
        val cellWidth = 400f / cols
        val background = colors.background.toArgb()
        assertEquals("an untouched corner is the default background", background, bitmap.getPixel(398, 298))
        assertEquals("the first cells have a red background", colors.ansi[1].toArgb(), bitmap.getPixel((cellWidth * 2).toInt(), 6))
        var inked = 0
        for (x in (cellWidth * 5).toInt() until (cellWidth * 36).toInt()) {
            for (y in 0 until 14) if (bitmap.getPixel(x, y) != background) inked++
        }
        assertTrue("text was drawn on the first row ($inked pixels)", inked > 60)
    }

    @Test
    fun `the grid follows the view size and font and never drops below 2x2`() {
        val emulator = TerminalEmulator(10, 4) {}
        var size by mutableStateOf(200)
        var font by mutableStateOf(14)
        compose.setContent {
            TerminalView(
                emulator = emulator,
                version = 0,
                modifier = Modifier.size(size.dp, size.dp),
                fontSize = font.sp,
                colors = colors,
                onInput = {},
                onSizeChanged = { cols, rows -> sizes += cols to rows },
            )
        }
        settle()
        assertEquals(1, sizes.size)
        val first = sizes.last()

        size = 400
        settle()
        assertEquals(2, sizes.size)
        assertTrue("twice the view, about twice the grid", sizes.last().first >= first.first * 2 - 1)
        assertTrue(sizes.last().second >= first.second * 2 - 1)

        font = 28
        settle()
        assertEquals(3, sizes.size)
        // Hinted advances are whole pixels (8 px at 14 px text, 17 px at 28 px), so "twice the
        // font" is not exactly half the columns: allow a tenth either way.
        val slack = maxOf(1, first.first / 10)
        assertTrue("twice the font, about the first grid again: $sizes", sizes.last().first in first.first - slack..first.first + slack)
        assertTrue("and about the first rows: $sizes", sizes.last().second in first.second - slack..first.second + slack)

        size = 4
        settle()
        assertEquals(2 to 2, sizes.last())

        settle()
        settle()
        assertEquals("nothing is reported while nothing changes", 4, sizes.size)
    }

    @Test
    fun `new output is redrawn when the version changes`() {
        val emulator = TerminalEmulator(40, 12) {}
        show(emulator)
        val before = compose.onNodeWithTag("terminal").captureToImage().asAndroidBitmap()
        val probeX = 20
        val probeY = 40
        assertEquals(colors.background.toArgb(), before.getPixel(probeX, probeY))
        emulator.feed("${CSI}3;1H${CSI}44m          ".toByteArray())
        refresh()
        compose.waitForIdle()
        val after = compose.onNodeWithTag("terminal").captureToImage().asAndroidBitmap()
        assertEquals(colors.ansi[4].toArgb(), after.getPixel(probeX, probeY))
    }

    @Test
    fun `a tap asks for the keyboard and sends nothing without mouse tracking`() {
        show(colourful())
        compose.onNodeWithTag("terminal").performTouchInput { click(Offset(50f, 50f)) }
        compose.waitForIdle()
        assertEquals(1, taps)
        assertEquals(emptyList<String>(), input)
    }

    @Test
    fun `with mouse tracking a tap also clicks the cell`() {
        val emulator = colourful()
        emulator.feed("${CSI}?1000h${CSI}?1006h".toByteArray())
        show(emulator)
        val (cols, rows) = sizes.single()
        val cellWidth = 400f / cols
        val cellHeight = 300f / rows
        compose.onNodeWithTag("terminal").performTouchInput { click(Offset(cellWidth * 3.5f, cellHeight * 2.5f)) }
        compose.waitForIdle()
        assertEquals(1, taps)
        assertEquals(listOf("$CSI<0;4;3M", "$CSI<0;4;3m"), input)
    }

    @Test
    fun `a drag scrolls the local scrollback on the main screen and input snaps back`() {
        val emulator = TerminalEmulator(40, 12) {}
        emulator.feed((1..100).joinToString("\r\n") { "line $it" }.toByteArray())
        show(emulator)
        assertEquals(0, state.scrollOffset)
        val before = compose.onNodeWithTag("terminal").captureToImage().asAndroidBitmap()

        compose.onNodeWithTag("terminal").performTouchInput { swipe(Offset(100f, 60f), Offset(100f, 240f), durationMillis = 200) }
        compose.waitForIdle()
        assertTrue("scrolled back ${state.scrollOffset} lines", state.scrollOffset in 5..12)
        assertEquals(emptyList<String>(), input)
        val scrolled = compose.onNodeWithTag("terminal").captureToImage().asAndroidBitmap()
        assertNotEquals("the drawing moved", pixels(before), pixels(scrolled))

        // New output keeps the same lines in view.
        val held = state.scrollOffset
        emulator.feed("\r\nmore\r\nand more".toByteArray())
        refresh()
        compose.waitForIdle()
        assertEquals(held + 2, state.scrollOffset)

        compose.onNodeWithTag("terminal").performTouchInput { swipe(Offset(100f, 240f), Offset(100f, 200f), durationMillis = 100) }
        compose.waitForIdle()
        assertTrue("dragging up scrolls forward again", state.scrollOffset < held + 2)

        state.scrollToBottom()
        compose.waitForIdle()
        assertEquals(0, state.scrollOffset)
        compose.onNodeWithTag("terminal").performTouchInput { swipe(Offset(100f, 240f), Offset(100f, 60f), durationMillis = 200) }
        compose.waitForIdle()
        assertEquals("cannot scroll below the live screen", 0, state.scrollOffset)
    }

    @Test
    fun `with mouse tracking a drag becomes wheel reports`() {
        val emulator = colourful()
        emulator.feed("${CSI}?1049h${CSI}?1000h${CSI}?1002h${CSI}?1006h".toByteArray())
        show(emulator)
        compose.onNodeWithTag("terminal").performTouchInput { swipe(Offset(100f, 60f), Offset(100f, 240f), durationMillis = 200) }
        compose.waitForIdle()
        assertTrue("wheel up reports: $input", input.size in 2..8)
        assertTrue(input.all { it.startsWith("$CSI<64;") && it.endsWith("M") })
        assertEquals(0, state.scrollOffset)
        input.clear()
        compose.onNodeWithTag("terminal").performTouchInput { swipe(Offset(100f, 240f), Offset(100f, 60f), durationMillis = 200) }
        compose.waitForIdle()
        assertTrue(input.isNotEmpty() && input.all { it.startsWith("$CSI<65;") })
        assertEquals("a drag is not a tap", 0, taps)
    }

    @Test
    fun `on an alternate screen without mouse tracking a drag becomes arrow keys`() {
        val emulator = colourful()
        emulator.feed("${CSI}?1049h".toByteArray())
        show(emulator)
        compose.onNodeWithTag("terminal").performTouchInput { swipe(Offset(100f, 60f), Offset(100f, 240f), durationMillis = 200) }
        compose.waitForIdle()
        assertTrue("arrow up keys: $input", input.size in 5..12)
        assertTrue(input.all { it == "${CSI}A" })
        input.clear()
        emulator.feed("${CSI}?1h".toByteArray())
        refresh()
        compose.onNodeWithTag("terminal").performTouchInput { swipe(Offset(100f, 240f), Offset(100f, 60f), durationMillis = 200) }
        compose.waitForIdle()
        assertTrue(input.isNotEmpty() && input.all { it == "${ESC}OB" })
    }

    @Test
    fun `a screen larger or smaller than the view and a scrolled wide grid draw without crashing`() {
        val big = TerminalEmulator(200, 80) {}
        big.feed(("x".repeat(200) + "\r\n").repeat(100).toByteArray())
        big.feed("${CSI}80;200H".toByteArray())
        show(big, width = 120, height = 60)
        compose.onNodeWithTag("terminal").captureToImage()
        big.resize(3, 2)
        refresh()
        compose.waitForIdle()
        compose.onNodeWithTag("terminal").captureToImage()
        // Scrollback lines narrower and wider than the screen.
        big.resize(50, 5)
        big.feed((1..30).joinToString("\r\n") { "漢字 $it" }.toByteArray())
        big.resize(20, 5)
        refresh()
        compose.onNodeWithTag("terminal").performTouchInput { swipe(Offset(30f, 5f), Offset(30f, 55f), durationMillis = 100) }
        compose.waitForIdle()
        compose.onNodeWithTag("terminal").captureToImage()
    }

    @Test
    fun `palettes are built from the 16 colours and the computed xterm cube`() {
        for (palette in listOf(TerminalColors.dark(), TerminalColors.light())) {
            assertEquals(16, palette.ansi.size)
            assertEquals(palette.ansi[3], palette.indexed(3))
            assertEquals(0xFF000000.toInt(), palette.indexed(16).toArgb())
            assertEquals(0xFFFFFFFF.toInt(), palette.indexed(231).toArgb())
            assertEquals(0xFFFF0000.toInt(), palette.indexed(196).toArgb())
            assertEquals(0xFF5F87AF.toInt(), palette.indexed(67).toArgb())
            assertEquals(0xFF080808.toInt(), palette.indexed(232).toArgb())
            assertEquals(0xFFEEEEEE.toInt(), palette.indexed(255).toArgb())
            assertEquals(palette.foreground, palette.cursor)
            assertNotEquals(palette.foreground, palette.background)
            assertTrue(palette.selection.alpha < 1f)
        }
        assertNotEquals(TerminalColors.dark(), TerminalColors.light())
    }

    private fun pixels(bitmap: android.graphics.Bitmap): List<Int> {
        val out = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(out, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        return out.asList()
    }
}
