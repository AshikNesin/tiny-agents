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

public class VncViewState {
    private val main = Handler(Looper.getMainLooper())
    private var glue: Glue? = null
    private val heldKeys = HashMap<Int, Int>()

    public var client: RfbClient? by mutableStateOf(null)
        private set

    public var isConnected: Boolean by mutableStateOf(false)
        private set

    public var remoteSize: IntSize by mutableStateOf(IntSize.Zero)
        private set

    public var viewSize: IntSize by mutableStateOf(IntSize.Zero)
        private set

    public var bitmap: Bitmap? = null
        private set

    internal var image: ImageBitmap? by mutableStateOf(null)
        private set

    private val frameCount = mutableIntStateOf(0)

    public val frame: Int get() = frameCount.intValue

    public var zoom: Float by mutableFloatStateOf(1f)
        private set

    internal var pan: Offset by mutableStateOf(Offset.Zero)
        private set

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

    public fun detach() {
        glue = null
        client = null
        isConnected = false
        heldKeys.clear()
    }

    public fun sendText(text: String) {
        val client = client ?: return
        var index = 0
        var previous = 0
        while (index < text.length) {
            val codePoint = text.codePointAt(index)
            index += Character.charCount(codePoint)
            val skip = codePoint == '\n'.code && previous == '\r'.code
            previous = codePoint
            val keysym = if (skip) Keysyms.None else Keysyms.fromChar(codePoint)
            if (keysym != Keysyms.None) {
                client.sendKey(keysym, true)
                client.sendKey(keysym, false)
            }
        }
    }

    public fun sendKeysym(keysym: Int) {
        sendChord(keysym)
    }

    public fun sendChord(vararg keysyms: Int) {
        val client = client ?: return
        for (keysym in keysyms) client.sendKey(keysym, true)
        for (i in keysyms.indices.reversed()) client.sendKey(keysyms[i], false)
    }

    public fun onKeyEvent(event: KeyEvent): Boolean {
        val native = event.nativeKeyEvent
        if (native.isSystem) return false
        val client = client ?: return false
        return when (native.action) {
            android.view.KeyEvent.ACTION_DOWN -> {
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

    public fun resetZoom() {
        zoom = 1f
        pan = Offset.Zero
    }

    private fun keysymOf(event: android.view.KeyEvent): Int {
        Keysyms.fromAndroidKeyCode(event.keyCode)?.let { return it }
        val character = event.getUnicodeChar(event.metaState and CHARACTER_META_MASK)
        if (character <= 0 || character and android.view.KeyCharacterMap.COMBINING_ACCENT != 0) return Keysyms.None
        return Keysyms.fromChar(character)
    }

    internal fun onViewSizeChanged(size: IntSize) {
        viewSize = size
        pan = clampPan(pan, zoom)
    }

    internal fun scale(): Float {
        val remote = remoteSize
        val view = viewSize
        if (remote.width <= 0 || remote.height <= 0 || view.width <= 0 || view.height <= 0) return 0f
        return min(view.width / remote.width.toFloat(), view.height / remote.height.toFloat()) * zoom
    }

    internal fun imageOrigin(): Offset {
        val scale = scale()
        return Offset(
            (viewSize.width - remoteSize.width * scale) / 2f + pan.x,
            (viewSize.height - remoteSize.height * scale) / 2f + pan.y,
        )
    }

    internal fun toRemote(position: Offset): IntOffset? {
        val scale = scale()
        if (scale <= 0f) return null
        val origin = imageOrigin()
        val x = floor((position.x - origin.x) / scale).toInt()
        val y = floor((position.y - origin.y) / scale).toInt()
        if (x !in 0 until remoteSize.width || y !in 0 until remoteSize.height) return null
        return IntOffset(x, y)
    }

    internal fun toRemoteClamped(position: Offset): IntOffset? {
        val scale = scale()
        if (scale <= 0f) return null
        val origin = imageOrigin()
        return IntOffset(
            floor((position.x - origin.x) / scale).toInt().coerceIn(0, remoteSize.width - 1),
            floor((position.y - origin.y) / scale).toInt().coerceIn(0, remoteSize.height - 1),
        )
    }

    internal fun transformBy(centroid: Offset, panChange: Offset, zoomChange: Float) {
        val newZoom = (zoom * zoomChange).coerceIn(MIN_ZOOM, MAX_ZOOM)
        val factor = newZoom / zoom
        val centre = Offset(viewSize.width / 2f, viewSize.height / 2f)
        val before = centroid - panChange
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

    internal fun pointer(at: IntOffset, buttonMask: Int) {
        client?.sendPointer(at.x, at.y, buttonMask)
    }

    internal fun click(at: IntOffset, buttonMask: Int) {
        pointer(at, 0)
        pointer(at, buttonMask)
        pointer(at, 0)
    }

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
