package tinyagents.terminal

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.isSpecified
import androidx.compose.ui.unit.sp
import kotlin.math.abs
import kotlinx.coroutines.delay

@Stable
public class TerminalViewState {
    public var scrollOffset: Int by mutableIntStateOf(0)
        private set

    private var knownScrollback: Int = 0

    public fun scrollToBottom() {
        scrollOffset = 0
    }

    internal fun scrollBy(lines: Int, scrollback: Int) {
        scrollOffset = (scrollOffset + lines).coerceIn(0, scrollback)
    }

    internal fun follow(scrollback: Int) {
        val current = scrollOffset
        val grown = scrollback - knownScrollback
        knownScrollback = scrollback
        val next = (if (current > 0 && grown > 0) current + grown else current).coerceIn(0, scrollback)
        if (next != current) scrollOffset = next
    }
}

@Composable
public fun rememberTerminalViewState(): TerminalViewState = remember { TerminalViewState() }

@Composable
public fun TerminalView(
    emulator: TerminalEmulator,
    version: Long,
    modifier: Modifier = Modifier,
    fontSize: TextUnit,
    colors: TerminalColors,
    onInput: (ByteArray) -> Unit,
    onSizeChanged: (cols: Int, rows: Int) -> Unit,
    onTap: () -> Unit = {},
    state: TerminalViewState = rememberTerminalViewState(),
) {
    val density = LocalDensity.current
    val textSize = with(density) { (if (fontSize.isSpecified) fontSize else DEFAULT_FONT_SIZE_SP.sp).toPx() }
    val renderer = remember(textSize, colors) { TerminalRenderer(textSize, colors) }

    var viewSize by remember { mutableStateOf(IntSize.Zero) }
    val grid = remember(viewSize, renderer) { renderer.gridFor(viewSize.width, viewSize.height) }
    val currentOnSizeChanged by rememberUpdatedState(onSizeChanged)
    LaunchedEffect(grid) {
        if (viewSize == IntSize.Zero) return@LaunchedEffect
        delay(RESIZE_DEBOUNCE_MILLIS)
        currentOnSizeChanged(grid.width, grid.height)
    }

    val currentVersion by rememberUpdatedState(version)
    state.follow(emulator.scrollbackSize)

    val currentEmulator by rememberUpdatedState(emulator)
    val currentRenderer by rememberUpdatedState(renderer)
    val currentOnInput by rememberUpdatedState(onInput)
    val currentOnTap by rememberUpdatedState(onTap)

    Canvas(
        modifier
            .clipToBounds()
            .onSizeChanged { viewSize = it }
            .pointerInput(state) {
                detectTapGestures { position ->
                    currentOnTap()
                    val target = currentEmulator
                    val tracking = target.mouseTracking
                    if (tracking != MouseTracking.NONE) {
                        val col = currentRenderer.columnAt(position.x, target.cols)
                        val row = currentRenderer.rowAt(position.y, target.rows)
                        val sgr = target.mouseSgrEncoding
                        currentOnInput(TerminalInput.mouseButton(0, pressed = true, col = col, row = row, sgr = sgr))
                        if (tracking != MouseTracking.X10) {
                            currentOnInput(TerminalInput.mouseButton(0, pressed = false, col = col, row = row, sgr = sgr))
                        }
                    }
                }
            }
            .pointerInput(state) {
                var pending = 0f
                detectVerticalDragGestures(
                    onDragStart = { pending = 0f },
                ) { change, dragAmount ->
                    change.consume()
                    pending += dragAmount
                    val target = currentEmulator
                    val wheel = target.mouseTracking != MouseTracking.NONE && target.mouseTracking != MouseTracking.X10
                    val step = currentRenderer.cellHeight * (if (wheel) ROWS_PER_WHEEL_NOTCH else 1)
                    val steps = (pending / step).toInt()
                    if (steps != 0) {
                        pending -= steps * step
                        scroll(target, currentRenderer, state, steps, change.position, currentOnInput)
                    }
                }
            },
    ) {
        @Suppress("UNUSED_VARIABLE")
        val drawnVersion = currentVersion
        val offset = state.scrollOffset
        drawIntoCanvas { canvas ->
            renderer.draw(canvas.nativeCanvas, emulator, offset, size.width, size.height)
        }
    }
}

private fun scroll(
    emulator: TerminalEmulator,
    renderer: TerminalRenderer,
    state: TerminalViewState,
    steps: Int,
    position: Offset,
    onInput: (ByteArray) -> Unit,
) {
    val tracking = emulator.mouseTracking
    val back = steps > 0
    when {
        tracking != MouseTracking.NONE && tracking != MouseTracking.X10 -> {
            val col = renderer.columnAt(position.x, emulator.cols)
            val row = renderer.rowAt(position.y, emulator.rows)
            val report = TerminalInput.mouseWheel(up = back, col = col, row = row, sgr = emulator.mouseSgrEncoding)
            repeat(abs(steps)) { onInput(report) }
        }
        emulator.alternateScreen -> {
            val key = TerminalInput.key(
                if (back) TerminalKey.UP else TerminalKey.DOWN,
                applicationCursor = emulator.applicationCursorKeys,
            )
            repeat(abs(steps)) { onInput(key) }
        }
        else -> state.scrollBy(steps, emulator.scrollbackSize)
    }
}

private const val DEFAULT_FONT_SIZE_SP = 14
private const val RESIZE_DEBOUNCE_MILLIS = 100L

private const val ROWS_PER_WHEEL_NOTCH = 2
