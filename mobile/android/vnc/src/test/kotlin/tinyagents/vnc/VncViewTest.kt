package tinyagents.vnc

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalViewConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.pinch
import androidx.compose.ui.test.swipe
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.GraphicsMode
import tinyagents.vnc.FakeRfbServer.Companion.rawRect
import kotlin.math.abs
import kotlin.math.floor

/** [VncView] driven by real touch and key input, checked by the bytes the client sends. */
@OptIn(ExperimentalTestApi::class, ExperimentalComposeUiApi::class)
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class VncViewTest {
    @get:Rule
    val compose = createComposeRule()

    private val state = VncViewState()
    private val servers = mutableListOf<FakeRfbServer>()
    private var interactive by mutableStateOf(true)
    private var viewSize by mutableStateOf(IntSize(400, 300))
    private val reportedSizes = mutableListOf<IntSize>()
    private var reportSizes by mutableStateOf(false)
    private val focus = FocusRequester()
    private var slop = 0f
    private var background = Color.Unspecified

    private val view get() = compose.onNodeWithTag("vnc")

    private fun connect(width: Int = 800, height: Int = 600): FakeRfbServer {
        val server = FakeRfbServer(factory = { input, output, listener -> state.createClient(input, output, listener) })
        servers += server
        server.start().handshake(width, height)
        return server
    }

    /** An 800x600 remote in a 400x300 px view: one view pixel is two remote pixels. */
    private fun show(width: Int = 800, height: Int = 600): FakeRfbServer {
        val server = connect(width, height)
        compose.setContent {
            MaterialTheme {
                slop = LocalViewConfiguration.current.touchSlop
                background = MaterialTheme.colorScheme.surfaceContainerLowest
                val size = with(LocalDensity.current) { Modifier.requiredSize(viewSize.width.toDp(), viewSize.height.toDp()) }
                Box {
                    VncView(
                        state = state,
                        interactive = interactive,
                        modifier = size.testTag("vnc").focusRequester(focus),
                        onViewSize = if (reportSizes) { w, h -> reportedSizes += IntSize(w, h) } else null,
                    )
                }
            }
        }
        compose.waitForIdle()
        return server
    }

    private fun sent(server: FakeRfbServer, block: () -> Unit): List<String> {
        val before = server.writes.size
        block()
        compose.waitForIdle()
        return server.writes.drop(before).map { describe(it) }
    }

    private fun describe(message: ByteArray): String {
        fun u16(at: Int) = ((message[at].toInt() and 0xFF) shl 8) or (message[at + 1].toInt() and 0xFF)
        return when (message[0].toInt()) {
            5 -> "pointer ${u16(2)},${u16(4)} buttons ${message[1].toInt() and 0xFF}"
            4 -> "key ${"%x".format((u16(4) shl 16) or u16(6))} ${if (message[1].toInt() == 1) "down" else "up"}"
            else -> message.hex()
        }
    }

    private fun click(x: Int, y: Int, buttons: Int) =
        listOf("pointer $x,$y buttons 0", "pointer $x,$y buttons $buttons", "pointer $x,$y buttons 0")

    private fun twoFingerDrag(server: FakeRfbServer, delta: Offset, steps: Int = 10) = sent(server) {
        view.performTouchInput {
            down(0, Offset(150f, 150f))
            down(1, Offset(250f, 150f))
            repeat(steps) {
                updatePointerBy(0, delta)
                updatePointerBy(1, delta)
                move()
            }
            up(0)
            up(1)
        }
    }

    private fun pinchOut() {
        view.performTouchInput {
            pinch(Offset(150f, 150f), Offset(100f, 150f), Offset(250f, 150f), Offset(300f, 150f), durationMillis = 300)
        }
        compose.waitForIdle()
    }

    @After
    fun close() {
        servers.forEach { it.client.close() }
    }

    // Touch

    @Test
    fun `a tap is a left click at the remote point`() {
        val server = show()
        assertEquals(click(200, 100, 1), sent(server) { view.performTouchInput { click(Offset(100f, 50f)) } })
        assertEquals(click(799, 599, 1), sent(server) { view.performTouchInput { click(Offset(399.9f, 299.9f)) } })
    }

    @Test
    fun `a double tap is two clicks on the same remote pixel`() {
        val server = show()
        val messages = sent(server) {
            view.performTouchInput {
                click(Offset(100f, 50f))
                advanceEventTime(60)
                click(Offset(104f, 53f))
            }
        }
        assertEquals(click(200, 100, 1) + click(200, 100, 1), messages)
        // A later tap nearby is its own click.
        val later = sent(server) {
            view.performTouchInput {
                advanceEventTime(2000)
                click(Offset(104f, 53f))
            }
        }
        assertEquals(click(208, 106, 1), later)
    }

    @Test
    fun `a long press is a right click`() {
        val server = show()
        assertEquals(click(200, 100, 4), sent(server) { view.performTouchInput { longClick(Offset(100f, 50f)) } })
    }

    @Test
    fun `a one-finger drag holds the left button from where the finger landed to where it lifts`() {
        val server = show()
        val messages = sent(server) { view.performTouchInput { swipe(Offset(100f, 50f), Offset(300f, 250f), durationMillis = 200) } }
        assertEquals(listOf("pointer 200,100 buttons 0", "pointer 200,100 buttons 1"), messages.take(2))
        assertEquals(listOf("pointer 600,500 buttons 1", "pointer 600,500 buttons 0"), messages.takeLast(2))
        val moves = messages.drop(2).dropLast(1)
        assertTrue("several moves in between: $messages", moves.size >= 5)
        assertTrue("the button stays down: $messages", moves.all { it.endsWith("buttons 1") })
        val xs = moves.map { it.substringAfter("pointer ").substringBefore(",").toInt() }
        assertEquals("the moves follow the finger", xs.sorted(), xs)
    }

    @Test
    fun `a drag that leaves the view stops at the remote edge`() {
        val server = show()
        val messages = sent(server) { view.performTouchInput { swipe(Offset(300f, 50f), Offset(460f, -40f), durationMillis = 200) } }
        assertEquals("pointer 799,0 buttons 0", messages.last())
        assertEquals("pointer 600,100 buttons 1", messages[1])
    }

    @Test
    fun `a second finger ends a drag by releasing the button`() {
        val server = show()
        val messages = sent(server) {
            view.performTouchInput {
                down(0, Offset(100f, 50f))
                moveBy(0, Offset(40f, 0f))
                moveBy(0, Offset(40f, 0f))
                down(1, Offset(300f, 200f))
                up(0)
                up(1)
            }
        }
        assertEquals(
            listOf(
                "pointer 200,100 buttons 0", "pointer 200,100 buttons 1",
                "pointer 280,100 buttons 1", "pointer 360,100 buttons 1", "pointer 360,100 buttons 0",
            ),
            messages,
        )
    }

    @Test
    fun `a two-finger drag turns the wheel the way touch scrolling moves content`() {
        val server = show()
        val steps = floor(100 / (2 * slop)).toInt()
        assertTrue("the gesture is long enough for several wheel steps", steps >= 2)
        fun wheel(button: Int) = List(steps) { listOf("pointer 400,300 buttons $button", "pointer 400,300 buttons 0") }.flatten()
        // Fingers up: content moves up, which is the wheel down. And so on.
        assertEquals(wheel(16), twoFingerDrag(server, Offset(0f, -10f)))
        assertEquals(wheel(8), twoFingerDrag(server, Offset(0f, 10f)))
        assertEquals(wheel(64), twoFingerDrag(server, Offset(-10f, 0f)))
        assertEquals(wheel(32), twoFingerDrag(server, Offset(10f, 0f)))
        assertEquals("scrolling does not zoom", 1f, state.zoom)
    }

    @Test
    fun `a diagonal two-finger drag scrolls along its main axis only`() {
        val server = show()
        val messages = twoFingerDrag(server, Offset(3f, -10f))
        assertTrue(messages.isNotEmpty())
        assertTrue("$messages", messages.all { it == "pointer 400,300 buttons 16" || it == "pointer 400,300 buttons 0" })
    }

    @Test
    fun `a pinch zooms locally and sends nothing`() {
        val server = show()
        val messages = sent(server) { pinchOut() }
        assertEquals(emptyList<String>(), messages)
        // The fingers went from 100 to 200 px apart; the first slop of that decides the gesture.
        assertTrue("zoom was ${state.zoom}", state.zoom in 1.5f..2f)
        assertEquals("the centre stays put", IntOffset(400, 300), state.toRemote(Offset(200f, 150f)))

        // Taps now land on the zoomed remote point: (100,50) is 100 and 100 px from the centre.
        val scale = 0.5f * state.zoom
        val clicked = sent(server) { view.performTouchInput { click(Offset(100f, 50f)) } }
        val (x, y) = clicked.first().substringAfter("pointer ").substringBefore(" ").split(",").map { it.toInt() }
        assertTrue("clicked $clicked", abs(x - (400 - 100 / scale)) <= 1f && abs(y - (300 - 100 / scale)) <= 1f)
        assertEquals(3, clicked.size)

        // Pinching far out stops at 4x, pinching in at 1x.
        repeat(4) { pinchOut() }
        assertEquals(4f, state.zoom)
        repeat(6) {
            view.performTouchInput {
                pinch(Offset(100f, 150f), Offset(180f, 150f), Offset(300f, 150f), Offset(220f, 150f), durationMillis = 300)
            }
        }
        compose.waitForIdle()
        assertEquals(1f, state.zoom)
        assertEquals(Offset.Zero, state.pan)
    }

    @Test
    fun `while zoomed a two-finger drag pans instead of scrolling`() {
        val server = show()
        pinchOut()
        val zoom = state.zoom
        val messages = twoFingerDrag(server, Offset(4f, 0f))
        assertEquals(emptyList<String>(), messages)
        assertEquals(zoom, state.zoom)
        assertTrue("pan was ${state.pan}", state.pan.x in 20f..40f && state.pan.y == 0f)
        // One finger still drags remotely while zoomed.
        val drag = sent(server) { view.performTouchInput { swipe(Offset(200f, 150f), Offset(260f, 150f), durationMillis = 100) } }
        assertTrue(drag.size > 3 && drag[1].endsWith("buttons 1") && drag.last().endsWith("buttons 0"))
    }

    @Test
    fun `touches outside the remote screen send nothing`() {
        // A 800x300 remote in the 400x300 view is 400x150, with 75 px bars above and below.
        val server = show(800, 300)
        val messages = sent(server) {
            view.performTouchInput {
                click(Offset(100f, 30f))
                longClick(Offset(100f, 280f))
                swipe(Offset(100f, 30f), Offset(300f, 150f), durationMillis = 100)
            }
        }
        assertEquals(emptyList<String>(), messages)
        assertEquals(click(200, 0, 1), sent(server) { view.performTouchInput { click(Offset(100f, 75f)) } })
    }

    @Test
    fun `when not interactive nothing is sent, and zoom and pan still work`() {
        val server = show()
        interactive = false
        compose.waitForIdle()
        val messages = sent(server) {
            view.performTouchInput {
                click(Offset(100f, 50f))
                longClick(Offset(100f, 50f))
                swipe(Offset(100f, 50f), Offset(300f, 250f), durationMillis = 100)
            }
            twoFingerDrag(server, Offset(0f, -10f))
            pinchOut()
        }
        assertEquals(emptyList<String>(), messages)
        assertTrue("zoom was ${state.zoom}", state.zoom > 1.5f)

        // One finger pans the zoomed view.
        view.performTouchInput { swipe(Offset(200f, 150f), Offset(240f, 170f), durationMillis = 100) }
        compose.waitForIdle()
        assertTrue("pan was ${state.pan}", state.pan.x in 20f..40f && state.pan.y in 5f..20f)
        assertEquals(emptyList<String>(), sent(server) { twoFingerDrag(server, Offset(4f, 0f)) })

        interactive = true
        compose.waitForIdle()
        assertEquals(3, sent(server) { view.performTouchInput { click(Offset(100f, 50f)) } }.size)
    }

    @Test
    fun `touches before a connection send nothing and do not crash`() {
        compose.setContent { MaterialTheme { VncView(state, interactive = true, modifier = Modifier.testTag("vnc")) } }
        view.performTouchInput {
            click()
            swipe(Offset(10f, 10f), Offset(60f, 60f))
        }
        compose.waitForIdle()
        assertEquals(1f, state.zoom)
    }

    // Keys

    @Test
    fun `hardware keys are sent while the view has focus and is interactive`() {
        val server = show()
        compose.runOnIdle { focus.requestFocus() }
        val messages = sent(server) {
            view.performKeyInput {
                keyDown(Key.A)
                keyUp(Key.A)
                keyDown(Key.Enter)
                keyUp(Key.Enter)
            }
        }
        assertEquals(listOf("key 61 down", "key 61 up", "key ff0d down", "key ff0d up"), messages)

        interactive = false
        compose.waitForIdle()
        assertEquals(emptyList<String>(), sent(server) { view.performKeyInput { keyDown(Key.B); keyUp(Key.B) } })
    }

    // View size

    @Test
    fun `onViewSize reports the size once it has settled, and again for a new client`() {
        reportSizes = true
        compose.mainClock.autoAdvance = false
        show()
        compose.mainClock.advanceTimeBy(100)
        assertEquals("not before the debounce", emptyList<IntSize>(), reportedSizes)
        compose.mainClock.advanceTimeBy(200)
        assertEquals(listOf(IntSize(400, 300)), reportedSizes)
        assertEquals(IntSize(400, 300), state.viewSize)

        // Two quick changes are one report, of the last size.
        viewSize = IntSize(300, 200)
        compose.waitForIdle()
        compose.mainClock.advanceTimeBy(100)
        viewSize = IntSize(200, 100)
        compose.waitForIdle()
        compose.mainClock.advanceTimeBy(100)
        assertEquals(listOf(IntSize(400, 300)), reportedSizes)
        compose.mainClock.advanceTimeBy(200)
        assertEquals(listOf(IntSize(400, 300), IntSize(200, 100)), reportedSizes)

        // Nothing changes, nothing is reported.
        compose.mainClock.advanceTimeBy(1000)
        assertEquals(2, reportedSizes.size)

        // A reconnect gets the size again, so the app can ask the new server for it.
        connect()
        compose.waitForIdle()
        compose.mainClock.advanceTimeBy(400)
        assertEquals(listOf(IntSize(400, 300), IntSize(200, 100), IntSize(200, 100)), reportedSizes)
    }

    // Drawing

    @Test
    fun `draws the remote screen scaled to fit and centred on the background`() {
        // A 4x2 remote in the 400x300 view: drawn 400x200 with 50 px bars above and below.
        val server = show(4, 2)
        val colours = intArrayOf(
            opaque(0xFF0000), opaque(0x00FF00), opaque(0x0000FF), opaque(0xFFFFFF),
            opaque(0x336699), opaque(0x000000), opaque(0xFFFF00), opaque(0x00FFFF),
        )
        server.update(rawRect(0, 0, 4, 2, colours))
        server.expectUpdateRequest(incremental = true, 4, 2)
        compose.waitForIdle()
        val drawn = view.captureToImage().toPixelMap()
        assertEquals(400, drawn.width)
        assertEquals(300, drawn.height)
        // The centre of each remote pixel: 100 px wide and tall, starting at y = 50.
        for (row in 0 until 2) {
            for (column in 0 until 4) {
                val expected = colours[row * 4 + column]
                assertColour("remote pixel $column,$row", expected, drawn[column * 100 + 50, 50 + row * 100 + 50].toArgb())
            }
        }
        assertEquals(background.toArgb(), drawn[200, 20].toArgb())
        assertEquals(background.toArgb(), drawn[200, 280].toArgb())

        // A new frame is drawn without anything else changing.
        server.update(rawRect(0, 0, 1, 1, intArrayOf(opaque(0x123456))))
        server.expectUpdateRequest(incremental = true, 4, 2)
        compose.waitForIdle()
        assertColour("the changed pixel", opaque(0x123456), view.captureToImage().toPixelMap()[50, 100].toArgb())
    }

    /** Scaling filters blend a little of the neighbouring pixels in, so channels may be slightly off. */
    private fun assertColour(what: String, expected: Int, actual: Int) {
        val close = (0..24 step 8).all { shift -> abs(((expected shr shift) and 0xFF) - ((actual shr shift) and 0xFF)) <= 8 }
        assertTrue("$what: expected %08x but was %08x".format(expected, actual), close)
    }
}
