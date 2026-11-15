package tinyagents.vnc

import android.graphics.Bitmap
import android.os.Looper
import android.view.KeyEvent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import tinyagents.vnc.FakeRfbServer.Companion.extendedDesktopSize
import tinyagents.vnc.FakeRfbServer.Companion.rawRect
import androidx.compose.ui.input.key.KeyEvent as ComposeKeyEvent

/** [VncViewState]: the bitmap mirror, keyboard helpers and the view-to-remote mapping. */
@RunWith(AndroidJUnit4::class)
class VncViewStateTest {
    private val state = VncViewState()
    private val servers = mutableListOf<FakeRfbServer>()

    private fun connect(width: Int, height: Int): FakeRfbServer {
        val server = FakeRfbServer(factory = { input, output, listener -> state.createClient(input, output, listener) })
        servers += server
        server.start().handshake(width, height)
        idle()
        return server
    }

    /** Runs what the client's thread posted to the main thread. */
    private fun idle() = shadowOf(Looper.getMainLooper()).idle()

    private fun sent(server: FakeRfbServer, block: () -> Unit): List<String> {
        val before = server.writes.size
        block()
        return server.writes.drop(before).map { it.hex() }
    }

    private fun key(keysym: Int, down: Boolean) = Msg().u8(4, if (down) 1 else 0).pad(2).s32(keysym).toByteArray().hex()

    private fun press(keysym: Int) = listOf(key(keysym, true), key(keysym, false))

    @After
    fun close() {
        servers.forEach { it.client.close() }
    }

    @Test
    fun `starts empty`() {
        assertNull(state.client)
        assertNull(state.bitmap)
        assertFalse(state.isConnected)
        assertEquals(IntSize.Zero, state.remoteSize)
        assertEquals(1f, state.zoom)
        // Nothing to send to, nothing happens.
        state.sendText("x")
        state.sendChord(Keysyms.Control_L, 'c'.code)
        assertNull(state.toRemote(Offset(1f, 1f)))
    }

    @Test
    fun `the bitmap mirrors the framebuffer`() {
        val server = connect(8, 6)
        assertSame(server.client, state.client)
        assertTrue(state.isConnected)
        assertEquals(IntSize(8, 6), state.remoteSize)
        val bitmap = state.bitmap!!
        assertEquals(8, bitmap.width)
        assertEquals(6, bitmap.height)
        assertEquals(Bitmap.Config.ARGB_8888, bitmap.config)
        assertEquals("black until pixels arrive", OPAQUE, bitmap.getPixel(3, 3))
        val frame = state.frame

        val pixels = noise(3 * 2, seed = 20)
        server.update(rawRect(2, 3, 3, 2, pixels), rawRect(7, 0, 1, 1, intArrayOf(opaque(0x336699))))
        server.expectUpdateRequest(incremental = true, 8, 6)
        assertEquals("nothing is drawn off the main thread", OPAQUE, bitmap.getPixel(2, 3))
        idle()
        assertSame(bitmap, state.bitmap)
        val mirrored = IntArray(8 * 6).also { bitmap.getPixels(it, 0, 8, 0, 0, 8, 6) }
        assertEquals(server.client.framebuffer.pixels.toList(), mirrored.toList())
        assertEquals(pixels[0], bitmap.getPixel(2, 3))
        assertEquals(opaque(0x336699), bitmap.getPixel(7, 0))
        assertEquals("both rectangles arrive as one new frame", frame + 1, state.frame)
    }

    @Test
    fun `a resize replaces the bitmap`() {
        val server = connect(8, 6)
        val before = state.bitmap
        server.update(extendedDesktopSize(0, 0, 12, 10), rawRect(11, 9, 1, 1, intArrayOf(opaque(0xABCDEF))))
        server.expectUpdateRequest(incremental = false, 12, 10)
        idle()
        val after = state.bitmap!!
        assertNotSame(before, after)
        assertEquals(12, after.width)
        assertEquals(10, after.height)
        assertEquals(IntSize(12, 10), state.remoteSize)
        assertEquals(opaque(0xABCDEF), after.getPixel(11, 9))
        assertEquals(OPAQUE, after.getPixel(0, 0))
    }

    @Test
    fun `a disconnect keeps the last frame and clears isConnected`() {
        val server = connect(8, 6)
        server.update(rawRect(0, 0, 1, 1, intArrayOf(opaque(0x112233))))
        server.expectUpdateRequest(incremental = true, 8, 6)
        server.endOfStream()
        server.join()
        idle()
        assertFalse(state.isConnected)
        assertEquals(opaque(0x112233), state.bitmap!!.getPixel(0, 0))
        assertEquals("disconnected null", server.listener.all.last())
    }

    @Test
    fun `the app's listener gets every event`() {
        val server = connect(8, 6)
        server.update(rawRect(0, 0, 1, 1, intArrayOf(OPAQUE)), extendedDesktopSize(0, 0, 9, 9))
        server.expectUpdateRequest(incremental = false, 9, 9)
        server.send(Msg().u8(2))
        server.send(Msg().u8(3).pad(3).s32(2).text("hi"))
        server.endOfStream()
        server.join()
        assertEquals(
            listOf("connected 8x6 test desktop", "update 0,0 1x1", "resize 9x9", "bell", "clipboard hi", "disconnected null"),
            server.listener.all,
        )
    }

    @Test
    fun `a new client takes over and the old one is ignored`() {
        val old = connect(8, 6)
        val new = connect(4, 4)
        assertSame(new.client, state.client)
        assertEquals(IntSize(4, 4), state.remoteSize)
        val frame = state.frame
        old.update(rawRect(0, 0, 1, 1, intArrayOf(opaque(0xFF0000))))
        old.expectUpdateRequest(incremental = true, 8, 6)
        old.endOfStream()
        old.join()
        idle()
        assertEquals(frame, state.frame)
        assertEquals(OPAQUE, state.bitmap!!.getPixel(0, 0))
        assertTrue("the old client's end does not disconnect the new one", state.isConnected)
    }

    @Test
    fun `detach forgets the client`() {
        val server = connect(8, 6)
        state.detach()
        assertNull(state.client)
        assertFalse(state.isConnected)
        assertEquals(emptyList<String>(), sent(server) { state.sendText("x") })
        assertEquals("the last frame stays", 8, state.bitmap!!.width)
    }

    // Keyboard

    @Test
    fun `sendText types each character as key down and up`() {
        val server = connect(8, 6)
        val expected = press('H'.code) + press('i'.code) + press(Keysyms.Return) + press(0x010020AC) +
            press(Keysyms.Tab) + press(0x0101F600) + press(Keysyms.Return) + press(0xE9)
        assertEquals(expected, sent(server) { state.sendText("Hi\r\n€\t😀\né\u0007") })
    }

    @Test
    fun `sendKeysym and sendChord press in order and release in reverse`() {
        val server = connect(8, 6)
        assertEquals(press(Keysyms.Escape), sent(server) { state.sendKeysym(Keysyms.Escape) })
        assertEquals(
            listOf(
                key(Keysyms.Control_L, true), key(Keysyms.Shift_L, true), key('t'.code, true),
                key('t'.code, false), key(Keysyms.Shift_L, false), key(Keysyms.Control_L, false),
            ),
            sent(server) { state.sendChord(Keysyms.Control_L, Keysyms.Shift_L, 't'.code) },
        )
    }

    @Test
    fun `keyboard helpers send nothing when the client is view only`() {
        val server = connect(8, 6)
        server.client.viewOnly = true
        assertEquals(
            emptyList<String>(),
            sent(server) {
                state.sendText("secret")
                state.sendChord(Keysyms.Control_L, 'c'.code)
                state.onKeyEvent(ComposeKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_A)))
            },
        )
    }

    private fun hardware(action: Int, keyCode: Int, meta: Int = 0) =
        state.onKeyEvent(ComposeKeyEvent(KeyEvent(0, 0, action, keyCode, 0, meta)))

    @Test
    fun `hardware keys map to keysyms and release what they pressed`() {
        val server = connect(8, 6)
        assertEquals(
            listOf(key('a'.code, true), key('a'.code, false)),
            sent(server) {
                assertTrue(hardware(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_A))
                assertTrue(hardware(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_A))
            },
        )
        assertEquals(
            press(Keysyms.Return) + press(Keysyms.BackSpace) + press(Keysyms.Left) + press(Keysyms.F5) + press('7'.code),
            sent(server) {
                for (code in listOf(KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_DEL, KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_F5, KeyEvent.KEYCODE_7)) {
                    hardware(KeyEvent.ACTION_DOWN, code)
                    hardware(KeyEvent.ACTION_UP, code)
                }
            },
        )
        // Shift is its own key, and the letter arrives as the shifted character. Releasing
        // Shift first still releases the keysym that was pressed.
        assertEquals(
            listOf(key(Keysyms.Shift_L, true), key('A'.code, true), key(Keysyms.Shift_L, false), key('A'.code, false)),
            sent(server) {
                hardware(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_SHIFT_LEFT, KeyEvent.META_SHIFT_ON or KeyEvent.META_SHIFT_LEFT_ON)
                hardware(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_A, KeyEvent.META_SHIFT_ON or KeyEvent.META_SHIFT_LEFT_ON)
                hardware(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_SHIFT_LEFT)
                hardware(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_A)
            },
        )
        // Ctrl+C: Control and a plain c, which the server combines.
        assertEquals(
            listOf(key(Keysyms.Control_L, true), key('c'.code, true), key('c'.code, false), key(Keysyms.Control_L, false)),
            sent(server) {
                hardware(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_CTRL_LEFT, KeyEvent.META_CTRL_ON or KeyEvent.META_CTRL_LEFT_ON)
                hardware(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_C, KeyEvent.META_CTRL_ON or KeyEvent.META_CTRL_LEFT_ON)
                hardware(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_C, KeyEvent.META_CTRL_ON or KeyEvent.META_CTRL_LEFT_ON)
                hardware(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_CTRL_LEFT)
            },
        )
    }

    @Test
    fun `a held key repeats its press`() {
        val server = connect(8, 6)
        assertEquals(
            listOf(key('x'.code, true), key('x'.code, true), key('x'.code, true), key('x'.code, false)),
            sent(server) {
                repeat(3) { hardware(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_X) }
                hardware(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_X)
            },
        )
    }

    @Test
    fun `device keys and stray releases are left to the app`() {
        val server = connect(8, 6)
        assertEquals(
            emptyList<String>(),
            sent(server) {
                assertFalse(hardware(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_BACK))
                assertFalse(hardware(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_BACK))
                assertFalse(hardware(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_VOLUME_UP))
                assertFalse("a release without its press", hardware(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_B))
            },
        )
    }

    @Test
    fun `Keysyms uses the real android key codes`() {
        val expected = mapOf(
            KeyEvent.KEYCODE_DPAD_UP to Keysyms.Up, KeyEvent.KEYCODE_DPAD_DOWN to Keysyms.Down,
            KeyEvent.KEYCODE_DPAD_LEFT to Keysyms.Left, KeyEvent.KEYCODE_DPAD_RIGHT to Keysyms.Right,
            KeyEvent.KEYCODE_ALT_LEFT to Keysyms.Alt_L, KeyEvent.KEYCODE_ALT_RIGHT to Keysyms.Alt_R,
            KeyEvent.KEYCODE_SHIFT_LEFT to Keysyms.Shift_L, KeyEvent.KEYCODE_SHIFT_RIGHT to Keysyms.Shift_R,
            KeyEvent.KEYCODE_TAB to Keysyms.Tab, KeyEvent.KEYCODE_SPACE to Keysyms.Space,
            KeyEvent.KEYCODE_ENTER to Keysyms.Return, KeyEvent.KEYCODE_NUMPAD_ENTER to Keysyms.Return,
            KeyEvent.KEYCODE_DEL to Keysyms.BackSpace, KeyEvent.KEYCODE_FORWARD_DEL to Keysyms.Delete,
            KeyEvent.KEYCODE_PAGE_UP to Keysyms.PageUp, KeyEvent.KEYCODE_PAGE_DOWN to Keysyms.PageDown,
            KeyEvent.KEYCODE_ESCAPE to Keysyms.Escape,
            KeyEvent.KEYCODE_CTRL_LEFT to Keysyms.Control_L, KeyEvent.KEYCODE_CTRL_RIGHT to Keysyms.Control_R,
            KeyEvent.KEYCODE_CAPS_LOCK to Keysyms.Caps_Lock,
            KeyEvent.KEYCODE_META_LEFT to Keysyms.Super_L, KeyEvent.KEYCODE_META_RIGHT to Keysyms.Super_R,
            KeyEvent.KEYCODE_MOVE_HOME to Keysyms.Home, KeyEvent.KEYCODE_MOVE_END to Keysyms.End,
            KeyEvent.KEYCODE_INSERT to Keysyms.Insert,
            KeyEvent.KEYCODE_F1 to Keysyms.F1, KeyEvent.KEYCODE_F2 to Keysyms.F2, KeyEvent.KEYCODE_F3 to Keysyms.F3,
            KeyEvent.KEYCODE_F4 to Keysyms.F4, KeyEvent.KEYCODE_F5 to Keysyms.F5, KeyEvent.KEYCODE_F6 to Keysyms.F6,
            KeyEvent.KEYCODE_F7 to Keysyms.F7, KeyEvent.KEYCODE_F8 to Keysyms.F8, KeyEvent.KEYCODE_F9 to Keysyms.F9,
            KeyEvent.KEYCODE_F10 to Keysyms.F10, KeyEvent.KEYCODE_F11 to Keysyms.F11, KeyEvent.KEYCODE_F12 to Keysyms.F12,
        )
        for ((keyCode, keysym) in expected) {
            assertEquals(KeyEvent.keyCodeToString(keyCode), keysym, Keysyms.fromAndroidKeyCode(keyCode))
        }
        assertNull(Keysyms.fromAndroidKeyCode(KeyEvent.KEYCODE_A))
        assertNull(Keysyms.fromAndroidKeyCode(KeyEvent.KEYCODE_BACK))
    }

    // Viewport

    @Test
    fun `view positions map to remote pixels under fit-to-view`() {
        connect(800, 600)
        // Same aspect ratio: half scale, no letterbox.
        state.onViewSizeChanged(IntSize(400, 300))
        assertEquals(0.5f, state.scale())
        assertEquals(IntOffset(0, 0), state.toRemote(Offset(0f, 0f)))
        assertEquals(IntOffset(400, 300), state.toRemote(Offset(200f, 150f)))
        assertEquals(IntOffset(799, 599), state.toRemote(Offset(399.9f, 299.9f)))
        assertNull(state.toRemote(Offset(400f, 150f)))
        assertNull(state.toRemote(Offset(-1f, 150f)))

        // A taller view letterboxes: the image is 400x300, centred, 50 px bars above and below.
        state.onViewSizeChanged(IntSize(400, 400))
        assertEquals(0.5f, state.scale())
        assertEquals(Offset(0f, 50f), state.imageOrigin())
        assertNull("the bar above the image", state.toRemote(Offset(10f, 49f)))
        assertEquals(IntOffset(20, 0), state.toRemote(Offset(10f, 50f)))
        assertEquals(IntOffset(20, 0), state.toRemoteClamped(Offset(10f, 20f)))
        assertEquals(IntOffset(799, 599), state.toRemoteClamped(Offset(5000f, 5000f)))
        assertNull(state.toRemote(Offset(10f, 350f)))

        // A wider view pillarboxes, and a small remote is scaled up.
        state.onViewSizeChanged(IntSize(2000, 1200))
        assertEquals(2f, state.scale())
        assertEquals(Offset(200f, 0f), state.imageOrigin())
        assertEquals(IntOffset(0, 0), state.toRemote(Offset(201f, 1f)))
        assertEquals(IntOffset(400, 300), state.toRemote(Offset(1000f, 600f)))
    }

    @Test
    fun `zoom keeps the point under the fingers and stays within 1x to 4x`() {
        connect(800, 600)
        state.onViewSizeChanged(IntSize(400, 300))
        val finger = Offset(100f, 60f)
        val under = state.toRemote(finger)
        state.transformBy(finger, Offset.Zero, 2f)
        assertEquals(2f, state.zoom)
        assertEquals(1f, state.scale())
        assertEquals(under, state.toRemote(finger))
        assertEquals("the view now shows a quarter of the screen", IntOffset(100, 60), state.toRemote(Offset(0f, 0f)))

        state.transformBy(finger, Offset.Zero, 10f)
        assertEquals(4f, state.zoom)
        assertEquals(under, state.toRemote(finger))
        state.transformBy(finger, Offset.Zero, 0.01f)
        assertEquals(1f, state.zoom)
        assertEquals(Offset.Zero, state.pan)
        assertEquals(IntOffset(400, 300), state.toRemote(Offset(200f, 150f)))
    }

    @Test
    fun `pan moves the zoomed image and stops at its edges`() {
        connect(800, 600)
        state.onViewSizeChanged(IntSize(400, 300))
        state.transformBy(Offset(200f, 150f), Offset.Zero, 2f)
        assertEquals(IntOffset(400, 300), state.toRemote(Offset(200f, 150f)))
        // Fingers move 50 px right: at 1 view px per remote px the content follows.
        state.transformBy(Offset(250f, 150f), Offset(50f, 0f), 1f)
        assertEquals(Offset(50f, 0f), state.pan)
        assertEquals(IntOffset(350, 300), state.toRemote(Offset(200f, 150f)))
        // The image is 800x600 in a 400x300 view: it can move 200 px each way horizontally.
        state.transformBy(Offset(250f, 150f), Offset(5000f, -5000f), 1f)
        assertEquals(Offset(200f, -150f), state.pan)
        assertEquals(IntOffset(0, 599), state.toRemote(Offset(0f, 299.5f)))

        state.resetZoom()
        assertEquals(1f, state.zoom)
        assertEquals(Offset.Zero, state.pan)

        // Without zoom there is nothing to pan.
        state.transformBy(Offset(250f, 150f), Offset(50f, 30f), 1f)
        assertEquals(Offset.Zero, state.pan)
    }

    @Test
    fun `pan is re-clamped when the view or the remote changes size`() {
        val server = connect(800, 600)
        state.onViewSizeChanged(IntSize(400, 300))
        state.transformBy(Offset(200f, 150f), Offset.Zero, 2f)
        state.transformBy(Offset(200f, 150f), Offset(200f, 150f), 1f)
        assertEquals(Offset(200f, 150f), state.pan)
        // Half the view: the zoomed image is 400x300 in 200x150, so it can move 100 and 75 px.
        state.onViewSizeChanged(IntSize(200, 150))
        assertEquals(Offset(100f, 75f), state.pan)
        server.update(extendedDesktopSize(0, 0, 100, 600))
        server.expectUpdateRequest(incremental = false, 100, 600)
        idle()
        // 100x600 in 200x150 at 2x is drawn 50x300: narrower than the view, so no horizontal pan.
        assertEquals(Offset(0f, 75f), state.pan)
    }
}
