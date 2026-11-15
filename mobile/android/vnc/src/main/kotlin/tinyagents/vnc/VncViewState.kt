package tinyagents.vnc

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import java.io.InputStream
import java.io.OutputStream
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * What a [VncView] shows and drives: the [RfbClient] of the current connection, a [Bitmap] copy
 * of its framebuffer, and the local zoom.
 *
 * The app creates the client with [createClient], calls [RfbClient.run] on a thread of its own
 * and closes it when done; this state follows the connection by itself. Everything here except
 * the listener glue is for the main thread.
 *
 * Input is sent on the calling thread, so the client's output stream must not block (a WebSocket
 * send queue does not).
 */
public class VncViewState {
    private val main = Handler(Looper.getMainLooper())
    private var glue: Glue? = null
    private val heldKeys = HashMap<Int, Int>()

    /** The client of the current connection, or null before [createClient] and after [detach]. */
    public var client: RfbClient? by mutableStateOf(null)
        private set

    /** True between the end of the handshake and the end of the connection. */
    public var isConnected: Boolean by mutableStateOf(false)
        private set

    /** The remote desktop's size in its own pixels; zero before the first connection. */
    public var remoteSize: IntSize by mutableStateOf(IntSize.Zero)
        private set

    /** The size of the [VncView] showing this state, in pixels; zero while it is not laid out. */
    public var viewSize: IntSize by mutableStateOf(IntSize.Zero)
        private set

    /**
     * The remote screen as last drawn, or null before the first connection. It stays after a
     * disconnect and is replaced, not resized, when the remote desktop changes size.
     */
    public var bitmap: Bitmap? = null
        private set

    internal var image: ImageBitmap? by mutableStateOf(null)
        private set

    private val frameCount = mutableIntStateOf(0)

    /** Counts the times [bitmap] changed; reading it in a composition or draw observes them. */
    public val frame: Int get() = frameCount.intValue

    /** Local magnification on top of fit-to-view, 1 to 4. */
    public var zoom: Float by mutableFloatStateOf(1f)
        private set

    internal var pan: Offset by mutableStateOf(Offset.Zero)
        private set

    /**
     * Creates the client for a new connection over [input] and [output] and makes it this
     * state's [client], in place of any earlier one (which is not closed). [listener] gets every
     * event too, on the client's thread.
     */
    public fun createClient(
        input: InputStream,
        output: OutputStream,
        listener: RfbListener? = null,
        shared: Boolean = true,
    ): RfbClient {
        val glue = Glue(listener)
        val created = RfbClient(input, output, glue, shared)
        glue.client = created
        this.glue = glue
        heldKeys.clear()
        isConnected = false
        client = created
        return created
    }

    /** Forgets the current [client] without closing it. The last frame stays visible. */
    public fun detach() {
        glue = null
        client = null
        isConnected = false
        heldKeys.clear()
    }

    /** Types [text]: each character as a key press and release of its keysym. */
    public fun sendText(text: String) {
        val client = client ?: return
        var index = 0
        var previous = 0
        while (index < text.length) {
            val codePoint = text.codePointAt(index)
            index += Character.charCount(codePoint)
            // A Windows line ending is one Return.
            val skip = codePoint == '\n'.code && previous == '\r'.code
            previous = codePoint
            val keysym = if (skip) Keysyms.None else Keysyms.fromChar(codePoint)
            if (keysym != Keysyms.None) {
                client.sendKey(keysym, true)
                client.sendKey(keysym, false)
            }
        }
    }

    /** Presses and releases one key, see [Keysyms]. */
    public fun sendKeysym(keysym: Int) {
        sendChord(keysym)
    }

    /** Presses the keys in order and releases them in reverse, as for Control_L + `c`. */
    public fun sendChord(vararg keysyms: Int) {
        val client = client ?: return
        for (keysym in keysyms) client.sendKey(keysym, true)
        for (i in keysyms.indices.reversed()) client.sendKey(keysyms[i], false)
    }

    /**
     * Forwards a hardware key event. Returns true when the key was sent, false for keys that
     * belong to the device (Back, volume) or have no X11 equivalent. [VncView] calls this for
     * the keys it receives while focused and interactive; the app can route keys from elsewhere.
     */
    public fun onKeyEvent(event: KeyEvent): Boolean {
        val native = event.nativeKeyEvent
        if (native.isSystem) return false
        val client = client ?: return false
        return when (native.action) {
            android.view.KeyEvent.ACTION_DOWN -> {
                // A repeat sends the keysym its first press sent, even if modifiers changed since.
                val keysym = heldKeys[native.keyCode] ?: keysymOf(native)
                if (keysym == Keysyms.None) return false
                heldKeys[native.keyCode] = keysym
                client.sendKey(keysym, true)
                true
            }
            android.view.KeyEvent.ACTION_UP -> {
                val keysym = heldKeys.remove(native.keyCode) ?: return false
                client.sendKey(keysym, false)
                true
            }
            else -> false
        }
    }

    /** Back to fit-to-view. */
    public fun resetZoom() {
        zoom = 1f
        pan = Offset.Zero
    }

    private fun keysymOf(event: android.view.KeyEvent): Int {
        Keysyms.fromAndroidKeyCode(event.keyCode)?.let { return it }
        // The character the key types with Shift and Caps Lock applied, but not Ctrl, Alt or
        // Meta: those are sent as their own keys and the server combines them.
        val character = event.getUnicodeChar(event.metaState and CHARACTER_META_MASK)
        if (character <= 0 || character and android.view.KeyCharacterMap.COMBINING_ACCENT != 0) return Keysyms.None
        return Keysyms.fromChar(character)
    }

    // Viewport: fit-to-view times zoom, centred, shifted by pan.

    internal fun onViewSizeChanged(size: IntSize) {
        viewSize = size
        pan = clampPan(pan, zoom)
    }

    /** View pixels per remote pixel, or 0 when there is nothing to show. */
    internal fun scale(): Float {
        val remote = remoteSize
        val view = viewSize
        if (remote.width <= 0 || remote.height <= 0 || view.width <= 0 || view.height <= 0) return 0f
        return min(view.width / remote.width.toFloat(), view.height / remote.height.toFloat()) * zoom
    }

    /** Where the remote screen's top left corner is drawn in the view. */
    internal fun imageOrigin(): Offset {
        val scale = scale()
        return Offset(
            (viewSize.width - remoteSize.width * scale) / 2f + pan.x,
            (viewSize.height - remoteSize.height * scale) / 2f + pan.y,
        )
    }

    /** The remote pixel under a view position, or null when it is outside the remote screen. */
    internal fun toRemote(position: Offset): IntOffset? {
        val scale = scale()
        if (scale <= 0f) return null
        val origin = imageOrigin()
        val x = floor((position.x - origin.x) / scale).toInt()
        val y = floor((position.y - origin.y) / scale).toInt()
        if (x !in 0 until remoteSize.width || y !in 0 until remoteSize.height) return null
        return IntOffset(x, y)
    }

    /** Like [toRemote], but a position outside the remote screen maps to its nearest edge. */
    internal fun toRemoteClamped(position: Offset): IntOffset? {
        val scale = scale()
        if (scale <= 0f) return null
        val origin = imageOrigin()
        return IntOffset(
            floor((position.x - origin.x) / scale).toInt().coerceIn(0, remoteSize.width - 1),
            floor((position.y - origin.y) / scale).toInt().coerceIn(0, remoteSize.height - 1),
        )
    }

    /**
     * Applies a two-finger step: the fingers' centre moved by [panChange] to [centroid] and
     * spread by [zoomChange]. The remote point under the centre stays under it.
     */
    internal fun transformBy(centroid: Offset, panChange: Offset, zoomChange: Float) {
        val newZoom = (zoom * zoomChange).coerceIn(MIN_ZOOM, MAX_ZOOM)
        val factor = newZoom / zoom
        val centre = Offset(viewSize.width / 2f, viewSize.height / 2f)
        val before = centroid - panChange
        // The centroid's offset from the image centre scales with the zoom.
        val newPan = (centroid - centre) - (before - centre - pan) * factor
        zoom = newZoom
        pan = clampPan(newPan, newZoom)
    }

    private fun clampPan(pan: Offset, zoom: Float): Offset {
        val remote = remoteSize
        val view = viewSize
        if (remote.width <= 0 || remote.height <= 0 || view.width <= 0 || view.height <= 0) return Offset.Zero
        val scale = min(view.width / remote.width.toFloat(), view.height / remote.height.toFloat()) * zoom
        val maxX = max(0f, (remote.width * scale - view.width) / 2f)
        val maxY = max(0f, (remote.height * scale - view.height) / 2f)
        return Offset(pan.x.coerceIn(-maxX, maxX), pan.y.coerceIn(-maxY, maxY))
    }

    // Pointer input, in remote pixels.

    internal fun pointer(at: IntOffset, buttonMask: Int) {
        client?.sendPointer(at.x, at.y, buttonMask)
    }

    /** Moves to [at], then presses and releases [buttonMask] there. */
    internal fun click(at: IntOffset, buttonMask: Int) {
        pointer(at, 0)
        pointer(at, buttonMask)
        pointer(at, 0)
    }

    // Framebuffer to bitmap, on the main thread.

    // This module has no androidx.core dependency, so no createBitmap extension.
    @SuppressLint("UseKtx")
    private fun present(fb: RfbFramebuffer, left: Int, top: Int, right: Int, bottom: Int) {
        if (fb.width <= 0 || fb.height <= 0) return
        var target = bitmap
        var l = left
        var t = top
        var r = right
        var b = bottom
        if (target == null || target.width != fb.width || target.height != fb.height) {
            target = Bitmap.createBitmap(fb.width, fb.height, Bitmap.Config.ARGB_8888)
            target.setHasAlpha(false)
            bitmap = target
            image = target.asImageBitmap()
            remoteSize = IntSize(fb.width, fb.height)
            pan = clampPan(pan, zoom)
            l = 0
            t = 0
            r = fb.width
            b = fb.height
        }
        l = l.coerceIn(0, fb.width)
        t = t.coerceIn(0, fb.height)
        r = r.coerceIn(l, fb.width)
        b = b.coerceIn(t, fb.height)
        if (r == l || b == t) return
        target.setPixels(fb.pixels, t * fb.width + l, fb.width, l, t, r - l, b - t)
        frameCount.intValue++
    }

    /**
     * The client's listener. Dirty rectangles arrive on the client's thread; they are merged and
     * copied to the bitmap on the main thread, at most once per main-loop turn.
     */
    private inner class Glue(private val delegate: RfbListener?) : RfbListener {
        lateinit var client: RfbClient
        private val lock = Any()
        private var posted = false
        private var left = Int.MAX_VALUE
        private var top = Int.MAX_VALUE
        private var right = 0
        private var bottom = 0

        private val flush = Runnable {
            val l: Int
            val t: Int
            val r: Int
            val b: Int
            synchronized(lock) {
                l = left
                t = top
                r = right
                b = bottom
                left = Int.MAX_VALUE
                top = Int.MAX_VALUE
                right = 0
                bottom = 0
                posted = false
            }
            if (glue === this) present(client.framebuffer, l, t, r, b)
        }

        private fun markDirty(x: Int, y: Int, width: Int, height: Int) {
            synchronized(lock) {
                left = min(left, x)
                top = min(top, y)
                right = max(right, x + width)
                bottom = max(bottom, y + height)
                if (!posted) {
                    posted = true
                    main.post(flush)
                }
            }
        }

        override fun onConnected(width: Int, height: Int, name: String) {
            markDirty(0, 0, width, height)
            main.post { if (glue === this) isConnected = true }
            delegate?.onConnected(width, height, name)
        }

        override fun onFramebufferUpdate(x: Int, y: Int, width: Int, height: Int) {
            markDirty(x, y, width, height)
            delegate?.onFramebufferUpdate(x, y, width, height)
        }

        override fun onResize(width: Int, height: Int) {
            markDirty(0, 0, width, height)
            delegate?.onResize(width, height)
        }

        override fun onBell() {
            delegate?.onBell()
        }

        override fun onServerClipboard(text: String) {
            delegate?.onServerClipboard(text)
        }

        override fun onDisconnected(reason: String?) {
            main.post { if (glue === this) isConnected = false }
            delegate?.onDisconnected(reason)
        }
    }

    internal companion object {
        const val MIN_ZOOM = 1f
        const val MAX_ZOOM = 4f

        private const val CHARACTER_META_MASK =
            android.view.KeyEvent.META_SHIFT_MASK or android.view.KeyEvent.META_CAPS_LOCK_ON
    }
}
