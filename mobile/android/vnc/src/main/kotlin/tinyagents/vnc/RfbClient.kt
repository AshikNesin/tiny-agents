package tinyagents.vnc

import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.atomic.AtomicBoolean

public interface RfbListener {
    public fun onConnected(width: Int, height: Int, name: String)

    public fun onFramebufferUpdate(x: Int, y: Int, width: Int, height: Int)

    public fun onResize(width: Int, height: Int)

    public fun onBell() {}

    public fun onServerClipboard(text: String) {}

    public fun onDisconnected(reason: String?)
}

public class RfbFramebuffer(public val width: Int, public val height: Int) {
    public val pixels: IntArray = IntArray(width * height).also { it.fill(OPAQUE) }
}

public class RfbClient internal constructor(
    input: InputStream,
    private val output: OutputStream,
    private val listener: RfbListener,
    private val shared: Boolean,
    private val encodings: IntArray,
) {
    public constructor(
        input: InputStream,
        output: OutputStream,
        listener: RfbListener,
        shared: Boolean = true,
    ) : this(input, output, listener, shared, ENCODINGS)

    private val source = input
    private val input = RfbInput(input)
    private val started = AtomicBoolean(false)
    private val writeLock = Any()

    private val raw = RawDecoder()
    private val hextile = HextileDecoder()
    private val zrle = ZrleDecoder()

    @Volatile
    public var framebuffer: RfbFramebuffer = RfbFramebuffer(0, 0)
        private set

    @Volatile
    public var viewOnly: Boolean = false

    @Volatile private var ready = false

    @Volatile private var closed = false

    @Volatile private var writeFailure: String? = null

    private var resizable = false
    private var screenId = 0
    private var screenFlags = 0
    private var pendingWidth = 0
    private var pendingHeight = 0

    internal var rectObserver: ((encoding: Int, x: Int, y: Int, width: Int, height: Int) -> Unit)? = null

    public fun run() {
        check(started.compareAndSet(false, true)) { "RfbClient.run() can only be called once" }
        var reason: String? = null
        try {
            handshake()
            requestUpdate(incremental = false)
            while (true) readServerMessage()
        } catch (e: RfbProtocolException) {
            reason = e.message
        } catch (e: EOFException) {
            reason = if (ready) null else "Connection closed during the handshake"
        } catch (e: IOException) {
            reason = e.message ?: e.javaClass.simpleName
        } catch (e: RuntimeException) {
            reason = "Internal error: $e"
        } finally {
            val closedByCaller = closed
            shutdown()
            zrle.end()
            listener.onDisconnected(if (closedByCaller) null else writeFailure ?: reason)
        }
    }

    public fun close() {
        shutdown()
    }

    public fun sendPointer(x: Int, y: Int, buttonMask: Int) {
        if (viewOnly || !ready) return
        val fb = framebuffer
        val px = x.coerceIn(0, maxOf(0, fb.width - 1))
        val py = y.coerceIn(0, maxOf(0, fb.height - 1))
        send(
            byteArrayOf(
                MSG_POINTER_EVENT, buttonMask.toByte(),
                (px shr 8).toByte(), px.toByte(), (py shr 8).toByte(), py.toByte(),
            ),
        )
    }

    public fun sendKey(keysym: Int, down: Boolean) {
        if (viewOnly || !ready) return
        val message = ByteArray(8)
        message[0] = MSG_KEY_EVENT
        message[1] = if (down) 1 else 0
        putS32(message, 4, keysym)
        send(message)
    }

    public fun sendClipboard(text: String) {
        if (viewOnly || !ready) return
        val length = minOf(text.length, MAX_STRING)
        val message = ByteArray(8 + length)
        message[0] = MSG_CLIENT_CUT_TEXT
        putS32(message, 4, length)
        for (i in 0 until length) {
            val c = text[i].code
            message[8 + i] = (if (c <= 0xFF) c else '?'.code).toByte()
        }
        send(message)
    }

    public fun requestDesktopSize(width: Int, height: Int): Boolean {
        if (width !in 1..MAX_DIMENSION || height !in 1..MAX_DIMENSION) return false
        synchronized(writeLock) {
            if (closed) return false
            if (!resizable) {
                pendingWidth = width
                pendingHeight = height
                return false
            }
            sendDesktopSize(width, height)
            return true
        }
    }

    private fun handshake() {
        val version = negotiateVersion()
        negotiateSecurity(version)
        send(byteArrayOf(if (shared) 1 else 0))

        val width = input.u16()
        val height = input.u16()
        input.skip(PIXEL_FORMAT_SIZE.toLong())
        val name = readString("desktop name")
        framebuffer = allocate(width, height)

        send(SET_PIXEL_FORMAT)
        val setEncodings = ByteArray(4 + encodings.size * 4)
        setEncodings[0] = MSG_SET_ENCODINGS
        putU16(setEncodings, 2, encodings.size)
        encodings.forEachIndexed { i, encoding -> putS32(setEncodings, 4 + i * 4, encoding) }
        send(setEncodings)

        ready = true
        listener.onConnected(width, height, name)
    }

    private fun negotiateVersion(): Int {
        val greeting = String(input.bytes(VERSION_SIZE), Charsets.ISO_8859_1)
        val match = VERSION.matchEntire(greeting)
            ?: throw RfbProtocolException("Not an RFB server")
        val major = match.groupValues[1].toInt()
        val minor = match.groupValues[2].toInt()
        val version = when {
            major > 3 || (major == 3 && minor >= 8) -> 8
            major == 3 && minor == 7 -> 7
            major == 3 -> 3
            else -> throw RfbProtocolException("Unsupported RFB version $major.$minor")
        }
        send("RFB 003.00$version\n".toByteArray(Charsets.ISO_8859_1))
        return version
    }

    private fun negotiateSecurity(version: Int) {
        if (version == 3) {
            when (val type = input.s32()) {
                SECURITY_INVALID -> throw RfbProtocolException("Server refused the connection: ${readString("reason")}")
                SECURITY_NONE -> return
                else -> throw RfbProtocolException(unsupportedSecurity(listOf(type)))
            }
        }
        val count = input.u8()
        if (count == 0) {
            throw RfbProtocolException("Server refused the connection: ${readString("reason")}")
        }
        val types = input.bytes(count).map { it.toInt() and 0xFF }
        if (SECURITY_NONE !in types) throw RfbProtocolException(unsupportedSecurity(types))
        send(byteArrayOf(SECURITY_NONE.toByte()))
        if (version >= 8 && input.s32() != 0) {
            throw RfbProtocolException("Server refused the connection: ${readString("reason")}")
        }
    }

    private fun unsupportedSecurity(types: List<Int>): String =
        "Server requires authentication (security types ${types.joinToString()}); only None is supported"

    private fun readServerMessage() {
        when (val type = input.u8()) {
            SERVER_FRAMEBUFFER_UPDATE -> readFramebufferUpdate()
            SERVER_SET_COLOUR_MAP_ENTRIES -> {
                input.skip(3)
                input.skip(input.u16() * 6L)
            }
            SERVER_BELL -> listener.onBell()
            SERVER_CUT_TEXT -> readServerCutText()
            SERVER_END_OF_CONTINUOUS_UPDATES -> Unit
            SERVER_FENCE -> {
                input.skip(7)
                input.skip(input.u8().toLong())
            }
            SERVER_XVP -> input.skip(3)
            else -> throw RfbProtocolException("Unsupported server message type $type")
        }
    }

    private fun readServerCutText() {
        input.skip(3)
        val length = input.s32()
        when {
            length < 0 -> input.skip(-length.toLong())
            length > MAX_STRING -> input.skip(length.toLong())
            else -> listener.onServerClipboard(String(input.bytes(length), Charsets.ISO_8859_1))
        }
    }

    private fun readFramebufferUpdate() {
        input.skip(1)
        val count = input.u16()
        var resized = false
        var index = 0
        while (index < count) {
            val x = input.u16()
            val y = input.u16()
            val width = input.u16()
            val height = input.u16()
            val encoding = input.s32()
            rectObserver?.invoke(encoding, x, y, width, height)
            when (encoding) {
                ENCODING_LAST_RECT -> break
                ENCODING_DESKTOP_SIZE -> if (resize(width, height)) resized = true
                ENCODING_EXTENDED_DESKTOP_SIZE -> if (readExtendedDesktopSize(x, y, width, height)) resized = true
                else -> readPixels(encoding, x, y, width, height)
            }
            index++
        }
        requestUpdate(incremental = !resized)
    }

    private fun readPixels(encoding: Int, x: Int, y: Int, width: Int, height: Int) {
        val fb = framebuffer
        if (x + width > fb.width || y + height > fb.height) {
            throw RfbProtocolException(
                "Rectangle ${width}x$height at $x,$y is outside the ${fb.width}x${fb.height} framebuffer",
            )
        }
        when (encoding) {
            ENCODING_RAW -> raw.decode(input, fb, x, y, width, height)
            ENCODING_COPY_RECT -> {
                val srcX = input.u16()
                val srcY = input.u16()
                if (srcX + width > fb.width || srcY + height > fb.height) {
                    throw RfbProtocolException("CopyRect source is outside the framebuffer")
                }
                copyRect(fb, srcX, srcY, x, y, width, height)
            }
            ENCODING_HEXTILE -> hextile.decode(input, fb, x, y, width, height)
            ENCODING_ZRLE -> zrle.decode(input, fb, x, y, width, height)
            else -> throw RfbProtocolException("Unsupported encoding $encoding")
        }
        if (width > 0 && height > 0) listener.onFramebufferUpdate(x, y, width, height)
    }

    private fun readExtendedDesktopSize(reason: Int, status: Int, width: Int, height: Int): Boolean {
        val screens = input.u8()
        input.skip(3)
        var firstId = 0
        var firstFlags = 0
        for (i in 0 until screens) {
            val id = input.s32()
            input.skip(8)
            val flags = input.s32()
            if (i == 0) {
                firstId = id
                firstFlags = flags
            }
        }
        synchronized(writeLock) {
            if (screens > 0) {
                screenId = firstId
                screenFlags = firstFlags
            }
            if (!resizable) {
                resizable = true
                if (pendingWidth > 0) sendDesktopSize(pendingWidth, pendingHeight)
            }
        }
        if (reason == 1 && status != 0) return false
        return resize(width, height)
    }

    private fun resize(width: Int, height: Int): Boolean {
        val current = framebuffer
        if (current.width == width && current.height == height) return false
        framebuffer = allocate(width, height)
        listener.onResize(width, height)
        return true
    }

    private fun allocate(width: Int, height: Int): RfbFramebuffer {
        if (width > MAX_DIMENSION || height > MAX_DIMENSION || width.toLong() * height > MAX_PIXELS) {
            throw RfbProtocolException("Framebuffer of ${width}x$height is too large")
        }
        try {
            return RfbFramebuffer(width, height)
        } catch (e: OutOfMemoryError) {
            throw RfbProtocolException("Not enough memory for a ${width}x$height framebuffer")
        }
    }

    private fun readString(what: String): String {
        val length = input.u32()
        if (length > MAX_STRING) throw RfbProtocolException("The $what is too long ($length bytes)")
        return String(input.bytes(length.toInt()), Charsets.UTF_8)
    }

    private fun requestUpdate(incremental: Boolean) {
        val fb = framebuffer
        val message = ByteArray(10)
        message[0] = MSG_FRAMEBUFFER_UPDATE_REQUEST
        message[1] = if (incremental) 1 else 0
        putU16(message, 6, fb.width)
        putU16(message, 8, fb.height)
        send(message)
    }

    private fun sendDesktopSize(width: Int, height: Int) {
        pendingWidth = 0
        pendingHeight = 0
        val message = ByteArray(24)
        message[0] = MSG_SET_DESKTOP_SIZE
        putU16(message, 2, width)
        putU16(message, 4, height)
        message[6] = 1
        putS32(message, 8, screenId)
        putU16(message, 16, width)
        putU16(message, 18, height)
        putS32(message, 20, screenFlags)
        send(message)
    }

    private fun send(message: ByteArray) {
        synchronized(writeLock) {
            if (closed) return
            try {
                output.write(message)
                output.flush()
            } catch (e: IOException) {
                if (writeFailure == null) writeFailure = "Could not send: ${e.message ?: e.javaClass.simpleName}"
                closeQuietly(source)
            }
        }
    }

    private fun shutdown() {
        ready = false
        closed = true
        closeQuietly(source)
        closeQuietly(output)
    }

    private fun closeQuietly(stream: java.io.Closeable) {
        try {
            stream.close()
        } catch (_: IOException) {
        }
    }

    private companion object {
        const val MAX_STRING = 1 shl 20
        const val MAX_DIMENSION = 8192
        const val MAX_PIXELS = 4096L * 4096L
        const val VERSION_SIZE = 12
        const val PIXEL_FORMAT_SIZE = 16
        val VERSION = Regex("RFB (\\d{3})\\.(\\d{3})\n")

        const val SECURITY_INVALID = 0
        const val SECURITY_NONE = 1

        const val MSG_SET_PIXEL_FORMAT: Byte = 0
        const val MSG_SET_ENCODINGS: Byte = 2
        const val MSG_FRAMEBUFFER_UPDATE_REQUEST: Byte = 3
        const val MSG_KEY_EVENT: Byte = 4
        const val MSG_POINTER_EVENT: Byte = 5
        const val MSG_CLIENT_CUT_TEXT: Byte = 6
        const val MSG_SET_DESKTOP_SIZE: Byte = 251.toByte()

        const val SERVER_FRAMEBUFFER_UPDATE = 0
        const val SERVER_SET_COLOUR_MAP_ENTRIES = 1
        const val SERVER_BELL = 2
        const val SERVER_CUT_TEXT = 3
        const val SERVER_END_OF_CONTINUOUS_UPDATES = 150
        const val SERVER_FENCE = 248
        const val SERVER_XVP = 250

        const val ENCODING_RAW = 0
        const val ENCODING_COPY_RECT = 1
        const val ENCODING_HEXTILE = 5
        const val ENCODING_ZRLE = 16
        const val ENCODING_DESKTOP_SIZE = -223
        const val ENCODING_LAST_RECT = -224
        const val ENCODING_EXTENDED_DESKTOP_SIZE = -308

        val ENCODINGS = intArrayOf(
            ENCODING_ZRLE, ENCODING_HEXTILE, ENCODING_COPY_RECT, ENCODING_RAW,
            ENCODING_DESKTOP_SIZE, ENCODING_EXTENDED_DESKTOP_SIZE, ENCODING_LAST_RECT,
        )

        val SET_PIXEL_FORMAT = byteArrayOf(
            MSG_SET_PIXEL_FORMAT, 0, 0, 0,
            32, 24, 0, 1,
            0, 255.toByte(), 0, 255.toByte(), 0, 255.toByte(),
            16, 8, 0,
            0, 0, 0,
        )

        fun putU16(target: ByteArray, offset: Int, value: Int) {
            target[offset] = (value shr 8).toByte()
            target[offset + 1] = value.toByte()
        }

        fun putS32(target: ByteArray, offset: Int, value: Int) {
            target[offset] = (value shr 24).toByte()
            target[offset + 1] = (value shr 16).toByte()
            target[offset + 2] = (value shr 8).toByte()
            target[offset + 3] = value.toByte()
        }
    }
}
