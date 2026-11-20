package tinyagents.vnc

import java.io.InputStream
import java.io.InterruptedIOException
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

public class ByteQueueInputStream : InputStream() {
    private val lock = ReentrantLock()
    private val changed = lock.newCondition()
    private val chunks = ArrayDeque<ByteArray>()
    private var headOffset = 0
    private var buffered = 0L
    private var ended = false
    private var closed = false

    public fun offer(bytes: ByteArray) {
        if (bytes.isEmpty()) return
        lock.withLock {
            if (ended || closed) return
            chunks.addLast(bytes)
            buffered += bytes.size
            changed.signalAll()
        }
    }

    public fun endOfStream() {
        lock.withLock {
            ended = true
            changed.signalAll()
        }
    }

    override fun read(): Int {
        val one = ByteArray(1)
        return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 0xFF
    }

    override fun read(b: ByteArray, off: Int, len: Int): Int {
        if (off < 0 || len < 0 || len > b.size - off) throw IndexOutOfBoundsException()
        if (len == 0) return 0
        lock.withLock {
            while (chunks.isEmpty()) {
                if (ended || closed) return -1
                try {
                    changed.await()
                } catch (e: InterruptedException) {
                    Thread.currentThread().interrupt()
                    throw InterruptedIOException("Interrupted while waiting for data")
                }
            }
            if (closed) return -1
            var copied = 0
            while (copied < len && chunks.isNotEmpty()) {
                val head = chunks.first()
                val n = minOf(len - copied, head.size - headOffset)
                System.arraycopy(head, headOffset, b, off + copied, n)
                copied += n
                headOffset += n
                if (headOffset == head.size) {
                    chunks.removeFirst()
                    headOffset = 0
                }
            }
            buffered -= copied
            return copied
        }
    }

    override fun available(): Int = lock.withLock {
        if (closed) 0 else minOf(buffered, Int.MAX_VALUE.toLong()).toInt()
    }

    override fun close() {
        lock.withLock {
            closed = true
            chunks.clear()
            headOffset = 0
            buffered = 0
            changed.signalAll()
        }
    }
}
