package tinyagents.vnc

import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.util.zip.DataFormatException
import java.util.zip.Inflater

/** The server broke the protocol, or asked for something this client refuses. */
internal class RfbProtocolException(message: String) : IOException(message)

internal const val OPAQUE: Int = 0xFF shl 24

/** Buffered big-endian reader over the server's byte stream. End of stream is an [EOFException]. */
internal class RfbInput(private val source: InputStream) {
    private val buffer = ByteArray(BUFFER_SIZE)
    private var position = 0
    private var limit = 0

    private fun fill() {
        val n = source.read(buffer, 0, buffer.size)
        if (n < 0) throw EOFException()
        position = 0
        limit = n
    }

    fun u8(): Int {
        while (position == limit) fill()
        return buffer[position++].toInt() and 0xFF
    }

    fun u16(): Int = (u8() shl 8) or u8()

    fun s32(): Int = (u8() shl 24) or (u8() shl 16) or (u8() shl 8) or u8()

    fun u32(): Long = s32().toLong() and 0xFFFFFFFFL

    /** One pixel in the client's format (bytes B, G, R, unused) as opaque ARGB. */
    fun pixel(): Int {
        if (limit - position >= 4) {
            val p = position
            position = p + 4
            return OPAQUE or
                ((buffer[p + 2].toInt() and 0xFF) shl 16) or
                ((buffer[p + 1].toInt() and 0xFF) shl 8) or
                (buffer[p].toInt() and 0xFF)
        }
        val b = u8()
        val g = u8()
        val r = u8()
        u8()
        return OPAQUE or (r shl 16) or (g shl 8) or b
    }

    fun readFully(target: ByteArray, offset: Int, length: Int) {
        var done = 0
        while (done < length) {
            if (position == limit) {
                // Large reads go straight to the target, small ones through the buffer.
                if (length - done >= buffer.size) {
                    val n = source.read(target, offset + done, length - done)
                    if (n < 0) throw EOFException()
                    done += n
                    continue
                }
                fill()
            }
            val n = minOf(length - done, limit - position)
            System.arraycopy(buffer, position, target, offset + done, n)
            position += n
            done += n
        }
    }

    fun bytes(length: Int): ByteArray = ByteArray(length).also { readFully(it, 0, length) }

    fun skip(count: Long) {
        var left = count
        while (left > 0) {
            while (position == limit) fill()
            val n = minOf(left, (limit - position).toLong()).toInt()
            position += n
            left -= n
        }
    }

    private companion object {
        const val BUFFER_SIZE = 64 * 1024
    }
}

/** Raw encoding: `width * height` pixels, row by row. */
internal class RawDecoder {
    private var row = ByteArray(0)

    fun decode(input: RfbInput, fb: RfbFramebuffer, x: Int, y: Int, width: Int, height: Int) {
        if (row.size < width * 4) row = ByteArray(width * 4)
        val row = row
        val pixels = fb.pixels
        for (line in 0 until height) {
            input.readFully(row, 0, width * 4)
            var out = (y + line) * fb.width + x
            var i = 0
            repeat(width) {
                pixels[out++] = OPAQUE or
                    ((row[i + 2].toInt() and 0xFF) shl 16) or
                    ((row[i + 1].toInt() and 0xFF) shl 8) or
                    (row[i].toInt() and 0xFF)
                i += 4
            }
        }
    }
}

/** CopyRect encoding: the rectangle is a copy of another part of the framebuffer. */
internal fun copyRect(fb: RfbFramebuffer, srcX: Int, srcY: Int, x: Int, y: Int, width: Int, height: Int) {
    val pixels = fb.pixels
    // Rows are copied in the order that never overwrites a source row not copied yet.
    // System.arraycopy handles the overlap within a row.
    val rows = if (y <= srcY) 0 until height else (height - 1) downTo 0
    for (line in rows) {
        System.arraycopy(pixels, (srcY + line) * fb.width + srcX, pixels, (y + line) * fb.width + x, width)
    }
}

/** Hextile encoding: 16x16 tiles, each raw or a background plus coloured sub-rectangles. */
internal class HextileDecoder {
    private val tile = IntArray(TILE * TILE)

    fun decode(input: RfbInput, fb: RfbFramebuffer, x: Int, y: Int, width: Int, height: Int) {
        var background = OPAQUE
        var foreground = OPAQUE
        val tile = tile
        var ty = 0
        while (ty < height) {
            val th = minOf(TILE, height - ty)
            var tx = 0
            while (tx < width) {
                val tw = minOf(TILE, width - tx)
                val sub = input.u8()
                if (sub and RAW != 0) {
                    for (i in 0 until tw * th) tile[i] = input.pixel()
                } else {
                    if (sub and BACKGROUND_SPECIFIED != 0) background = input.pixel()
                    if (sub and FOREGROUND_SPECIFIED != 0) foreground = input.pixel()
                    tile.fill(background, 0, tw * th)
                    if (sub and ANY_SUBRECTS != 0) {
                        val coloured = sub and SUBRECTS_COLOURED != 0
                        repeat(input.u8()) {
                            val colour = if (coloured) input.pixel() else foreground
                            val xy = input.u8()
                            val wh = input.u8()
                            val sx = xy shr 4
                            val sy = xy and 0xF
                            val sw = (wh shr 4) + 1
                            val sh = (wh and 0xF) + 1
                            if (sx + sw > tw || sy + sh > th) {
                                throw RfbProtocolException("Hextile sub-rectangle outside its tile")
                            }
                            for (row in sy until sy + sh) {
                                tile.fill(colour, row * tw + sx, row * tw + sx + sw)
                            }
                        }
                    }
                }
                blit(tile, tw, th, fb, x + tx, y + ty)
                tx += TILE
            }
            ty += TILE
        }
    }

    private companion object {
        const val TILE = 16
        const val RAW = 1
        const val BACKGROUND_SPECIFIED = 2
        const val FOREGROUND_SPECIFIED = 4
        const val ANY_SUBRECTS = 8
        const val SUBRECTS_COLOURED = 16
    }
}

/**
 * ZRLE encoding: one zlib stream for the whole connection, each rectangle a run of 64x64 tiles
 * of 3-byte CPIXELs (B, G, R for this client's pixel format).
 */
internal class ZrleDecoder {
    private val inflater = Inflater()
    private val compressed = ByteArray(CHUNK)
    private val inflated = ByteArray(CHUNK)
    private var position = 0
    private var limit = 0
    private var remaining = 0L
    private var source: RfbInput? = null
    private val tile = IntArray(TILE * TILE)
    private val palette = IntArray(MAX_PALETTE)

    fun decode(input: RfbInput, fb: RfbFramebuffer, x: Int, y: Int, width: Int, height: Int) {
        remaining = input.u32()
        source = input
        position = 0
        limit = 0
        try {
            var ty = 0
            while (ty < height) {
                val th = minOf(TILE, height - ty)
                var tx = 0
                while (tx < width) {
                    val tw = minOf(TILE, width - tx)
                    decodeTile(tw, th)
                    blit(tile, tw, th, fb, x + tx, y + ty)
                    tx += TILE
                }
                ty += TILE
            }
            drain()
        } catch (e: DataFormatException) {
            throw RfbProtocolException("ZRLE: corrupt zlib data")
        } finally {
            source = null
        }
    }

    fun end() {
        inflater.end()
    }

    private fun decodeTile(tw: Int, th: Int) {
        val tile = tile
        val count = tw * th
        val sub = byte()
        when {
            sub == RAW -> for (i in 0 until count) tile[i] = cpixel()
            sub == SOLID -> tile.fill(cpixel(), 0, count)
            sub in 2..16 -> {
                readPalette(sub)
                val bits = if (sub == 2) 1 else if (sub <= 4) 2 else 4
                val mask = (1 shl bits) - 1
                var out = 0
                repeat(th) {
                    var left = tw
                    while (left > 0) {
                        val packed = byte()
                        var shift = 8 - bits
                        while (shift >= 0 && left > 0) {
                            tile[out++] = paletteColour((packed shr shift) and mask, sub)
                            shift -= bits
                            left--
                        }
                    }
                }
            }
            sub == PLAIN_RLE -> {
                var out = 0
                while (out < count) {
                    val colour = cpixel()
                    val run = runLength()
                    if (run > count - out) throw RfbProtocolException("ZRLE run overflows its tile")
                    tile.fill(colour, out, out + run)
                    out += run
                }
            }
            sub >= 130 -> {
                val size = sub - 128
                readPalette(size)
                var out = 0
                while (out < count) {
                    val code = byte()
                    val colour = paletteColour(code and 0x7F, size)
                    if (code and 0x80 == 0) {
                        tile[out++] = colour
                    } else {
                        val run = runLength()
                        if (run > count - out) throw RfbProtocolException("ZRLE run overflows its tile")
                        tile.fill(colour, out, out + run)
                        out += run
                    }
                }
            }
            else -> throw RfbProtocolException("ZRLE: invalid tile type $sub")
        }
    }

    private fun readPalette(size: Int) {
        for (i in 0 until size) palette[i] = cpixel()
    }

    private fun paletteColour(index: Int, size: Int): Int {
        if (index >= size) throw RfbProtocolException("ZRLE palette index out of range")
        return palette[index]
    }

    /** A run length: the sum of its bytes plus one, where each 255 means another byte follows. */
    private fun runLength(): Int {
        var length = 1
        while (true) {
            val b = byte()
            length += b
            if (b != 255) return length
            if (length > TILE * TILE) throw RfbProtocolException("ZRLE run overflows its tile")
        }
    }

    private fun cpixel(): Int {
        val b = byte()
        val g = byte()
        val r = byte()
        return OPAQUE or (r shl 16) or (g shl 8) or b
    }

    private fun byte(): Int {
        if (position == limit) refill()
        return inflated[position++].toInt() and 0xFF
    }

    private fun refill() {
        while (true) {
            val n = inflater.inflate(inflated)
            if (n > 0) {
                position = 0
                limit = n
                return
            }
            if (inflater.finished() || inflater.needsDictionary()) {
                throw RfbProtocolException("ZRLE: zlib stream ended")
            }
            if (!inflater.needsInput()) throw RfbProtocolException("ZRLE: corrupt zlib data")
            if (remaining == 0L) throw RfbProtocolException("ZRLE rectangle is shorter than its tiles")
            feed()
        }
    }

    private fun feed() {
        val n = minOf(remaining, compressed.size.toLong()).toInt()
        checkNotNull(source).readFully(compressed, 0, n)
        remaining -= n
        inflater.setInput(compressed, 0, n)
    }

    /**
     * Runs the rest of this rectangle's bytes through the inflater. The tiles can end before the
     * deflate block that closes the rectangle, and the stream state has to cover every byte.
     */
    private fun drain() {
        while (true) {
            if (inflater.needsInput()) {
                if (remaining == 0L) break
                feed()
            }
            val n = inflater.inflate(inflated)
            if (n == 0 && !inflater.needsInput()) throw RfbProtocolException("ZRLE: corrupt zlib data")
        }
        position = 0
        limit = 0
    }

    private companion object {
        const val TILE = 64
        const val CHUNK = 16 * 1024
        const val MAX_PALETTE = 127
        const val RAW = 0
        const val SOLID = 1
        const val PLAIN_RLE = 128
    }
}

/** Copies a decoded `width * height` tile into the framebuffer at ([x], [y]). */
private fun blit(tile: IntArray, width: Int, height: Int, fb: RfbFramebuffer, x: Int, y: Int) {
    for (row in 0 until height) {
        System.arraycopy(tile, row * width, fb.pixels, (y + row) * fb.width + x, width)
    }
}
