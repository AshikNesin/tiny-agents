package groot.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import groot.mobile.data.AvatarStore
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.GraphicsMode

@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AvatarStoreTest {
    @Test
    fun `the url is the web app's DiceBear gaze avatar, as PNG, seeded by the raw name`() {
        // Web: https://api.dicebear.com/10.x/gaze/svg?seed=${encodeURIComponent(name)}
        assertEquals(
            "https://api.dicebear.com/10.x/gaze/png?seed=Travel%20Planner&size=144",
            AvatarStore.avatarUrl("Travel Planner"),
        )
        assertEquals("https://api.dicebear.com/10.x/gaze/png?seed=R%26D%20%2F%20Ops&size=144", AvatarStore.avatarUrl("R&D / Ops"))
    }

    @Test
    fun `a face is fetched once, then served from memory`() = runBlocking {
        val calls = AtomicInteger()
        val store = AvatarStore(cacheDir = null, client = serving(calls) { "/avatars/Ops.png" })
        val faces = (1..5).map { async { store.load("Ops") } }.awaitAll()
        val first = checkNotNull(faces.first())
        faces.forEach { assertSame(first, it) }
        assertSame(first, store.cached("Ops"))
        assertSame(first, store.load("Ops"))
        assertEquals(144, first.width)
        assertEquals(1, calls.get())
    }

    @Test
    fun `an unreachable avatar service gives null, so the initial is drawn`() = runBlocking {
        val calls = AtomicInteger()
        val store = AvatarStore(cacheDir = null, client = serving(calls) { null })
        assertNull(store.load("Nobody"))
        assertNull(store.cached("Nobody"))
        // A failure is not cached: the next screen tries again.
        assertNull(store.load("Nobody"))
        assertEquals(2, calls.get())
    }

    private fun serving(calls: AtomicInteger, resource: (seed: String) -> String?): OkHttpClient =
        OkHttpClient.Builder().addInterceptor { chain ->
            calls.incrementAndGet()
            val path = resource(chain.request().url.queryParameter("seed").orEmpty())
            val bytes = path?.let { AvatarStore::class.java.getResourceAsStream(it)?.use { stream -> stream.readBytes() } }
            Response.Builder()
                .request(chain.request())
                .protocol(Protocol.HTTP_1_1)
                .code(if (bytes != null) 200 else 503)
                .message("")
                .body((bytes ?: ByteArray(0)).toResponseBody("image/png".toMediaType()))
                .build()
        }.build()
}
