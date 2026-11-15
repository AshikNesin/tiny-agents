package tinyagents.vnc

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.Timeout
import java.io.InterruptedIOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

class ByteQueueInputStreamTest {
    @get:Rule
    val timeout: Timeout = Timeout(20, TimeUnit.SECONDS)

    private fun bytes(vararg values: Int) = ByteArray(values.size) { values[it].toByte() }

    /** Runs [block] on another thread and returns its result once [trigger] made it finish. */
    private fun <T> blocked(block: () -> T, trigger: () -> Unit): T {
        val started = CountDownLatch(1)
        val result = AtomicReference<Result<T>>()
        val thread = Thread {
            started.countDown()
            result.set(runCatching(block))
        }.apply { start() }
        started.await()
        // Let the reader reach its wait; a read that returned early fails the assertion below.
        Thread.sleep(100)
        assertTrue("the read returned before anything was offered", result.get() == null)
        trigger()
        thread.join(5000)
        return result.get().getOrThrow()
    }

    @Test
    fun `reads what was offered, across chunk boundaries`() {
        val stream = ByteQueueInputStream()
        stream.offer(bytes(1, 2, 3))
        stream.offer(bytes())
        stream.offer(bytes(4))
        stream.offer(bytes(5, 6, 255))
        assertEquals(7, stream.available())
        assertEquals(1, stream.read())
        val buffer = ByteArray(10)
        assertEquals("a read takes everything queued, up to the buffer size", 4, stream.read(buffer, 2, 4))
        assertArrayEquals(bytes(0, 0, 2, 3, 4, 5, 0, 0, 0, 0), buffer)
        assertEquals(6, stream.read())
        assertEquals("bytes are unsigned", 255, stream.read())
        assertEquals(0, stream.available())
        assertEquals(0, stream.read(buffer, 0, 0))
    }

    @Test
    fun `read blocks until bytes are offered`() {
        val stream = ByteQueueInputStream()
        assertEquals(42, blocked({ stream.read() }) { stream.offer(bytes(42)) })
    }

    @Test
    fun `end of stream lets readers drain, then gives EOF`() {
        val stream = ByteQueueInputStream()
        stream.offer(bytes(1, 2))
        stream.endOfStream()
        stream.offer(bytes(9))
        assertEquals(1, stream.read())
        assertEquals(2, stream.read())
        assertEquals(-1, stream.read())
        assertEquals(-1, stream.read(ByteArray(4)))
    }

    @Test
    fun `end of stream unblocks a waiting reader`() {
        val stream = ByteQueueInputStream()
        assertEquals(-1, blocked({ stream.read(ByteArray(8)) }) { stream.endOfStream() })
    }

    @Test
    fun `close drops queued bytes and unblocks a waiting reader`() {
        val queued = ByteQueueInputStream()
        queued.offer(bytes(1, 2, 3))
        queued.close()
        assertEquals(0, queued.available())
        assertEquals(-1, queued.read())
        queued.offer(bytes(4))
        assertEquals(-1, queued.read())

        val waiting = ByteQueueInputStream()
        assertEquals(-1, blocked({ waiting.read() }) { waiting.close() })
    }

    @Test
    fun `an interrupted reader gets an InterruptedIOException`() {
        val stream = ByteQueueInputStream()
        val failure = AtomicReference<Throwable>()
        val thread = Thread {
            try {
                stream.read()
            } catch (e: Throwable) {
                failure.set(e)
            }
        }.apply { start() }
        Thread.sleep(100)
        thread.interrupt()
        thread.join(5000)
        assertTrue(failure.get() is InterruptedIOException)
    }

    @Test
    fun `many chunks from another thread arrive in order`() {
        val stream = ByteQueueInputStream()
        val total = 200_000
        Thread {
            var sent = 0
            while (sent < total) {
                val size = minOf(total - sent, 1 + sent % 977)
                stream.offer(ByteArray(size) { (sent + it).toByte() })
                sent += size
            }
            stream.endOfStream()
        }.start()
        val buffer = ByteArray(4096)
        var received = 0
        while (true) {
            val n = stream.read(buffer, 0, 1 + received % buffer.size)
            if (n < 0) break
            for (i in 0 until n) assertEquals((received + i).toByte(), buffer[i])
            received += n
        }
        assertEquals(total, received)
    }
}
